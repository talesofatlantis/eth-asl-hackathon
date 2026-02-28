# Installation & Environment Setup

Step-by-step guide to reproduce the full Go2 control environment from scratch.

## Prerequisites

- **Python 3.11** (the Unitree SDK requires 3.11; 3.12+ may not work with cyclonedds)
- **Git**
- A network connection to the Unitree Go2 robot (Ethernet or Wi-Fi)

## 1. Clone This Repo

```bash
git clone <this-repo-url> go2
cd go2
```

## 2. Create Python 3.11 Virtual Environment

```bash
python3.11 -m venv go2_py311
source go2_py311/bin/activate
```

## 3. (Optional) Clone CycloneDDS C Library

Only needed if you want to build CycloneDDS from source for custom DDS configuration. 

```bash
cd ~
git clone https://github.com/eclipse-cyclonedds/cyclonedds -b releases/0.10.x 
cd cyclonedds && mkdir build install && cd build
cmake .. -DCMAKE_INSTALL_PREFIX=../install
cmake --build . --target install
```

## 4. Install the Unitree SDK

The SDK is not on PyPI — clone it and install in editable mode. Clone from your project directory (or the same place you built CycloneDDS) so the path is predictable:

```bash
# From your project root (e.g. eth-asl-hackathon or go2), or from cyclonedds/build if you just built there:
git clone https://github.com/unitreerobotics/unitree_sdk2_python.git
cd unitree_sdk2_python

# Only if you built CycloneDDS in step 3: set CYCLONEDDS_HOME to its install directory.
# If you skipped step 3, leave CYCLONEDDS_HOME unset — the pip wheel includes a bundled library.
# export CYCLONEDDS_HOME="$HOME/ETH-ASL-HACK/cyclonedds/install"

pip3 install -e .
cd -   # back to project root if needed
```

This pulls in `cyclonedds`, `numpy`, `opencv-python`, and other SDK dependencies automatically.

## 5. Install Bridge & Web App Dependencies

```bash
pip install -r requirements_bridge.txt
```

This adds: `pyzmq`, `fastapi`, `uvicorn`.

## 6. (Optional) Install MCP Server Dependencies

Only needed if you want to use the MCP server with Claude Code / Claude Desktop:

```bash
pip install "mcp[cli]"
```

### Enable MCP in Cursor (for AI agents)

The project includes `.cursor/mcp.json` so Cursor can start the Go2 MCP server and expose robot tools to the agent. If your venv or project path differs, edit `.cursor/mcp.json`:

- `command`: full path to the Python executable of the venv that has `go2_mcp` and bridge deps installed
- `cwd`: full path to this repo (so `python -m go2_mcp` finds the `go2_mcp` package)

Then **restart Cursor** so it picks up the MCP server. The agent will have tools like `get_status`, `list_actions`, `execute_action`, `move`, `stop`, `get_camera_frame`, etc. The **go2_bridge** must be running (and ideally connected to the robot) for those tools to work.

### Robogym AI Coach (Gemini ADK)

The web app (Robogym) includes an **AI Coach** that uses Google’s Gemini ADK to control the robot via natural language. To enable it:

1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Put the key in a `.env` file at the project root (the web app loads it automatically; no need to export in the CLI):

   ```bash
   # In project root, create or edit .env:
   GEMINI_API_KEY=your-api-key-here
   ```

   Alternatively you can set `GOOGLE_API_KEY` in `.env`; the app checks both.

3. Install the agent dependency (included in `requirements_bridge.txt`): `pip install google-adk`.

4. Start the web app as usual. On the Robogym start screen you’ll see an **AI Coach (Gemini)** panel; type a request (e.g. “Make the robot stand up and wave hello”) and click Send. The agent uses the same bridge as the GUI, so **go2_bridge** must be running.

If `GEMINI_API_KEY` is not set (e.g. missing from `.env`), the AI Coach panel shows a short message asking you to add it.

## 7. Verify Installation

Use the **same** virtual environment you used when installing the SDK (step 4). If you created the venv in the project directory, activate it from the project root:

```bash
cd /path/to/eth-asl-hackathon   # or go2 project root
source go2_py311/bin/activate

# Check SDK is importable
python -c "from unitree_sdk2py.go2.sport.sport_client import SportClient; print('SDK OK')"

# Check bridge dependencies
python -c "import zmq, fastapi, uvicorn; print('Bridge deps OK')"
```

## 8. Network Setup

The Go2 robot communicates via DDS over a local network. You need to know which network interface connects to the robot:

```bash
# List interfaces
ip link show        # Linux
ifconfig            # macOS

# Common values:
#   eno1, eth0      — wired Ethernet
#   wlan0, en0      — Wi-Fi
```

Set the interface when starting the bridge:

```bash
GO2_NETWORK_INTERFACE=en8 python -m go2_bridge
```

## Running

### Start the Bridge

```bash
source go2_py311/bin/activate
GO2_NETWORK_INTERFACE=eno1 python -m go2_bridge
```

### Start the Web App (separate terminal)

```bash
source go2_py311/bin/activate
python -m go2_webapp
# Open http://localhost:8080
```

### CLI Client (separate terminal)

```bash
source go2_py311/bin/activate
python go2_client/cli_client.py status
python go2_client/cli_client.py action stand_up
```

See [README.md](README.md) for full usage details.

## Installed Package Versions (Reference)

These are the versions known to work together:

```
unitree_sdk2py    1.0.1
cyclonedds        0.10.2
numpy             2.4.2
opencv-python     4.13.0.92
pyzmq             27.1.0
fastapi           0.132.0
uvicorn           0.41.0
```

## Troubleshooting

**"No module named unitree_sdk2py"**
You're in a different virtual environment than the one where the SDK was installed. Either:
- Activate the venv you used in step 4 (e.g. if you created it in a parent folder: `source ../go2_py311/bin/activate` from the project directory), or
- Install the SDK again into this venv: `cd` to the `unitree_sdk2_python` clone, set `CYCLONEDDS_HOME`, then `pip install -e .`.

**Bridge starts but robot doesn't respond**
Check `GO2_NETWORK_INTERFACE` matches the interface connected to the robot's network. The robot and your machine must be on the same subnet.

**Camera frames not arriving**
The VideoClient sometimes needs a few seconds after init. If frames never arrive, verify the robot's camera is enabled and the SDK `GetImageSample()` works standalone.

**Movement commands ignored**
The robot must be standing (`stand_up` action) before it will accept move commands. Also verify obstacle avoidance initialized correctly — you should hear a voice confirmation from the robot.
