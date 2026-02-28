"""FastAPI web app: python -m go2_webapp"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path

import uvicorn
import zmq
import zmq.asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from openai import OpenAI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request

BRIDGE_HOST = os.getenv("GO2_BRIDGE_HOST", "localhost")
CMD_PORT = int(os.getenv("GO2_ZMQ_CMD_PORT", "5555"))
PUB_PORT = int(os.getenv("GO2_ZMQ_PUB_PORT", "5556"))
WEBAPP_HOST = os.getenv("GO2_WEBAPP_HOST", "0.0.0.0")
WEBAPP_PORT = int(os.getenv("GO2_WEBAPP_PORT", "8080"))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("go2_webapp")

app = FastAPI(title="Go2 Web Controller")

STATIC_DIR = Path(__file__).parent / "static"

# ── ZMQ helpers ───────────────────────────────────────────────────

_zmq_ctx: zmq.asyncio.Context | None = None

ALLOWED_MOVES = [
    "stand_up",
    "stand_down",
    "balance_stand",
    "recovery_stand",
    "sit",
    "hello",
    "stretch",
    "dance1",
    "dance2",
    "heart",
    "front_flip",
    "front_jump",
    "back_flip",
    "left_flip",
    "hand_stand",
    "damp",
    "stop_move",
]


def get_zmq_ctx() -> zmq.asyncio.Context:
    global _zmq_ctx
    if _zmq_ctx is None:
        _zmq_ctx = zmq.asyncio.Context()
    return _zmq_ctx


async def bridge_command(cmd: str, params: dict | None = None) -> dict:
    """Send a command to the bridge and return the response."""
    ctx = get_zmq_ctx()
    sock = ctx.socket(zmq.REQ)
    sock.setsockopt(zmq.RCVTIMEO, 5000)
    sock.connect(f"tcp://{BRIDGE_HOST}:{CMD_PORT}")
    msg: dict = {"cmd": cmd}
    if params:
        msg["params"] = params
    await sock.send(json.dumps(msg).encode())
    raw = await sock.recv()
    sock.close()
    return json.loads(raw)


# ── REST endpoint ─────────────────────────────────────────────────

@app.post("/api/command")
async def api_command(request: Request):
    body = await request.json()
    cmd = body.get("cmd", "")
    params = body.get("params")
    resp = await bridge_command(cmd, params)
    return JSONResponse(content=resp)


def _build_custom_workout_from_prompt(user_prompt: str) -> dict:
    client = OpenAI(
        api_key=GEMINI_API_KEY,
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
    )

    system_prompt = (
        "You create safe, concise robot-dog workouts from user intent. "
        "Return ONLY JSON with keys: title (string), reason (string), moves (array of 5 strings). "
        "Each move must be chosen only from this list: "
        + ", ".join(ALLOWED_MOVES)
        + "."
    )
    user_content = f"User workout request: {user_prompt}"
    response = client.chat.completions.create(
        model=GEMINI_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        temperature=0.4,
    )
    content = (response.choices[0].message.content or "").strip()

    def parse_model_json(raw: str) -> dict:
        if not raw:
            raise ValueError(
                "Gemini returned an empty response. Try again or adjust GEMINI_MODEL."
            )

        # Try raw JSON first.
        try:
            parsed_obj = json.loads(raw)
            if isinstance(parsed_obj, dict):
                return parsed_obj
        except Exception:
            pass

        # Try fenced JSON blocks.
        fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw, re.IGNORECASE)
        if fenced:
            try:
                parsed_obj = json.loads(fenced.group(1).strip())
                if isinstance(parsed_obj, dict):
                    return parsed_obj
            except Exception:
                pass

        # Try first JSON object in free-form text.
        first_brace = raw.find("{")
        last_brace = raw.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            candidate = raw[first_brace : last_brace + 1]
            try:
                parsed_obj = json.loads(candidate)
                if isinstance(parsed_obj, dict):
                    return parsed_obj
            except Exception:
                pass

        raise ValueError(
            "Gemini did not return valid JSON for custom workout generation."
        )

    parsed = parse_model_json(content)

    title = str(parsed.get("title", "Custom Workout")).strip() or "Custom Workout"
    reason = str(parsed.get("reason", "")).strip()
    moves_raw = parsed.get("moves", [])
    if not isinstance(moves_raw, list):
        moves_raw = []
    moves: list[str] = []
    for item in moves_raw:
        name = str(item).strip()
        if name in ALLOWED_MOVES and name not in moves:
            moves.append(name)
        if len(moves) >= 5:
            break
    if len(moves) < 5:
        for fallback in ["stand_up", "stretch", "hello", "balance_stand", "stop_move"]:
            if fallback not in moves:
                moves.append(fallback)
            if len(moves) >= 5:
                break

    return {
        "id": "custom-workout",
        "label": "Custom Workout",
        "exerciseName": title,
        "moves": moves[:5],
        "reason": reason,
    }


@app.post("/api/custom_workout")
async def api_custom_workout(request: Request):
    body = await request.json()
    user_prompt = str(body.get("prompt", "")).strip()
    if not user_prompt:
        return JSONResponse(content={"ok": False, "msg": "Missing prompt"}, status_code=400)
    if not GEMINI_API_KEY:
        return JSONResponse(
            content={"ok": False, "msg": "GEMINI_API_KEY is not set on server"},
            status_code=500,
        )
    try:
        workout = await asyncio.to_thread(_build_custom_workout_from_prompt, user_prompt)
        return JSONResponse(content={"ok": True, "workout": workout})
    except Exception as exc:
        log.exception("custom workout generation failed")
        error_msg = str(exc)
        if "no longer available" in error_msg.lower() or "not_found" in error_msg.lower():
            error_msg = (
                f"Gemini model '{GEMINI_MODEL}' is unavailable. "
                "Set GEMINI_MODEL to a current model (for example: gemini-2.5-flash) and restart go2_webapp."
            )
        return JSONResponse(content={"ok": False, "msg": error_msg}, status_code=500)


# ── WebSocket: camera stream ─────────────────────────────────────

camera_clients: set[WebSocket] = set()


async def camera_relay():
    """Background task: subscribe to bridge PUB and relay to WebSocket clients."""
    ctx = get_zmq_ctx()
    sub = ctx.socket(zmq.SUB)
    sub.connect(f"tcp://{BRIDGE_HOST}:{PUB_PORT}")
    sub.subscribe(b"camera")
    log.info("Camera relay subscribed to tcp://%s:%d", BRIDGE_HOST, PUB_PORT)

    while True:
        try:
            parts = await sub.recv_multipart()
            if len(parts) < 2:
                continue
            jpeg_data = parts[1]
            dead: list[WebSocket] = []
            for ws in list(camera_clients):
                try:
                    await ws.send_bytes(jpeg_data)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                camera_clients.discard(ws)
        except asyncio.CancelledError:
            break
        except Exception:
            log.exception("Camera relay error")
            await asyncio.sleep(0.5)

    sub.close()


@app.websocket("/ws/camera")
async def ws_camera(websocket: WebSocket):
    await websocket.accept()
    camera_clients.add(websocket)
    log.info("Camera WebSocket client connected (%d total)", len(camera_clients))
    try:
        while True:
            # Keep connection alive; client doesn't send meaningful data
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        camera_clients.discard(websocket)
        log.info("Camera WebSocket client disconnected (%d total)", len(camera_clients))


# ── Startup / Shutdown ────────────────────────────────────────────

_camera_task: asyncio.Task | None = None


@app.on_event("startup")
async def on_startup():
    global _camera_task
    _camera_task = asyncio.create_task(camera_relay())
    log.info("Go2 Web App started")


@app.on_event("shutdown")
async def on_shutdown():
    if _camera_task:
        _camera_task.cancel()
        try:
            await _camera_task
        except asyncio.CancelledError:
            pass


# ── Static files (must be last so it doesn't shadow API routes) ──

app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

# ── Run ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host=WEBAPP_HOST, port=WEBAPP_PORT)


def main():
    uvicorn.run(app, host=WEBAPP_HOST, port=WEBAPP_PORT)
