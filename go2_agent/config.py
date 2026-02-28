"""Configuration for the Go2 agent (env vars, .env loading)."""

from __future__ import annotations

import os
from pathlib import Path

# Load .env from project root when used as a package (parent of go2_agent)
try:
    from dotenv import load_dotenv
    _root = Path(__file__).resolve().parent.parent
    load_dotenv(_root / ".env")
    load_dotenv()
except ImportError:
    pass

BRIDGE_HOST = os.getenv("GO2_BRIDGE_HOST", "localhost")
CMD_PORT = int(os.getenv("GO2_ZMQ_CMD_PORT", "5555"))

# API key: prefer GEMINI_API_KEY; GOOGLE_API_KEY is used by Google SDKs
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
if GEMINI_API_KEY and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY
