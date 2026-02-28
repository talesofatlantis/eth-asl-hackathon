const { useEffect, useMemo, useRef, useState } = React;
const MOVE_DURATION_SECONDS = 5;
const MOVE_NUDGE_MS = 350;
const MAX_WORKOUT_EXERCISES = 11;

const DEFAULT_WORKOUTS = [
  {
    id: "yoga-relax",
    label: "Relaxed",
    exerciseName: "Gentle Yoga Flow",
    moves: ["stretch", "hello", "sit", "stand_up", "heart"],
  },
  {
    id: "full-body",
    label: "Advanced",
    exerciseName: "Full Body Activation",
    moves: ["stand_up", "balance_stand", "front_jump", "recovery_stand", "stop_move"],
  },
  {
    id: "hardcode",
    label: "Hardcore",
    exerciseName: "Hardcore Power Set",
    moves: ["dance1", "dance2", "front_flip", "back_flip", "left_flip", "hand_stand"],
  },
];

const WORKOUTS = Array.isArray(window.ROBOGYM_WORKOUTS) ? window.ROBOGYM_WORKOUTS : DEFAULT_WORKOUTS;

const TRAINERS = [
  { id: "coach-rio", name: "Coach Rio", tagline: "Calm and focused" },
  { id: "captain-nova", name: "Captain Nova", tagline: "Energetic and motivating" },
  { id: "dr-blaze", name: "Dr. Blaze", tagline: "High-intensity challenge" },
];

const DEFAULT_VOICE_CONFIG = {
  global: {
    startPrompt: "Click start to start the workout.",
    simpleVoiceTestPrompt: "This is a simple voice test from Robogym.",
    workoutSelectPrompt: "Choose your workout.",
    customWorkoutPrompt: "Describe your goal. Then generate your custom workout.",
    trainerSelectPrompt: "Choose your coach.",
    instructionsPrompt:
      "{{trainerIntro}} {{workoutIntro}} Follow the voice instructions, and the dog will demonstrate.",
    completionPrompt: "Workout complete. Congratulations.",
    voiceEnabledPrompt: "Voice guidance enabled.",
    moveFallbackLine: "Now: {{current}}. Next: {{next}} in {{seconds}} seconds.",
    workoutIntroFallback: "Today we are doing {{workoutName}}.",
  },
  trainers: {},
  workouts: {},
};

const VOICE_CONFIG = window.ROBOGYM_VOICE_CONFIG || DEFAULT_VOICE_CONFIG;

async function sendRobotCommand(cmd, params) {
  const body = { cmd };
  if (params) body.params = params;
  const resp = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp.json();
}

async function requestCustomWorkout(prompt) {
  const resp = await fetch("/api/custom_workout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.ok) {
    throw new Error(data.msg || `HTTP ${resp.status}`);
  }
  return data.workout;
}

function formatMoveName(move) {
  if (!move) return "";
  return move.replace(/_/g, " ");
}

function renderTemplate(template, values) {
  if (typeof template !== "string") return "";
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

function createSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;
  return recognition;
}

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
  const [coachSlide, setCoachSlide] = useState(0); // 0 = intro, 1 = chat (onboarding-style)
  const [workoutCommandStatus, setWorkoutCommandStatus] = useState("");
  const lastExecutedMoveIndexRef = useRef(-1);
  const standUpSentRef = useRef(false);
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

  const currentMoveSlot = useMemo(() => {
    if (workoutMoves.length === 0) return 0;
    return Math.floor(elapsedSeconds / MOVE_DURATION_SECONDS);
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

  // Reset when leaving workout so next run sends from index 0 and sends stand_up again.
  useEffect(() => {
    if (step !== "workout") {
      lastExecutedMoveIndexRef.current = -1;
      standUpSentRef.current = false;
      setWorkoutCommandStatus("");
    }
  }, [step]);

  // When workout starts, send stand_up once so the robot is standing before the first exercise.
  useEffect(() => {
    if (step !== "workout" || workoutMoves.length === 0 || standUpSentRef.current) return;
    standUpSentRef.current = true;
    fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "action", params: { name: "stand_up" } }),
    })
      .then((r) => r.json())
      .then((d) => setWorkoutCommandStatus(d.ok ? "Robot standing…" : d.msg || "Stand sent"))
      .catch((err) => setWorkoutCommandStatus("Stand failed: " + err.message));
  }, [step, workoutMoves.length]);

  const MOVE_BACKWARD_MS = 700;
  const MOVE_BACKWARD_PAUSE_MS = 150;
  const MOVE_BACKWARD_COUNT = 10;
  const MOVE_BACKWARD_VX = -0.3;

  // Send the current move to the robot when the workout is active and the move index changes.
  useEffect(() => {
    if (step !== "workout" || workoutMoves.length === 0) return;
    if (currentMoveIndex === lastExecutedMoveIndexRef.current) return;
    lastExecutedMoveIndexRef.current = currentMoveIndex;
    const moveName = workoutMoves[currentMoveIndex];
    setWorkoutCommandStatus("Sending: " + moveName + "…");

    if (moveName === "move_backward") {
      let count = 0;
      let cancelled = false;
      const timers = [];

      const runCycle = () => {
        if (cancelled || count >= MOVE_BACKWARD_COUNT) {
          if (!cancelled) {
            fetch("/api/command", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cmd: "stop" }),
            }).then((r) => r.json()).then((d) => setWorkoutCommandStatus(d.ok ? "Sent: move_backward (x10)" : d.msg || "Stop failed"));
          }
          return;
        }
        setWorkoutCommandStatus("Moving backward " + (count + 1) + "/" + MOVE_BACKWARD_COUNT + "…");
        fetch("/api/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: "move", params: { vx: MOVE_BACKWARD_VX, vy: 0, vyaw: 0 } }),
        });
        const t1 = setTimeout(() => {
          if (cancelled) return;
          fetch("/api/command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cmd: "stop" }),
          });
          count++;
          const t2 = setTimeout(runCycle, MOVE_BACKWARD_PAUSE_MS);
          timers.push(t2);
        }, MOVE_BACKWARD_MS);
        timers.push(t1);
      };

      runCycle();
      return () => {
        cancelled = true;
        fetch("/api/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: "stop" }),
        }).catch(() => {});
        timers.forEach((id) => clearTimeout(id));
      };
    }

    fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "action", params: { name: moveName } }),
    })
      .then((r) => r.json())
      .then((d) => setWorkoutCommandStatus(d.ok ? "Sent: " + moveName : "Error: " + (d.msg || "unknown")))
      .catch((err) => {
        console.error("Failed to send move to robot:", err);
        setWorkoutCommandStatus("Failed: " + err.message);
      });
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
    setCoachSlide(0);
    setStep("start");
  };

  const screenBase = "min-h-screen max-w-4xl mx-auto px-8 md:px-10 py-12 md:py-16";
  const cardBaseClass = "relative grid h-full w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-900 shadow-sm transition-all duration-300 ease-in-out group cursor-pointer text-left";

  if (step === "start") {
    return (
      <div className={`${screenBase} pt-24 flex min-h-screen flex-col items-center justify-center`}>
        <h1 className="font-heading text-xl md:text-2xl font-bold tracking-tight text-neutral-900 fixed top-0 left-0 p-6 md:p-8 z-10">ROBOGYM</h1>
        <div className="flex flex-1 w-full flex-col items-center justify-center">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-10 w-full max-w-3xl mx-auto">
          {WORKOUTS.map((workout, idx) => (
            <button
              key={workout.id}
              type="button"
              className={`${cardBaseClass} aspect-[3/4] min-h-[200px] hover:border-neutral-400 hover:shadow-md active:scale-[0.98]`}
              onClick={() => {
                setSelectedWorkout(workout);
                setStep("trainer-select");
              }}
            >
              {idx === 0 ? (
                <div
                  className="absolute inset-0 transition-transform duration-500 ease-in-out group-hover:scale-105"
                  style={{
                    backgroundImage: "url(https://images.unsplash.com/photo-1633707744005-7a84dbe0035a?q=80&w=1287&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D)",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-b from-neutral-700 to-neutral-900 transition-transform duration-500 ease-in-out group-hover:scale-105" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
              <div className="relative z-10 flex h-full flex-col justify-end p-5 text-white transition-transform duration-300 ease-in-out group-hover:-translate-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-300">Mode</p>
                <h2 className="mt-1 text-xl font-bold leading-tight tracking-tight text-white md:text-2xl">
                  {workout.label}
                </h2>
              </div>
            </button>
          ))}
          </div>
        </div>
        <div className="w-full max-w-2xl flex items-end gap-4">
          <div className="relative shrink-0 self-center">
            <img src="/robot-logo.png" alt="" className="h-24 md:h-28 w-auto object-contain" />
            <div
              className="absolute inset-0 pointer-events-none rounded-lg"
              style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, transparent 18%)' }}
              aria-hidden
            />
          </div>
          <div className="flex-1 min-w-0 p-6 bg-white border border-neutral-200 rounded-2xl">
          <h3 className="font-heading text-base font-semibold text-neutral-900 mb-3">Robocoach</h3>
          <div className="overflow-hidden">
            {coachSlide === 0 && (
              <p className="text-neutral-700 text-[15px] leading-relaxed mb-4">
                Hey, I&apos;m Robodog, your new fitness coach. I can support you with questions &amp; cheer for you, and guide you.
              </p>
            )}
            {coachSlide === 1 && (
              agentAvailable === false ? (
            <p className="text-sm text-neutral-500">
              Add <code className="bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-700">GEMINI_API_KEY</code> to <code className="bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-700">.env</code> at project root to enable Robocoach.
            </p>
          ) : (
              <>
              <div className="flex gap-3 mb-3">
                <input
                  type="text"
                  className="flex-1 px-4 py-2.5 border border-neutral-200 rounded-xl bg-neutral-50 text-neutral-900 placeholder-neutral-400 text-[15px] focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900 outline-none transition-shadow"
                  placeholder="e.g. Ask a workout question"
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
          )
            )}
          </div>
          <div className="flex justify-center gap-2 mt-4">
            {[0, 1].map((i) => (
              <button
                key={i}
                type="button"
                aria-label={i === 0 ? "Intro" : "Chat"}
                onClick={() => setCoachSlide(i)}
                className="h-1 rounded-full min-w-[24px] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1"
                style={{ width: i === coachSlide ? 32 : 24, backgroundColor: i === coachSlide ? "#171717" : "#d4d4d4" }}
              />
            ))}
          </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === "trainer-select") {
    return (
      <div className={`${screenBase} flex min-h-screen flex-col items-center justify-center`}>
        <h2 className="font-heading text-center mb-10 text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">Select Your Trainer</h2>
        <div className="flex w-full flex-1 items-center justify-center">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full max-w-3xl mx-auto">
          {TRAINERS.map((trainer) => (
            <button
              key={trainer.id}
              type="button"
              className={`${cardBaseClass} aspect-[3/4] min-h-[200px] hover:border-neutral-400 hover:shadow-md active:scale-[0.98] flex flex-col justify-end items-start`}
              onClick={() => {
                setSelectedTrainer(trainer);
                setStep("instructions");
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-neutral-600 to-neutral-800 transition-transform duration-500 ease-in-out group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
              <div className="relative z-10 p-5 text-white transition-transform duration-300 ease-in-out group-hover:-translate-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-300">Coach</p>
                <h2 className="mt-1 font-heading text-xl font-bold leading-tight tracking-tight text-white md:text-2xl">
                  {trainer.name}
                </h2>
                <span className="mt-1.5 block text-sm font-medium text-neutral-400">{trainer.tagline}</span>
              </div>
            </button>
          ))}
          </div>
        </div>
        <button
          className="mt-10 mx-auto block rounded-full px-8 py-3.5 bg-black hover:bg-neutral-800 text-white font-semibold text-sm transition-colors"
          onClick={() => setStep("start")}
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

  if (step === "finished") {
    return (
      <div className={`${screenBase} flex flex-col justify-center items-center gap-8`}>
        <h2 className="font-heading text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">Workout Complete</h2>
        <p className="text-neutral-500 text-base">Great job! You completed 5 exercises.</p>
        <button
          className="rounded-full px-8 py-3.5 bg-black hover:bg-neutral-800 text-white font-semibold text-sm transition-colors"
          onClick={goToStart}
        >
          Back to Start
        </button>
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
        {workoutCommandStatus && (
          <p className="mt-1 text-sm text-neutral-600 font-medium">
            {workoutCommandStatus}
          </p>
        )}
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
