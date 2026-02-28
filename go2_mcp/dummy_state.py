"""Shared dummy robot state — used by dummy_server (MCP) and go2_gemini CLI."""

from __future__ import annotations

import json
import logging
import math
import os

log = logging.getLogger("go2_mcp_dummy")

STATE_FILE = os.getenv("GO2_DUMMY_STATE_FILE", "/tmp/go2_dummy_state.json")

ACTIONS = [
    "stand_up", "stand_down", "balance_stand", "recovery_stand",
    "sit", "hello", "stretch", "dance1", "dance2", "heart",
    "front_flip", "front_jump", "back_flip", "left_flip",
    "hand_stand", "damp", "stop_move",
]

_state = {
    "x": 0.0,
    "y": 0.0,
    "heading": 0.0,
    "stance": "standing",
    "speed_level": 1,
    "obstacle_avoidance": True,
    "light_on": False,
    "last_action": None,
    "vx": 0.0,
    "vy": 0.0,
    "vyaw": 0.0,
    "log": [],
}

LOG_MAX = 20


def _log(msg: str) -> None:
    _state["log"].append(msg)
    if len(_state["log"]) > LOG_MAX:
        _state["log"] = _state["log"][-LOG_MAX:]


def _save() -> None:
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(_state, f, indent=2)
    except Exception as exc:
        log.warning("Failed to write state file: %s", exc)


def do_get_status() -> str:
    _log("status checked")
    _save()
    data = {
        "obstacle_avoidance": _state["obstacle_avoidance"],
        "speed_level": _state["speed_level"],
        "light_on": _state["light_on"],
    }
    return f"OK: ok\n{json.dumps(data, indent=2)}"


def do_list_actions() -> str:
    _log("listed actions")
    _save()
    data = {"actions": ACTIONS}
    return f"OK: actions\n{json.dumps(data, indent=2)}"


def do_execute_action(name: str) -> str:
    if name not in ACTIONS:
        _log(f"unknown action: {name}")
        _save()
        return f"ERROR: unknown action: {name}"

    _state["last_action"] = name
    if name == "stand_up":
        _state["stance"] = "standing"
    elif name in ("stand_down", "sit"):
        _state["stance"] = name.replace("_", " ")
        _state["vx"] = _state["vy"] = _state["vyaw"] = 0.0
    elif name == "damp":
        _state["stance"] = "damped"
        _state["vx"] = _state["vy"] = _state["vyaw"] = 0.0
    elif name == "balance_stand":
        _state["stance"] = "balance standing"
    elif name == "recovery_stand":
        _state["stance"] = "standing"

    _log(f"{name} executed")
    _save()
    return f"OK: {name} executed\n{json.dumps({'code': 0}, indent=2)}"


def do_move(vx: float, vy: float = 0.0, vyaw: float = 0.0) -> str:
    _state["vx"] = max(-1.0, min(1.0, vx))
    _state["vy"] = max(-1.0, min(1.0, vy))
    _state["vyaw"] = max(-1.0, min(1.0, vyaw))

    step = 0.5 * _state["speed_level"]
    h = _state["heading"]
    _state["x"] += step * (_state["vx"] * math.sin(h) + _state["vy"] * math.cos(h))
    _state["y"] += step * (_state["vx"] * math.cos(h) - _state["vy"] * math.sin(h))
    _state["heading"] += _state["vyaw"] * 0.3

    _log(f"move vx={vx:.2f} vy={vy:.2f} vyaw={vyaw:.2f}")
    _save()
    return "OK: velocity updated"


def do_stop() -> str:
    _state["vx"] = _state["vy"] = _state["vyaw"] = 0.0
    _log("stopped")
    _save()
    return "OK: stopped"


def do_set_obstacle_avoidance(enabled: bool) -> str:
    _state["obstacle_avoidance"] = enabled
    state = "enabled" if enabled else "disabled"
    _log(f"obstacle avoidance {state}")
    _save()
    return f"OK: obstacle avoidance {state}"


def do_set_speed_level(level: int) -> str:
    _state["speed_level"] = max(1, min(3, level))
    _log(f"speed level set to {_state['speed_level']}")
    _save()
    return f"OK: speed level set to {_state['speed_level']}"


def do_set_light(on: bool) -> str:
    _state["light_on"] = on
    state = "on" if on else "off"
    _log(f"light {state}")
    _save()
    return f"OK: light {state}\n{json.dumps({'code': 0}, indent=2)}"


def do_get_camera_frame() -> tuple[str, str | None]:
    """Returns (text_description, base64_jpeg_or_none)."""
    try:
        import cv2
        cap = cv2.VideoCapture(0)
        try:
            ret, frame = cap.read()
            if not ret:
                _log("camera frame failed")
                _save()
                return ("ERROR: Failed to capture from webcam", None)
            import base64
            _, jpeg = cv2.imencode(".jpg", frame)
            jpeg_bytes = jpeg.tobytes()
            b64 = base64.b64encode(jpeg_bytes).decode("utf-8")
            _log("camera frame captured")
            _save()
            return (f"Camera frame captured ({len(jpeg_bytes)} bytes)", b64)
        finally:
            cap.release()
    except ImportError:
        _log("camera frame skipped (no cv2)")
        _save()
        return ("Webcam not available (opencv-python not installed)", None)


def ensure_initial_state() -> None:
    """Write initial state so simulator can start."""
    _save()
