"""ZMQ client for sending commands to the Go2 bridge (used by agent tools)."""

from __future__ import annotations

import json
import zmq

from . import config


def send_command(cmd: str, params: dict | None = None) -> dict:
    """Send a command to the bridge and return the parsed response."""
    ctx = zmq.Context()
    sock = ctx.socket(zmq.REQ)
    sock.setsockopt(zmq.RCVTIMEO, 5000)
    sock.connect(f"tcp://{config.BRIDGE_HOST}:{config.CMD_PORT}")
    msg: dict = {"cmd": cmd}
    if params:
        msg["params"] = params
    sock.send_json(msg)
    resp = sock.recv_json()
    sock.close()
    ctx.term()
    return resp


def format_response(resp: dict) -> str:
    """Format a bridge response as readable text."""
    ok = resp.get("ok", False)
    msg = resp.get("msg", "")
    data = resp.get("data")
    parts = [f"{'OK' if ok else 'ERROR'}: {msg}"]
    if data:
        parts.append(json.dumps(data, indent=2))
    return "\n".join(parts)
