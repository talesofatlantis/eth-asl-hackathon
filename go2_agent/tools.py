"""Agent tools: sync functions that call the Go2 bridge (used by ADK agent)."""

from __future__ import annotations

from . import bridge


def get_robot_status() -> str:
    """Get the current status of the Go2 robot (obstacle avoidance, speed level, light)."""
    resp = bridge.send_command("status")
    return bridge.format_response(resp)


def list_robot_actions() -> str:
    """List all available robot actions (e.g. stand_up, sit, dance1, hello)."""
    resp = bridge.send_command("list_actions")
    return bridge.format_response(resp)


def execute_robot_action(name: str) -> str:
    """Execute a named action on the robot. name: e.g. stand_up, sit, hello, stretch, dance1, dance2, heart, front_flip."""
    resp = bridge.send_command("action", {"name": name})
    return bridge.format_response(resp)


def move_robot(vx: float, vy: float = 0.0, vyaw: float = 0.0) -> str:
    """Move the robot. vx/vy in m/s (-1 to 1), vyaw in rad/s. Robot must be standing first."""
    resp = bridge.send_command("move", {"vx": vx, "vy": vy, "vyaw": vyaw})
    return bridge.format_response(resp)


def stop_robot() -> str:
    """Immediately stop all robot movement."""
    resp = bridge.send_command("stop")
    return bridge.format_response(resp)


def set_obstacle_avoidance(enabled: bool) -> str:
    """Enable or disable the robot's obstacle avoidance. Pass True or False."""
    resp = bridge.send_command("obstacle_avoidance", {"enabled": enabled})
    return bridge.format_response(resp)


def set_speed_level(level: int) -> str:
    """Set the robot's movement speed level from 1 (slow) to 3 (fast)."""
    resp = bridge.send_command("speed_level", {"level": level})
    return bridge.format_response(resp)


def set_robot_light(on: bool) -> str:
    """Turn the robot's head light on (True) or off (False)."""
    resp = bridge.send_command("light", {"on": on})
    return bridge.format_response(resp)
