"""Shared MCP client logic for go2_gemini chat and agent."""

from __future__ import annotations

import base64
import json
import os
import sys
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any

try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
except ImportError:
    ClientSession = None  # type: ignore
    StdioServerParameters = None  # type: ignore
    stdio_client = None  # type: ignore

try:
    from google.genai import types
except ImportError:
    types = None  # type: ignore

PROJECT_ROOT = Path(__file__).parent.parent


def load_mcp_config(config_path: Path) -> dict[str, Any]:
    """Load MCP config and resolve {{PROJECT_ROOT}} placeholder."""
    if not config_path.exists():
        return {}
    text = config_path.read_text()
    text = text.replace("{{PROJECT_ROOT}}", str(PROJECT_ROOT))
    config = json.loads(text)
    venv_python = PROJECT_ROOT / "go2_py311" / "bin" / "python"
    python_cmd = str(venv_python) if venv_python.exists() else sys.executable
    for server_cfg in config.get("mcpServers", {}).values():
        cmd = server_cfg.get("command", "")
        if "go2_py311" in cmd or "{{PROJECT_ROOT}}" in cmd:
            server_cfg["command"] = python_cmd
    return config


async def connect_mcp_servers(
    config: dict[str, Any],
    exit_stack: AsyncExitStack,
) -> dict[str, ClientSession]:
    """Connect to all MCP servers. Returns {name: session}."""
    if ClientSession is None or stdio_client is None:
        print("Error: pip install mcp", file=sys.stderr)
        sys.exit(1)

    servers: dict[str, ClientSession] = {}
    mcp_servers = config.get("mcpServers", {})

    for name, server_cfg in mcp_servers.items():
        command = server_cfg.get("command", "python")
        args = server_cfg.get("args", [])
        cwd = server_cfg.get("cwd")
        if cwd and "{{PROJECT_ROOT}}" in str(cwd):
            cwd = str(cwd).replace("{{PROJECT_ROOT}}", str(PROJECT_ROOT))
        print(f"  [{name}] Launching: {command} {' '.join(args)}")
        if cwd:
            print(f"  [{name}] cwd: {cwd}")

        params = StdioServerParameters(
            command=command,
            args=args,
            env={**os.environ, **server_cfg.get("env", {})},
            cwd=cwd,
        )
        try:
            read_stream, write_stream = await exit_stack.enter_async_context(stdio_client(params))
            session = await exit_stack.enter_async_context(ClientSession(read_stream, write_stream))
            result = await session.initialize()
            server_info = result.serverInfo if result else None
            if server_info:
                version = f" v{server_info.version}" if server_info.version else ""
                print(f"  [{name}] Connected: {server_info.name}{version}")
            else:
                print(f"  [{name}] Connected")
            servers[name] = session
        except Exception as e:
            print(f"  [{name}] FAILED: {e}")

    return servers


def mcp_tool_to_function_declaration(tool: Any) -> "types.FunctionDeclaration":
    """Convert MCP tool to Gemini FunctionDeclaration."""
    if types is None:
        raise ImportError("pip install google-genai")
    name = tool.name if hasattr(tool, "name") else str(tool.get("name", ""))
    description = tool.description if hasattr(tool, "description") else str(tool.get("description", ""))
    input_schema = tool.inputSchema if hasattr(tool, "inputSchema") else tool.get("inputSchema", {})
    parameters = input_schema if isinstance(input_schema, dict) else {}
    return types.FunctionDeclaration(
        name=name,
        description=description or f"Tool: {name}",
        parameters=parameters,
    )


async def call_mcp_tool(
    sessions: dict[str, ClientSession], tool_name: str, args: dict[str, Any]
) -> tuple[str, bytes | None]:
    """Call a tool on the appropriate MCP session. Returns (text_result, image_bytes_or_none)."""
    for session in sessions.values():
        try:
            result = await session.call_tool(tool_name, args)
            if result and result.content:
                text_parts: list[str] = []
                image_bytes: bytes | None = None
                for c in result.content:
                    if hasattr(c, "type") and c.type == "image":
                        data = getattr(c, "data", None)
                        if data:
                            try:
                                image_bytes = base64.b64decode(data)
                            except Exception:
                                pass
                    elif hasattr(c, "text") and c.text:
                        text_parts.append(c.text)
                    elif hasattr(c, "type") and c.type == "text" and getattr(c, "text", None):
                        text_parts.append(c.text)
                text = "\n".join(text_parts) if text_parts else str(result)
                return (text, image_bytes)
        except Exception:
            continue
    return (f"Error: tool {tool_name} not found or failed", None)
