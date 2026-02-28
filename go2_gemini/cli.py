"""Single-prompt CLI for Go2 via Gemini. Uses direct dummy_state tools (no MCP)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

from go2_mcp import dummy_state

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Error: pip install google-genai", file=sys.stderr)
    sys.exit(1)

SYSTEM_INSTRUCTION = """You are controlling a Unitree Go2 quadruped robot. You have tools to get status, list actions, execute actions (stand_up, sit, dance1, back_flip, etc.), move with velocity, stop, set obstacle avoidance, speed level, and light.

When the user asks you to do something, use the appropriate tools. For example: to make the robot stand, use execute_action with name "stand_up". To do a backflip, use execute_action with name "back_flip". To move forward, use move with vx=0.3. Always consider safety - use stop when appropriate."""


def get_status() -> str:
    """Get the current status of the Go2 robot (obstacle avoidance, speed level, light state)."""
    return dummy_state.do_get_status()


def list_actions() -> str:
    """List all available robot actions (e.g. stand_up, sit, dance1, hello)."""
    return dummy_state.do_list_actions()


def execute_action(name: str) -> str:
    """Execute a named action on the robot. Args: name: Action name (stand_up, sit, dance1, back_flip, etc.)."""
    if isinstance(name, dict):
        name = name.get("name", "")
    name_normalized = str(name).lower().replace(" ", "_") if name is not None else ""
    if not name_normalized:
        return "ERROR: action name is required (e.g. stand_up, sit, back_flip)"
    return dummy_state.do_execute_action(name_normalized)


def move(vx: float, vy: float = 0.0, vyaw: float = 0.0) -> str:
    """Move the robot with velocity. Args: vx: Forward/back (-1 to 1). vy: Left/right. vyaw: Rotation."""
    return dummy_state.do_move(vx, vy, vyaw)


def stop() -> str:
    """Immediately stop all robot movement."""
    return dummy_state.do_stop()


def set_obstacle_avoidance(enabled: bool) -> str:
    """Enable or disable obstacle avoidance. Args: enabled: True or False."""
    return dummy_state.do_set_obstacle_avoidance(enabled)


def set_speed_level(level: int) -> str:
    """Set speed level 1-3. Args: level: 1=slow, 2=normal, 3=fast."""
    return dummy_state.do_set_speed_level(level)


def set_light(on: bool) -> str:
    """Turn head light on or off. Args: on: True or False."""
    return dummy_state.do_set_light(on)


def get_camera_frame() -> str:
    """Capture a camera frame from the robot (webcam in dummy mode)."""
    text, _ = dummy_state.do_get_camera_frame()
    return text


GEMINI_TOOLS = [
    get_status,
    list_actions,
    execute_action,
    move,
    stop,
    set_obstacle_avoidance,
    set_speed_level,
    set_light,
    get_camera_frame,
]


def run_prompt(client: genai.Client, prompt: str) -> str:
    config = types.GenerateContentConfig(
        tools=GEMINI_TOOLS,
        system_instruction=SYSTEM_INSTRUCTION,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(),
    )
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=config,
    )
    return response.text or ""


def main() -> None:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("Error: Set GEMINI_API_KEY or GOOGLE_API_KEY", file=sys.stderr)
        sys.exit(1)

    dummy_state.ensure_initial_state()

    client = genai.Client(api_key=api_key)

    if len(sys.argv) >= 2:
        prompt = " ".join(sys.argv[1:])
        result = run_prompt(client, prompt)
        print(result)
        return

    print("Go2 Gemini CLI (interactive). Type a command, or Ctrl+D to quit.")
    print("Example: stand up, make a backflip, move forward\n")
    try:
        while True:
            try:
                prompt = input("> ").strip()
            except EOFError:
                break
            if not prompt:
                continue
            result = run_prompt(client, prompt)
            print(result)
            print()
    except KeyboardInterrupt:
        print("\nBye.")
