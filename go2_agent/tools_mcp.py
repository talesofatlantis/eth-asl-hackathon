"""Agent tools that call the Go2 MCP server (agent talks to robot through MCP)."""

from __future__ import annotations

from . import mcp_client


async def get_robot_status() -> str:
    """Get the current status of the Go2 robot (obstacle avoidance, speed level, light)."""
    return await mcp_client.call_tool("get_status", {})


async def list_robot_actions() -> str:
    """List all available robot actions (e.g. stand_up, sit, dance1, hello)."""
    return await mcp_client.call_tool("list_actions", {})


async def execute_robot_action(name: str) -> str:
    """Execute a named action on the robot. name: e.g. stand_up, sit, hello, stretch, dance1, dance2, heart, front_flip."""
    return await mcp_client.call_tool("execute_action", {"name": name})


async def move_robot(vx: float, vy: float = 0.0, vyaw: float = 0.0) -> str:
    """Move the robot. vx/vy in m/s (-1 to 1), vyaw in rad/s. Robot must be standing first."""
    return await mcp_client.call_tool("move", {"vx": vx, "vy": vy, "vyaw": vyaw})


async def stop_robot() -> str:
    """Immediately stop all robot movement."""
    return await mcp_client.call_tool("stop", {})


async def set_obstacle_avoidance(enabled: bool) -> str:
    """Enable or disable the robot's obstacle avoidance. Pass True or False."""
    return await mcp_client.call_tool("set_obstacle_avoidance", {"enabled": enabled})


async def set_speed_level(level: int) -> str:
    """Set the robot's movement speed level from 1 (slow) to 3 (fast)."""
    return await mcp_client.call_tool("set_speed_level", {"level": level})


async def set_robot_light(on: bool) -> str:
    """Turn the robot's head light on (True) or off (False)."""
    return await mcp_client.call_tool("set_light", {"on": on})
