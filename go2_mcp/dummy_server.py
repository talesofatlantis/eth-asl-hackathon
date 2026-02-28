"""Dummy MCP server for testing without a robot or bridge.

Same tool interface as server.py, but maintains state in memory and writes
it to a JSON file for the companion dummy_simulator.py to visualize.

Usage:
    python -m go2_mcp.dummy_server
"""

from __future__ import annotations

import logging
import sys

from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult, ImageContent, TextContent

from . import dummy_state

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
log = logging.getLogger("go2_mcp_dummy")

mcp = FastMCP("go2-robot-dummy")


@mcp.tool()
def get_status() -> str:
    """Get the current status of the Go2 robot.

    Returns obstacle avoidance state, speed level, and light state.
    """
    return dummy_state.do_get_status()


@mcp.tool()
def list_actions() -> str:
    """List all available robot actions (e.g. stand_up, sit, dance1, hello)."""
    return dummy_state.do_list_actions()


@mcp.tool()
def execute_action(name: str) -> str:
    """Execute a named action on the robot.

    Args:
        name: Action name (e.g. stand_up, stand_down, sit, hello, stretch,
              dance1, dance2, heart, front_flip, front_jump, back_flip,
              left_flip, hand_stand, balance_stand, recovery_stand, damp, stop_move)
    """
    return dummy_state.do_execute_action(name)


@mcp.tool()
def move(vx: float, vy: float = 0.0, vyaw: float = 0.0) -> str:
    """Move the robot with the given velocity.

    The robot must be standing first. Velocities are in m/s (linear) and rad/s (rotation).
    The movement continues at the given velocity until a stop command or new move command.
    The bridge has a 250ms safety timeout — if no new command arrives, the robot stops automatically.

    Args:
        vx: Forward/backward velocity (-1.0 to 1.0). Positive = forward.
        vy: Left/right velocity (-1.0 to 1.0). Positive = left.
        vyaw: Rotation velocity (-1.0 to 1.0). Positive = counter-clockwise.
    """
    return dummy_state.do_move(vx, vy, vyaw)


@mcp.tool()
def stop() -> str:
    """Immediately stop all robot movement. Use this as an emergency stop or to halt motion."""
    return dummy_state.do_stop()


@mcp.tool()
def set_obstacle_avoidance(enabled: bool) -> str:
    """Enable or disable the robot's obstacle avoidance system.

    When enabled, the robot uses its sensors to avoid collisions during movement.
    Enabled by default at bridge startup.

    Args:
        enabled: True to enable, False to disable.
    """
    return dummy_state.do_set_obstacle_avoidance(enabled)


@mcp.tool()
def set_speed_level(level: int) -> str:
    """Set the robot's movement speed level.

    Args:
        level: Speed level from 1 (slow) to 3 (fast).
    """
    return dummy_state.do_set_speed_level(level)


@mcp.tool()
def set_light(on: bool) -> str:
    """Turn the robot's head light on or off.

    Args:
        on: True to turn on (max brightness), False to turn off.
    """
    return dummy_state.do_set_light(on)


@mcp.tool()
def get_camera_frame() -> CallToolResult:
    """Capture a single camera frame from the robot and return it as a JPEG image.

    The bridge must be running with camera publishing enabled.
    """
    text, b64 = dummy_state.do_get_camera_frame()
    if b64 is None:
        return CallToolResult(content=[TextContent(type="text", text=text)])
    return CallToolResult(
        content=[
            TextContent(type="text", text=text),
            ImageContent(type="image", data=b64, mimeType="image/jpeg"),
        ]
    )


if __name__ == "__main__":
    dummy_state.ensure_initial_state()
    log.info("Dummy MCP server starting (state file: %s)", dummy_state.STATE_FILE)
    mcp.run(transport="stdio")
