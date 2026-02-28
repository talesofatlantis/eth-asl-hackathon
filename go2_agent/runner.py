"""Gemini ADK agent runner: build agent, run chat. Agent talks to the robot through MCP (go2_mcp)."""

from __future__ import annotations

import logging

from . import config
from . import tools_mcp

log = logging.getLogger("go2_agent")

_app = None
_runner = None


def _build_agent():
    """Build the ADK app with root agent and MCP-backed async tools. Returns (app, runner) or (None, None) if no API key."""
    if not config.GEMINI_API_KEY:
        return None, None
    try:
        from google.adk.agents.llm_agent import Agent
        from google.adk.apps import App
        from google.adk.runners import InMemoryRunner
    except ImportError as e:
        log.warning("google-adk not installed: %s", e)
        return None, None

    root_agent = Agent(
        model="gemini-2.5-flash",
        name="robogym_agent",
        description="Controls the Go2 robot for the Robogym workout app. Use tools to run actions, move, stop, and change settings.",
        instruction=(
            "You are the AI coach for Robogym. The user is training with a Unitree Go2 robot dog. "
            "You MUST use the tools to control the robot — do not just say you did; actually call the tools. "
            "Before any move, call execute_robot_action('stand_up') first so the robot is standing. "
            "For 'move backwards', 'move backward', 'move forward', or any directional move: ALWAYS use move_robot_for_duration, NOT move_robot. move_robot only lasts 250ms and the robot barely moves. Use move_robot_for_duration(vx, duration_seconds) with negative vx for backward (e.g. -0.3), positive for forward; duration_seconds can be 2.0 if the user does not specify. "
            "Tools: execute_robot_action, move_robot_for_duration (for any real movement), move_robot (avoid; too short), stop_robot, get_robot_status, list_robot_actions, set_speed_level, set_obstacle_avoidance, set_robot_light. "
            "After each tool call, briefly report the tool result so the user knows it ran."
        ),
        tools=[
            tools_mcp.get_robot_status,
            tools_mcp.list_robot_actions,
            tools_mcp.execute_robot_action,
            tools_mcp.move_robot,
            tools_mcp.move_robot_for_duration,
            tools_mcp.stop_robot,
            tools_mcp.set_obstacle_avoidance,
            tools_mcp.set_speed_level,
            tools_mcp.set_robot_light,
        ],
    )
    app = App(name="robogym", root_agent=root_agent)
    runner = InMemoryRunner(app=app)
    return app, runner


def get_runner():
    """Return the InMemoryRunner for the agent, or None if API key is missing or ADK not installed."""
    global _app, _runner
    if _runner is None and _app is None:
        _app, _runner = _build_agent()
    return _runner


def is_agent_available() -> bool:
    """True if GEMINI_API_KEY (or GOOGLE_API_KEY) is set and ADK is installed."""
    return bool(config.GEMINI_API_KEY) and get_runner() is not None


def _extract_operations_from_events(events) -> list[dict]:
    """Build a list of { tool, args, result } from ADK run_debug events (tool calls and responses)."""
    operations: list[dict] = []
    pending_calls: list[dict] = []  # { tool, args } waiting for a response

    for event in events:
        # Tool call request (LLM asked to run a tool)
        if hasattr(event, "get_function_calls"):
            try:
                for fc in event.get_function_calls() or []:
                    name = getattr(fc, "name", None) or getattr(fc, "function_name", None)
                    args = getattr(fc, "args", None) or getattr(fc, "parameters", None) or {}
                    if isinstance(args, dict):
                        pending_calls.append({"tool": name or "?", "args": args})
                    else:
                        pending_calls.append({"tool": name or "?", "args": {}})
            except Exception:
                pass
        # Tool result (tool was run and returned)
        if hasattr(event, "get_function_responses"):
            try:
                for fr in event.get_function_responses() or []:
                    name = getattr(fr, "name", None) or getattr(fr, "function_name", None)
                    result = getattr(fr, "response", None) or getattr(fr, "result", None)
                    result_str = str(result) if result is not None else ""
                    if pending_calls:
                        op = pending_calls.pop(0)
                        op["result"] = result_str
                        operations.append(op)
                    else:
                        operations.append({"tool": name or "?", "args": {}, "result": result_str})
            except Exception:
                pass

    # Attach any pending calls with no result
    for op in pending_calls:
        op["result"] = "(no response)"
        operations.append(op)
    return operations


async def chat(user_message: str) -> tuple[str, list[dict]]:
    """Send a message to the agent; return (reply_text, operations_list). Operations list has { tool, args, result }."""
    runner = get_runner()
    if not runner:
        return (
            "Agent is not available. Add GEMINI_API_KEY (or GOOGLE_API_KEY) to .env at project root "
            "and ensure google-adk is installed (pip install google-adk).",
            [],
        )
    from .mcp_client import mcp_session_context
    try:
        async with mcp_session_context():
            events = await runner.run_debug(user_message, quiet=True)
            operations = _extract_operations_from_events(events)
            reply_text = ""
            for event in reversed(events):
                if hasattr(event, "content") and event.content:
                    if hasattr(event.content, "parts"):
                        for part in event.content.parts:
                            if hasattr(part, "text") and part.text:
                                reply_text = part.text
                                break
                        if reply_text:
                            break
                    if not reply_text and hasattr(event.content, "text"):
                        reply_text = event.content.text
                        break
                if getattr(event, "type", None) and "content" in str(event).lower():
                    if hasattr(event, "content") and event.content and not reply_text:
                        reply_text = str(event.content)
                        break
            if not reply_text:
                reply_text = "The agent did not return a text reply."
            return (reply_text, operations)
    except Exception as e:
        log.exception("Agent chat failed")
        return (f"Agent error: {e}", [])
