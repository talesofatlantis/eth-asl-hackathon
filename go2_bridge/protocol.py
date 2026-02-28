"""Action registry and JSON message helpers."""

from __future__ import annotations

import json
from typing import Any

# Maps action name -> (method_name, args, kwargs)
ACTION_REGISTRY: dict[str, tuple[str, tuple, dict]] = {
    "stand_up":       ("StandUp", (), {}),
    "stand_down":     ("StandDown", (), {}),
    "balance_stand":  ("BalanceStand", (), {}),
    "recovery_stand": ("RecoveryStand", (), {}),
    "sit":            ("Sit", (), {}),
    "hello":          ("Hello", (), {}),
    "stretch":        ("Stretch", (), {}),
    "dance1":         ("Dance1", (), {}),
    "dance2":         ("Dance2", (), {}),
    "heart":          ("Heart", (), {}),
    "front_flip":     ("FrontFlip", (), {}),
    "front_jump":     ("FrontJump", (), {}),
    "back_flip":      ("BackFlip", (), {}),
    "left_flip":      ("LeftFlip", (), {}),
    "hand_stand":     ("HandStand", (True,), {}),
    "damp":           ("Damp", (), {}),
    "stop_move":      ("StopMove", (), {}),
}

# Tags for UI/filtering: lower_body, chest, full_body, dance (each action can have multiple)
MOVEMENT_TAGS: dict[str, list[str]] = {
    "stand_up":       ["chest", "full_body"],
    "stand_down":     ["lower_body", "full_body"],
    "balance_stand":  ["chest", "full_body"],
    "recovery_stand": ["full_body"],
    "sit":            ["lower_body", "full_body"],
    "hello":          ["chest"],
    "stretch":        ["lower_body", "full_body"],
    "dance1":         ["dance"],
    "dance2":         ["dance"],
    "heart":          ["chest", "dance"],
    "front_flip":     ["full_body"],
    "front_jump":     ["lower_body", "full_body"],
    "back_flip":      ["full_body"],
    "left_flip":      ["full_body"],
    "hand_stand":     ["chest", "full_body"],
    "damp":           ["full_body"],
    "stop_move":      ["full_body"],
}


def make_request(cmd: str, params: dict[str, Any] | None = None) -> bytes:
    """Encode a command request as JSON bytes."""
    msg: dict[str, Any] = {"cmd": cmd}
    if params is not None:
        msg["params"] = params
    return json.dumps(msg).encode()


def make_response(ok: bool, msg: str = "", data: Any = None) -> bytes:
    """Encode a command response as JSON bytes."""
    return json.dumps({"ok": ok, "msg": msg, "data": data}).encode()


def parse_request(raw: bytes) -> tuple[str, dict[str, Any]]:
    """Decode a command request. Returns (cmd, params)."""
    obj = json.loads(raw)
    return obj.get("cmd", ""), obj.get("params", {})
