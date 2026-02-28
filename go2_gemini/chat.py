"""MCP-based chat interface for Go2 (text + vision). Connects to MCP server, supports vision command."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from contextlib import AsyncExitStack
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Error: pip install google-genai", file=sys.stderr)
    sys.exit(1)

try:
    import cv2
except ImportError:
    cv2 = None  # type: ignore

from . import mcp_client

PROJECT_ROOT = Path(__file__).parent.parent
MCP_DIR = Path(__file__).parent / "MCPs"
MCP_REAL_CONFIG = MCP_DIR / "Go2_MCP.json"
MCP_SIM_CONFIG = MCP_DIR / "Go2_MCP_simulator.json"
MODEL = "gemini-1.5-flash"
MAX_TOOL_CALLS = 10
MAX_AGENT_STEPS = 50

SYSTEM_INSTRUCTION = """You are controlling a Unitree Go2 quadruped robot. You have MCP tools to get status, list actions, execute actions (stand_up, sit, dance1, back_flip, etc.), move with velocity, stop, set obstacle avoidance, speed level, and light.

When the user asks you to do something, use the appropriate tools. For example: to make the robot stand, use execute_action with name "stand_up". To do a backflip, use execute_action with name "back_flip". To move forward, use move with vx=0.3. Always consider safety - use stop when appropriate."""

AGENTIC_SYSTEM_INSTRUCTION = """You are controlling a Unitree Go2 quadruped robot. You have MCP tools to observe and act:

- get_status: Get obstacle avoidance, speed level, light state.
- get_camera_frame: Capture a camera frame (returns image for vision).
- list_actions: List available actions.
- execute_action: Run actions (stand_up, sit, dance1, back_flip, etc.).
- move, stop: Control velocity.
- set_obstacle_avoidance, set_speed_level, set_light: Configure robot.

Work autonomously until the task is complete. Use get_status and get_camera_frame to observe when needed. Use execute_action, move, stop to act. When finished, say "Task complete" (or "Done" or "Finished")."""


def get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("Error: Set GEMINI_API_KEY or GOOGLE_API_KEY in .env", file=sys.stderr)
        sys.exit(1)
    return genai.Client(api_key=api_key)


def capture_webcam_frame() -> bytes | None:
    """Capture a JPEG frame from webcam. Returns None if unavailable."""
    if cv2 is None:
        return None
    cap = cv2.VideoCapture(0)
    try:
        ret, frame = cap.read()
        if not ret or frame is None:
            return None
        _, jpeg = cv2.imencode(".jpg", frame)
        return jpeg.tobytes()
    finally:
        cap.release()


async def chat_loop(
    client: genai.Client,
    sessions: dict,
    tool_count: int,
) -> None:
    """Main chat loop with text and vision modes."""
    history: list[types.Content] = []

    all_tools: list[types.FunctionDeclaration] = []
    for session in sessions.values():
        result = await session.list_tools()
        for tool in result.tools:
            all_tools.append(mcp_client.mcp_tool_to_function_declaration(tool))

    tools_list = [types.Tool(function_declarations=all_tools)] if all_tools else []
    config = (
        types.GenerateContentConfig(
            tools=tools_list,
            system_instruction=SYSTEM_INSTRUCTION,
        )
        if tools_list
        else types.GenerateContentConfig(system_instruction=SYSTEM_INSTRUCTION)
    )

    print(f"\nChat with {MODEL} ({tool_count} MCP tools)")
    print("Commands: 'quit'/'exit', 'clear', 'vision' (capture webcam and send to Gemini)")
    print("-" * 60)

    while True:
        try:
            user_input = await asyncio.to_thread(input, "\nYou: ")
            user_input = user_input.strip()
        except (KeyboardInterrupt, EOFError):
            print("\nGoodbye!")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit"):
            print("Goodbye!")
            break
        if user_input.lower() == "clear":
            history.clear()
            print("Conversation cleared.")
            continue

        if user_input.lower() == "vision":
            frame_bytes = await asyncio.to_thread(capture_webcam_frame)
            if frame_bytes is None:
                print("(Webcam not available; install opencv-python)")
                continue
            image_part = types.Part.from_bytes(data=frame_bytes, mime_type="image/jpeg")
            text_part = types.Part(text="What do you see in this image? Describe it and suggest any robot actions if relevant.")
            user_content = types.Content(role="user", parts=[image_part, text_part])
            print("(Sent webcam frame to Gemini)")
        else:
            user_content = types.Content(role="user", parts=[types.Part(text=user_input)])

        history.append(user_content)

        try:
            for _ in range(MAX_TOOL_CALLS):
                response = await client.aio.models.generate_content(
                    model=MODEL,
                    contents=history,
                    config=config,
                )
                assistant_text = response.text or "(empty response)"

                function_calls = []
                if response.candidates:
                    for part in response.candidates[0].content.parts:
                        if hasattr(part, "function_call") and part.function_call:
                            fc = part.function_call
                            args = fc.args
                            if hasattr(args, "items"):
                                args = dict(args)
                            elif not isinstance(args, dict):
                                args = {}
                            function_calls.append((fc.name, args))

                if not function_calls:
                    history.append(
                        types.Content(role="model", parts=[types.Part(text=assistant_text)])
                    )
                    print(f"\nAssistant: {assistant_text}")
                    break

                history.append(
                    types.Content(role="model", parts=response.candidates[0].content.parts)
                )

                for name, args in function_calls:
                    result_text, result_image = await mcp_client.call_mcp_tool(sessions, name, args)
                    preview = result_text[:80] + "..." if len(result_text) > 80 else result_text
                    print(f"  [tool] {name} -> {preview}")
                    response_parts: list[types.Part] = [
                        types.Part(
                            function_response=types.FunctionResponse(
                                name=name, response={"result": result_text}
                            )
                        )
                    ]
                    if result_image:
                        response_parts.append(
                            types.Part.from_bytes(data=result_image, mime_type="image/jpeg")
                        )
                    history.append(types.Content(role="user", parts=response_parts))
            else:
                history.append(
                    types.Content(role="model", parts=[types.Part(text=assistant_text)])
                )
                print(f"\nAssistant: {assistant_text} (max tool calls reached)")
        except Exception as e:
            print(f"\nError: {e}")
            history.pop()


COMPLETION_PHRASES = ("task complete", "done", "finished")


def _is_task_complete(text: str) -> bool:
    """Check if response indicates task completion."""
    lower = (text or "").lower()
    return any(phrase in lower for phrase in COMPLETION_PHRASES)


async def agent_loop(
    client: genai.Client,
    sessions: dict,
    task: str,
    tool_count: int,
    system_instruction: str | None = None,
) -> None:
    """Autonomous agent loop: run until task complete or max steps."""
    history: list[types.Content] = [
        types.Content(role="user", parts=[types.Part(text=task)])
    ]

    all_tools: list[types.FunctionDeclaration] = []
    for session in sessions.values():
        result = await session.list_tools()
        for tool in result.tools:
            all_tools.append(mcp_client.mcp_tool_to_function_declaration(tool))

    tools_list = [types.Tool(function_declarations=all_tools)] if all_tools else []
    sys_inst = system_instruction or AGENTIC_SYSTEM_INSTRUCTION
    config = (
        types.GenerateContentConfig(
            tools=tools_list,
            system_instruction=sys_inst,
        )
        if tools_list
        else types.GenerateContentConfig(system_instruction=sys_inst)
    )

    print(f"\nAgent mode: {MODEL} ({tool_count} tools)")
    print(f"Task: {task}")
    print("-" * 60)

    for step in range(MAX_AGENT_STEPS):
        try:
            response = await client.aio.models.generate_content(
                model=MODEL,
                contents=history,
                config=config,
            )
            assistant_text = response.text or "(empty response)"

            function_calls: list[tuple[str, dict]] = []
            if response.candidates:
                for part in response.candidates[0].content.parts:
                    if hasattr(part, "function_call") and part.function_call:
                        fc = part.function_call
                        args = fc.args
                        if hasattr(args, "items"):
                            args = dict(args)
                        elif not isinstance(args, dict):
                            args = {}
                        function_calls.append((fc.name, args))

            if not function_calls:
                print(f"\nAssistant: {assistant_text}")
                if _is_task_complete(assistant_text):
                    print("\n[Task complete]")
                    break
                history.append(
                    types.Content(role="model", parts=[types.Part(text=assistant_text)])
                )
                continue

            history.append(
                types.Content(role="model", parts=response.candidates[0].content.parts)
            )

            for name, args in function_calls:
                result_text, result_image = await mcp_client.call_mcp_tool(sessions, name, args)
                preview = result_text[:80] + "..." if len(result_text) > 80 else result_text
                print(f"  [step {step + 1}] {name} -> {preview}")
                response_parts = [
                    types.Part(
                        function_response=types.FunctionResponse(
                            name=name, response={"result": result_text}
                        )
                    )
                ]
                if result_image:
                    response_parts.append(
                        types.Part.from_bytes(data=result_image, mime_type="image/jpeg")
                    )
                history.append(types.Content(role="user", parts=response_parts))

        except Exception as e:
            print(f"\nError: {e}")
            break

    else:
        print(f"\n[Max steps ({MAX_AGENT_STEPS}) reached]")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Go2 MCP Chat (text + vision)")
    parser.add_argument("-s", "--sim", action="store_true", help="Use dummy MCP server (simulator)")
    parser.add_argument("-t", "--task", type=str, help="Run agentic mode with this task (autonomous loop)")
    parser.add_argument("--system-prompt", type=str, help="Override system prompt for agentic mode")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    config_path = MCP_SIM_CONFIG if args.sim else MCP_REAL_CONFIG
    mode = "SIMULATION" if args.sim else "REAL"

    print("=" * 60)
    print(f"Go2 MCP Chat [{mode}]")
    print("=" * 60)
    print(f"[model] {MODEL}")
    print(f"[mode] {mode}")

    client = get_client()
    print("[api]   API key loaded")

    mcp_config = mcp_client.load_mcp_config(config_path)
    mcp_servers = mcp_config.get("mcpServers", {})

    if not mcp_servers:
        print(f"\n[mcp]   No servers in {config_path.name}")
        print("        Edit the config and set command/cwd paths.")
        return

    print(f"\n[mcp]   Loading from {config_path.name}")

    async with AsyncExitStack() as stack:
        sessions = await mcp_client.connect_mcp_servers(mcp_config, stack)
        if not sessions:
            print("\n[mcp]   No connections. Check config paths.")
            return

        tool_count = 0
        for session in sessions.values():
            result = await session.list_tools()
            tool_count += len(result.tools)
            for t in result.tools:
                print(f"  - {t.name}")

        if args.sim:
            from go2_mcp import dummy_state
            dummy_state.ensure_initial_state()
            print("\n[sim]   Run dummy_simulator.py in another terminal to see effects.")

        print(f"\n[ready] {tool_count} tools available")
        print("=" * 60)

        if args.task:
            await agent_loop(
                client,
                sessions,
                task=args.task,
                tool_count=tool_count,
                system_instruction=args.system_prompt,
            )
        else:
            await chat_loop(client, sessions, tool_count)


if __name__ == "__main__":
    asyncio.run(main())
