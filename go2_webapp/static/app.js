const { useEffect, useMemo, useRef, useState } = React;
const MOVE_DURATION_SECONDS = 20;

const DEFAULT_WORKOUTS = [
  {
    id: "yoga-relax",
    label: "Yoga & Relax",
    exerciseName: "Gentle Yoga Flow",
    moves: ["stretch", "hello", "sit", "stand_up", "heart"],
  },
  {
    id: "full-body",
    label: "Full Body",
    exerciseName: "Full Body Activation",
    moves: ["stand_up", "balance_stand", "front_jump", "recovery_stand", "stop_move"],
  },
  {
    id: "hardcode",
    label: "Hardcode",
    exerciseName: "Hardcode Power Set",
    moves: ["dance1", "dance2", "front_flip", "back_flip", "left_flip", "hand_stand"],
  },
];

const WORKOUTS = Array.isArray(window.ROBOGYM_WORKOUTS) ? window.ROBOGYM_WORKOUTS : DEFAULT_WORKOUTS;

const TRAINERS = [
  { id: "coach-rio", name: "Coach Rio", tagline: "Calm and focused" },
  { id: "captain-nova", name: "Captain Nova", tagline: "Energetic and motivating" },
  { id: "dr-blaze", name: "Dr. Blaze", tagline: "High-intensity challenge" },
];

function CameraFeed() {
  const [imageUrl, setImageUrl] = useState("");
  const [status, setStatus] = useState("Connecting...");

  useEffect(() => {
    let ws;
    let reconnectTimer = null;
    let currentBlobUrl = "";
    let isUnmounted = false;
    const reconnectDelayMs = 1500;

    const scheduleReconnect = () => {
      if (isUnmounted) return;
      setStatus("Camera unavailable - workout continues. Reconnecting...");
      reconnectTimer = setTimeout(connect, reconnectDelayMs);
    };

    const connect = () => {
      try {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(`${proto}//${location.host}/ws/camera`);
      } catch (err) {
        console.error("Camera websocket setup failed:", err);
        scheduleReconnect();
        return;
      }
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        if (!isUnmounted) setStatus("Connected");
      };

      ws.onmessage = (ev) => {
        if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
        const blob = new Blob([ev.data], { type: "image/jpeg" });
        currentBlobUrl = URL.createObjectURL(blob);
        if (!isUnmounted) setImageUrl(currentBlobUrl);
      };

      ws.onclose = () => {
        if (isUnmounted) return;
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && ws.readyState <= 1) ws.close();
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-900 min-h-[300px] sm:min-h-[420px]">
      <div className="absolute top-3 right-3 z-10 rounded-full border border-neutral-600 bg-neutral-800/95 px-3 py-1.5 text-xs font-medium text-neutral-200">
        {status}
      </div>
      {imageUrl ? (
        <img src={imageUrl} alt="Robot dog camera feed" className="w-full h-full min-h-[300px] sm:min-h-[420px] object-cover block" />
      ) : (
        <div className="min-h-[300px] sm:min-h-[420px] flex items-center justify-center text-neutral-500 text-base">
          Waiting for robot camera feed...
        </div>
      )}
    </div>
  );
}

function App() {
  const [step, setStep] = useState("start");
  const [selectedWorkout, setSelectedWorkout] = useState(null);
  const [selectedTrainer, setSelectedTrainer] = useState(null);
  const [countdownValue, setCountdownValue] = useState(3);
  const [workoutStartedAtMs, setWorkoutStartedAtMs] = useState(null);
  const [clockMs, setClockMs] = useState(Date.now());
  const [agentAvailable, setAgentAvailable] = useState(null);
  const [agentMessage, setAgentMessage] = useState("");
  const [agentReply, setAgentReply] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentLog, setAgentLog] = useState([]);
  const lastExecutedMoveIndexRef = useRef(-1);
  const agentLogIdRef = useRef(0);

  useEffect(() => {
    fetch("/api/agent/status")
      .then((r) => r.json())
      .then((d) => setAgentAvailable(d.available === true))
      .catch(() => setAgentAvailable(false));
  }, []);

  useEffect(() => {
    if (step !== "countdown") return;
    if (countdownValue === 0) {
      setStep("workout");
      return;
    }
    const timer = setTimeout(() => {
      setCountdownValue((prev) => prev - 1);
    }, 900);
    return () => clearTimeout(timer);
  }, [step, countdownValue]);

  const sendAgentMessage = () => {
    const msg = agentMessage.trim();
    if (!msg || agentLoading) return;
    setAgentLoading(true);
    setAgentReply("");
    const time = new Date().toLocaleTimeString();
    fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg }),
    })
      .then((r) => r.json())
      .then((d) => {
        let reply = "";
        let status = "ok";
        const operations = Array.isArray(d.operations) ? d.operations : [];
        if (d.reply != null) {
          reply = d.reply;
          setAgentReply(d.reply);
        } else if (d.error) {
          reply = "Error: " + d.error + (d.hint ? " " + d.hint : "");
          setAgentReply(reply);
          status = "error";
        } else {
          reply = "(no reply)";
          setAgentReply(reply);
          status = "error";
        }
        setAgentLog((prev) => [
          { id: ++agentLogIdRef.current, time, message: msg, reply, status, operations },
          ...prev.slice(0, 49),
        ]);
      })
      .catch((err) => {
        const errMsg = "Request failed: " + String(err);
        setAgentReply(errMsg);
        setAgentLog((prev) => [
          { id: ++agentLogIdRef.current, time, message: msg, reply: errMsg, status: "error", operations: [] },
          ...prev.slice(0, 49),
        ]);
      })
      .finally(() => setAgentLoading(false));
  };

  const workoutTitle = useMemo(() => {
    if (!selectedWorkout) return "Workout";
    return selectedWorkout.exerciseName;
  }, [selectedWorkout]);

  const workoutMoves = useMemo(() => {
    if (!selectedWorkout || !Array.isArray(selectedWorkout.moves)) return [];
    return selectedWorkout.moves;
  }, [selectedWorkout]);

  useEffect(() => {
    if (step !== "workout") return;
    const startedAt = Date.now();
    setWorkoutStartedAtMs(startedAt);
    setClockMs(startedAt);
  }, [step, selectedWorkout]);

  useEffect(() => {
    if (step !== "workout") return;
    const timer = setInterval(() => {
      setClockMs(Date.now());
    }, 500);

    return () => clearInterval(timer);
  }, [step]);

  const elapsedSeconds = useMemo(() => {
    if (step !== "workout" || !workoutStartedAtMs) return 0;
    return Math.max(0, Math.floor((clockMs - workoutStartedAtMs) / 1000));
  }, [step, workoutStartedAtMs, clockMs]);

  const currentMoveIndex = useMemo(() => {
    if (workoutMoves.length === 0) return 0;
    return Math.floor(elapsedSeconds / MOVE_DURATION_SECONDS) % workoutMoves.length;
  }, [workoutMoves, elapsedSeconds]);

  const moveSecondsLeft = useMemo(() => {
    if (workoutMoves.length === 0) return MOVE_DURATION_SECONDS;
    const secondsIntoMove = elapsedSeconds % MOVE_DURATION_SECONDS;
    return MOVE_DURATION_SECONDS - secondsIntoMove;
  }, [workoutMoves, elapsedSeconds]);

  const currentMove = useMemo(() => {
    if (workoutMoves.length === 0) return "No move selected";
    return workoutMoves[currentMoveIndex] || workoutMoves[0];
  }, [workoutMoves, currentMoveIndex]);

  // Reset "last executed move" when leaving workout so next run sends from index 0.
  useEffect(() => {
    if (step !== "workout") lastExecutedMoveIndexRef.current = -1;
  }, [step]);

  // Send the current move to the robot when the workout is active and the move index changes.
  useEffect(() => {
    if (step !== "workout" || workoutMoves.length === 0) return;
    if (currentMoveIndex === lastExecutedMoveIndexRef.current) return;
    lastExecutedMoveIndexRef.current = currentMoveIndex;
    const moveName = workoutMoves[currentMoveIndex];
    fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "action", params: { name: moveName } }),
    }).catch((err) => console.error("Failed to send move to robot:", err));
  }, [step, workoutMoves, currentMoveIndex]);

  const beginCountdown = () => {
    setCountdownValue(3);
    setStep("countdown");
  };

  const goToStart = () => {
    setSelectedWorkout(null);
    setSelectedTrainer(null);
    setCountdownValue(3);
    setWorkoutStartedAtMs(null);
    setClockMs(Date.now());
    setStep("start");
  };

  const screenBase = "min-h-screen max-w-4xl mx-auto px-6 py-12 md:py-16";
  const tileClass = "rounded-2xl min-h-[160px] px-6 py-5 text-left text-lg md:text-xl font-semibold text-neutral-900 bg-white border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 transition-colors duration-200 cursor-pointer";

  if (step === "start") {
    return (
      <div className={`${screenBase} flex flex-col justify-center items-center gap-8`}>
        <h1 className="font-heading text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-neutral-900">ROBOGYM</h1>
        <p className="text-neutral-500 text-base md:text-lg text-center max-w-md">Train with your robot dog coach</p>
        <button
          className="rounded-full px-8 py-3.5 bg-black hover:bg-neutral-800 text-white font-semibold text-sm transition-colors"
          onClick={() => setStep("workout-select")}
        >
          Start Workout
        </button>
        <div className="w-full max-w-lg mt-4 p-6 bg-white border border-neutral-200 rounded-2xl">
          <h3 className="font-heading text-base font-semibold text-neutral-900 mb-3">AI Coach (Gemini)</h3>
          {agentAvailable === false && (
            <p className="text-sm text-neutral-500">
              Add <code className="bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-700">GEMINI_API_KEY</code> to <code className="bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-700">.env</code> at project root to enable the AI coach.
            </p>
          )}
          {agentAvailable === true && (
            <>
              <div className="flex gap-3 mb-3">
                <input
                  type="text"
                  className="flex-1 px-4 py-2.5 border border-neutral-200 rounded-xl bg-neutral-50 text-neutral-900 placeholder-neutral-400 text-[15px] focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900 outline-none transition-shadow"
                  placeholder="e.g. Make the robot stand up and wave hello"
                  value={agentMessage}
                  onChange={(e) => setAgentMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendAgentMessage()}
                  disabled={agentLoading}
                />
                <button
                  className="px-5 py-2.5 rounded-xl bg-black hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
                  onClick={sendAgentMessage}
                  disabled={agentLoading || !agentMessage.trim()}
                >
                  {agentLoading ? "..." : "Send"}
                </button>
              </div>
              {agentReply && (
                <div className="mt-3 p-4 bg-neutral-50 border border-neutral-100 rounded-xl text-neutral-700 text-[15px] leading-relaxed whitespace-pre-wrap">
                  {agentReply}
                </div>
              )}
              {agentLog.length > 0 && (
                <div className="mt-4">
                  <h4 className="font-heading text-sm font-semibold text-neutral-600 mb-2">Log</h4>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2 font-mono text-xs">
                    {agentLog.map((entry) => (
                      <div key={entry.id} className="border-b border-neutral-200 pb-2 mb-2 last:border-0 last:mb-0 last:pb-0">
                        <div className="text-neutral-500 flex gap-2">
                          <span className="shrink-0">[{entry.time}]</span>
                          <span className={entry.status === "error" ? "text-red-600 font-medium" : "text-neutral-600"}>
                            {entry.status === "error" ? "ERROR" : "OK"}
                          </span>
                        </div>
                        <div className="mt-0.5 text-neutral-700 break-words">&gt; {entry.message}</div>
                        {entry.operations && entry.operations.length > 0 && (
                          <div className="mt-1.5 pl-2 border-l-2 border-neutral-300 space-y-1">
                            <div className="text-neutral-500 font-medium">Operations:</div>
                            {entry.operations.map((op, i) => (
                              <div key={i} className="text-neutral-600">
                                <span className="text-neutral-700 font-medium">{op.tool}</span>
                                <span className="text-neutral-500">
                                  ({Object.entries(op.args || {})
                                    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                                    .join(", ")})
                                </span>
                                <span className="text-neutral-500"> → </span>
                                <span className={op.result && op.result.startsWith("ERROR") ? "text-red-600" : "text-neutral-600"}>
                                  {op.result && op.result.length > 80 ? op.result.slice(0, 80) + "…" : op.result || "—"}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className={`mt-0.5 break-words whitespace-pre-wrap ${entry.status === "error" ? "text-red-600" : "text-neutral-600"}`}>
                          {entry.reply}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (step === "workout-select") {
    return (
      <div className={screenBase}>
        <h2 className="font-heading text-center mb-10 text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">Select Your Workout</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {WORKOUTS.map((workout) => (
            <button
              key={workout.id}
              className={tileClass}
              onClick={() => {
                setSelectedWorkout(workout);
                setStep("trainer-select");
              }}
            >
              {workout.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (step === "trainer-select") {
    return (
      <div className={screenBase}>
        <h2 className="font-heading text-center mb-10 text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">Select Your Trainer</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {TRAINERS.map((trainer) => (
            <button
              key={trainer.id}
              className={`${tileClass} flex flex-col justify-end items-start`}
              onClick={() => {
                setSelectedTrainer(trainer);
                setStep("instructions");
              }}
            >
              <span className="font-heading text-lg font-semibold text-neutral-900">{trainer.name}</span>
              <span className="mt-1.5 text-sm font-medium text-neutral-500">{trainer.tagline}</span>
            </button>
          ))}
        </div>
        <button
          className="mt-10 mx-auto block rounded-full px-8 py-3.5 bg-black hover:bg-neutral-800 text-white font-semibold text-sm transition-colors"
          onClick={() => setStep("workout-select")}
        >
          Back
        </button>
      </div>
    );
  }

  if (step === "instructions") {
    return (
      <div className={`${screenBase} flex flex-col justify-center items-center gap-8`}>
        <h2 className="font-heading text-center text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">Instructions</h2>
        <div className="w-full max-w-lg bg-white border border-neutral-200 rounded-2xl p-6 leading-relaxed text-neutral-600">
          <p>1. Follow the voice instructions.</p>
          <p>2. The dog will demonstrate.</p>
          <p className="mt-2 text-neutral-500">Workout: <strong className="text-neutral-900">{selectedWorkout ? selectedWorkout.label : "Not selected"}</strong></p>
          <p className="mt-1 text-neutral-500">Trainer: <strong className="text-neutral-900">{selectedTrainer ? selectedTrainer.name : "Not selected"}</strong></p>
          <p className="mt-1 text-neutral-500">Planned moves:</p>
          <ul className="mt-1 ml-5 list-disc text-neutral-500 space-y-0.5">
            {workoutMoves.map((move) => (
              <li key={move}>{move}</li>
            ))}
          </ul>
        </div>
        <button
          className="rounded-full px-8 py-3.5 bg-black hover:bg-neutral-800 text-white font-semibold text-sm transition-colors"
          onClick={beginCountdown}
        >
          Start in 3...
        </button>
      </div>
    );
  }

  if (step === "countdown") {
    return (
      <div className={`${screenBase} flex flex-col justify-center items-center gap-10`}>
        <h2 className="font-heading text-center text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">Get Ready</h2>
        <div className="w-36 aspect-square rounded-full bg-white border border-neutral-200 flex items-center justify-center text-5xl font-bold text-neutral-900">
          {countdownValue}
        </div>
      </div>
    );
  }

  return (
    <div className={`${screenBase} flex flex-col gap-8`}>
      <div className="text-center">
        <h2 className="font-heading text-2xl md:text-4xl font-bold tracking-tight text-neutral-900">{workoutTitle}</h2>
        <p className="mt-2 text-neutral-500 text-base">
          Current exercise: <strong className="text-neutral-900">{currentMove}</strong> ({moveSecondsLeft}s)
        </p>
      </div>
      <CameraFeed />
      <button
        className="mt-2 mx-auto block rounded-full px-8 py-3.5 bg-black hover:bg-neutral-800 text-white font-semibold text-sm transition-colors"
        onClick={goToStart}
      >
        Back to Start
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
