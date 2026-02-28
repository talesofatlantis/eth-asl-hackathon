# Go2 Gemini — Agentic VLM + MCP Chat

Control the Go2 robot via Gemini API. Connects to the MCP server (real or dummy) and lets a vision-language model observe and act autonomously.

## Setup

```bash
pip install -r requirements_gemini.txt
```

Add to `.env` in the project root:

```
GEMINI_API_KEY=your-key-here
```

## Run

### Agentic mode (autonomous task)

Give one task; the VLM runs until done or max 50 steps:

```bash
# Simulation (dummy robot)
python -m go2_gemini --sim --task "Stand up, do a dance, then sit down"

# Real robot
python -m go2_gemini --task "Stand up and move forward"
```

### Interactive chat

Turn-by-turn chat with text and vision:

```bash
python -m go2_gemini --sim
```

Commands: `quit`, `clear`, `vision` (capture webcam).

### Single-prompt CLI (no MCP)

```bash
python go2_cli_gemini.py "stand up"
```

## Simulation

In another terminal, run the ASCII simulator to see effects:

```bash
python go2_mcp/dummy_simulator.py
```

The MCP dummy server is spawned automatically when using `--sim`; no need to run it manually.
