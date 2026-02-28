"""Agent tools that call the Go2 MCP server (agent talks to robot through MCP)."""

from __future__ import annotations

import asyncio

from . import mcp_client

# Send move to bridge every 200ms to keep velocity active (bridge timeout is 250ms).
_MOVE_HEARTBEAT_INTERVAL_S = 0.2
_MAX_DURATION_S = 10.0


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
    """Single brief velocity command (~250ms). For 'move backwards' or any real movement use move_robot_for_duration instead. vx/vy in m/s, vyaw in rad/s. Stand up first. Backward = negative vx."""
    return await mcp_client.call_tool("move", {"vx": vx, "vy": vy, "vyaw": vyaw})


async def move_robot_for_duration(vx: float, duration_seconds: float = 2.0, vy: float = 0.0, vyaw: float = 0.0) -> str:
    """Move the robot at the given velocity for a sustained duration (keeps sending move so the bridge does not timeout). Use this for 'move backwards', 'move backward', '3 steps back', or any directional move. Call stand_up first. duration_seconds defaults to 2.0, max 10. Backward = negative vx (e.g. -0.3)."""
    duration_seconds = max(0.1, min(float(duration_seconds), _MAX_DURATION_S))
    steps = max(1, int(duration_seconds / _MOVE_HEARTBEAT_INTERVAL_S))
    for _ in range(steps):
        await mcp_client.call_tool("move", {"vx": vx, "vy": vy, "vyaw": vyaw})
        await asyncio.sleep(_MOVE_HEARTBEAT_INTERVAL_S)
    result = await mcp_client.call_tool("stop", {})
    return f"Moved for {duration_seconds:.1f}s then stopped. {result}"


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
