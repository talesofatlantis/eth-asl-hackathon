"""MCP client: connects to go2_mcp via stdio so the agent talks to the robot through MCP."""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import Any

from . import config

log = logging.getLogger("go2_agent.mcp")

# Current MCP session for this async context (set during chat when using MCP).
_current_session: ContextVar[Any] = ContextVar("mcp_session", default=None)


@asynccontextmanager
async def mcp_session_context():
    """Async context manager: spawn go2_mcp, set session for tools, then close on exit."""
    from mcp import ClientSession
    from mcp.client.stdio import stdio_client, StdioServerParameters

    project_root = str(config.PROJECT_ROOT)
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "go2_mcp"],
        env=None,
        cwd=project_root,
    )
    transport_ctx = stdio_client(params)
    read_stream, write_stream = await transport_ctx.__aenter__()
    session = ClientSession(read_stream, write_stream)
    await session.__aenter__()
    await session.initialize()
    set_session(session)
    log.info("MCP session to go2_mcp established (stdio)")
    try:
        yield session
    finally:
        clear_session()
        await session.__aexit__(None, None, None)
        await transport_ctx.__aexit__(None, None, None)


async def call_tool(name: str, arguments: dict) -> str:
    """Call an MCP tool by name; uses the session set in the current context. Returns text result."""
    session = _current_session.get()
    if session is None:
        return "ERROR: No MCP session (agent should run inside mcp_session_context)"
    result = await session.call_tool(name, arguments)
    if getattr(result, "isError", False) or not getattr(result, "content", None):
        return f"ERROR: {result}"
    parts = []
    for block in result.content:
        if hasattr(block, "text") and block.text:
            parts.append(block.text)
    return "\n".join(parts) if parts else str(result)


def set_session(session):
    """Set the current MCP session for this context (used by chat)."""
    _current_session.set(session)


def clear_session():
    """Clear the current MCP session."""
    _current_session.set(None)
