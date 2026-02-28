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
            "Use the tools to control the robot: run actions (stand_up, sit, dance1, hello, stretch, etc.), "
            "move it (move_robot), stop it (stop_robot), set speed level and obstacle avoidance. "
            "Be concise and friendly. After using a tool, summarize what you did in one short sentence."
        ),
        tools=[
            tools_mcp.get_robot_status,
            tools_mcp.list_robot_actions,
            tools_mcp.execute_robot_action,
            tools_mcp.move_robot,
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


async def chat(user_message: str) -> str:
    """Send a message to the agent and return its reply. Agent talks to the robot through MCP (go2_mcp)."""
    runner = get_runner()
    if not runner:
        return (
            "Agent is not available. Add GEMINI_API_KEY (or GOOGLE_API_KEY) to .env at project root "
            "and ensure google-adk is installed (pip install google-adk)."
        )
    from .mcp_client import mcp_session_context
    try:
        async with mcp_session_context():
            events = await runner.run_debug(user_message, quiet=True)
            # Extract last agent text content from events
            for event in reversed(events):
                if hasattr(event, "content") and event.content:
                    if hasattr(event.content, "parts"):
                        for part in event.content.parts:
                            if hasattr(part, "text") and part.text:
                                return part.text
                    if hasattr(event.content, "text"):
                        return event.content.text
                if getattr(event, "type", None) and "content" in str(event).lower():
                    if hasattr(event, "content") and event.content:
                        return str(event.content)
            return "The agent did not return a text reply."
    except Exception as e:
        log.exception("Agent chat failed")
        return f"Agent error: {e}"
