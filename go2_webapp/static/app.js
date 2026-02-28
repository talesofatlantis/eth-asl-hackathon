const { useEffect, useMemo, useRef, useState } = React;
const MOVE_DURATION_SECONDS = 20;
const MOVE_NUDGE_MS = 350;
const MAX_WORKOUT_EXERCISES = 5;

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
    <div className="camera-panel">
      <div className="camera-status">{status}</div>
      {imageUrl ? (
        <img src={imageUrl} alt="Robot dog camera feed" />
      ) : (
        <div className="no-feed">
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
  const [robotCommandStatus, setRobotCommandStatus] = useState("Robot controls ready");
  const [autoPlayMoves, setAutoPlayMoves] = useState(false);
  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState("Click Enable Voice once");
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceDebug, setVoiceDebug] = useState("Voice debug idle");
  const [customPrompt, setCustomPrompt] = useState("");
  const [customStatus, setCustomStatus] = useState("Describe your goals and generate a custom workout.");
  const [customWorkoutReason, setCustomWorkoutReason] = useState("");
  const [isListening, setIsListening] = useState(false);
  const lastTriggeredSlotRef = useRef(-1);
  const lastSpokenSlotRef = useRef(-1);
  const lastStepPromptRef = useRef("");
  const completionVoicePlayedRef = useRef(false);
  const recognitionRef = useRef(null);
  const speechSeqRef = useRef(0);
  const preferredVoiceRef = useRef(null);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const pickLocalVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const local = voices.filter((v) => v.localService);
      const enLocal = local.filter((v) => /^en/.test(v.lang));
      const voice = enLocal[0] || local[0] || voices[0];
      if (voice) {
        preferredVoiceRef.current = voice;
        console.log("[Robogym] Using voice:", voice.name, "local=", !!voice.localService);
      }
    };
    pickLocalVoice();
    window.speechSynthesis.onvoiceschanged = pickLocalVoice;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const debugVoice = (message) => {
    const stamp = new Date().toLocaleTimeString();
    setVoiceDebug(
      `${stamp} | ${message} | ready=${voiceReady} speaking=${
        "speechSynthesis" in window ? window.speechSynthesis.speaking : "n/a"
      } pending=${"speechSynthesis" in window ? window.speechSynthesis.pending : "n/a"}`
    );
  };

  const speakText = (text, options = {}) => {
    if (!("speechSynthesis" in window)) {
      setVoiceStatus("Speech not supported in this browser");
      debugVoice("speechSynthesis unavailable");
      return;
    }
    const bypassLock = options.bypassLock === true;
    if (!bypassLock && !voiceReady) {
      setVoiceStatus("Voice locked. Click Enable Voice.");
      debugVoice("speak blocked: voiceReady=false");
      return;
    }
    debugVoice(`speak requested: "${text}"`);
    speechSeqRef.current += 1;
    const seq = speechSeqRef.current;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (preferredVoiceRef.current) utterance.voice = preferredVoiceRef.current;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.onstart = () => {
      if (seq !== speechSeqRef.current) return;
      setVoiceStatus("Voice speaking");
      debugVoice("utterance onstart");
    };
    utterance.onend = () => {
      if (seq !== speechSeqRef.current) return;
      setVoiceStatus("Voice guidance active");
      debugVoice("utterance onend");
    };
    utterance.onerror = (event) => {
      if (seq !== speechSeqRef.current) return;
      const err = String(event?.error || "").toLowerCase();
      if (err === "interrupted" || err === "canceled" || err === "cancelled") {
        setVoiceStatus("Voice guidance active");
        debugVoice(`utterance benign error: ${err}`);
        return;
      }
      setVoiceStatus(`Voice playback failed: ${err || "unknown error"}`);
      debugVoice(`utterance error: ${err || "unknown"}`);
    };
    window.speechSynthesis.speak(utterance);
    setVoiceStatus("Voice guidance active");
    debugVoice("utterance submitted to speechSynthesis");
  };

  const enableVoice = () => {
    if (!("speechSynthesis" in window)) {
      setVoiceStatus("Speech not supported in this browser");
      debugVoice("enable failed: speechSynthesis unavailable");
      return;
    }
    window.speechSynthesis.resume();
    setVoiceReady(true);
    setVoiceStatus("Voice enabled");
    debugVoice("enable voice clicked");
    if (step === "start" && voiceGuidanceEnabled) {
      const startLine = VOICE_CONFIG.global?.startPrompt || "Click start to start the workout.";
      setTimeout(() => speakText(startLine), 150);
    }
  };

  const runSimpleVoiceTest = () => {
    const needEnable = !voiceReady && "speechSynthesis" in window;
    if (needEnable) {
      window.speechSynthesis.resume();
      setVoiceReady(true);
      setVoiceStatus("Voice enabled");
      debugVoice("auto-enabled from Speak Test Line click");
    }
    const line = VOICE_CONFIG.global?.simpleVoiceTestPrompt || "This is a simple voice test from Robogym.";
    speakText(line, needEnable ? { bypassLock: true } : {});
  };

  const trainerVoiceStyle = useMemo(() => {
    if (!selectedTrainer) return null;
    return VOICE_CONFIG.trainers?.[selectedTrainer.id] || null;
  }, [selectedTrainer]);

  const workoutVoiceStyle = useMemo(() => {
    if (!selectedWorkout) return null;
    return VOICE_CONFIG.workouts?.[selectedWorkout.id] || null;
  }, [selectedWorkout]);

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

  const nextMove = useMemo(() => {
    if (workoutMoves.length === 0) return "No next move";
    return workoutMoves[(currentMoveIndex + 1) % workoutMoves.length];
  }, [workoutMoves, currentMoveIndex]);

  const workoutTotalSeconds = useMemo(
    () => MAX_WORKOUT_EXERCISES * MOVE_DURATION_SECONDS,
    []
  );

  const isWorkoutComplete = useMemo(
    () => step === "workout" && elapsedSeconds >= workoutTotalSeconds,
    [step, elapsedSeconds, workoutTotalSeconds]
  );

  const beginCountdown = () => {
    setCountdownValue(3);
    setStep("countdown");
  };

  const goToStart = () => {
    stopListening();
    setSelectedWorkout(null);
    setSelectedTrainer(null);
    setCountdownValue(3);
    setWorkoutStartedAtMs(null);
    setClockMs(Date.now());
    setAutoPlayMoves(false);
    setVoiceGuidanceEnabled(true);
    setVoiceStatus("Click Enable Voice once");
    setVoiceReady(false);
    lastTriggeredSlotRef.current = -1;
    lastSpokenSlotRef.current = -1;
    lastStepPromptRef.current = "";
    completionVoicePlayedRef.current = false;
    setCustomPrompt("");
    setCustomWorkoutReason("");
    setCustomStatus("Describe your goals and generate a custom workout.");
    setIsListening(false);
    setStep("start");
  };

  const runAction = async (name) => {
    try {
      setRobotCommandStatus(`Sending action: ${name}...`);
      const result = await sendRobotCommand("action", { name });
      setRobotCommandStatus(result.msg || `${name} sent`);
    } catch (err) {
      setRobotCommandStatus(`Action failed: ${err.message}`);
    }
  };

  const sendStop = async () => {
    try {
      setRobotCommandStatus("Stopping...");
      const result = await sendRobotCommand("stop");
      setRobotCommandStatus(result.msg || "stopped");
    } catch (err) {
      setRobotCommandStatus(`Stop failed: ${err.message}`);
    }
  };

  const nudgeMove = async (vx, vy, vyaw = 0) => {
    try {
      setRobotCommandStatus("Sending movement...");
      await sendRobotCommand("move", { vx, vy, vyaw });
      setTimeout(() => {
        sendRobotCommand("stop").catch(() => {});
      }, MOVE_NUDGE_MS);
      setRobotCommandStatus("Movement nudge sent");
    } catch (err) {
      setRobotCommandStatus(`Move failed: ${err.message}`);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  const startListening = () => {
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setCustomStatus("Speech recognition is not supported in this browser.");
      return;
    }
    recognitionRef.current = recognition;
    recognition.onstart = () => {
      setIsListening(true);
      setCustomStatus("Listening...");
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      setCustomPrompt(transcript);
    };
    recognition.onerror = (event) => {
      setCustomStatus(`Speech recognition error: ${event.error}`);
    };
    recognition.onend = () => {
      setIsListening(false);
      if (customPrompt.trim()) {
        setCustomStatus("Speech captured. Generate your custom workout.");
      }
    };
    recognition.start();
  };

  const generateCustomWorkout = async () => {
    const prompt = customPrompt.trim();
    if (!prompt) {
      setCustomStatus("Please speak or type a custom workout request first.");
      return;
    }
    try {
      setCustomStatus("Generating custom workout with Gemini...");
      const workout = await requestCustomWorkout(prompt);
      setSelectedWorkout(workout);
      setCustomWorkoutReason(workout.reason || "");
      setCustomStatus("Custom workout ready. Choose your trainer.");
      setStep("trainer-select");
      if (voiceGuidanceEnabled) {
        speakText("Custom workout generated. Now choose your coach.");
      }
    } catch (err) {
      setCustomStatus(`Custom workout failed: ${err.message}`);
    }
  };

  useEffect(() => {
    lastTriggeredSlotRef.current = -1;
    lastSpokenSlotRef.current = -1;
    lastStepPromptRef.current = "";
    if (step !== "finished") {
      completionVoicePlayedRef.current = false;
    }
  }, [selectedWorkout, step, autoPlayMoves, voiceGuidanceEnabled]);

  useEffect(() => {
    if (step !== "workout" || isWorkoutComplete || !autoPlayMoves || workoutMoves.length === 0) return;
    if (lastTriggeredSlotRef.current === currentMoveSlot) return;
    lastTriggeredSlotRef.current = currentMoveSlot;
    const moveName = workoutMoves[currentMoveIndex];
    if (!moveName) return;
    runAction(moveName);
  }, [step, isWorkoutComplete, autoPlayMoves, workoutMoves, currentMoveIndex, currentMoveSlot]);

  useEffect(() => {
    if (step !== "workout" || isWorkoutComplete || !voiceGuidanceEnabled || workoutMoves.length === 0) return;
    if (lastSpokenSlotRef.current === currentMoveSlot) return;
    lastSpokenSlotRef.current = currentMoveSlot;
    const currentLabel = formatMoveName(currentMove);
    const nextLabel = formatMoveName(nextMove);
    const template = trainerVoiceStyle?.moveLine || VOICE_CONFIG.global?.moveFallbackLine;
    const line = renderTemplate(template, {
      current: currentLabel,
      next: nextLabel,
      seconds: MOVE_DURATION_SECONDS,
      trainerName: selectedTrainer?.name || "Coach",
    });
    speakText(line);
  }, [step, isWorkoutComplete, voiceGuidanceEnabled, workoutMoves, currentMoveSlot, currentMove, nextMove, trainerVoiceStyle, selectedTrainer]);

  useEffect(() => {
    if (!isWorkoutComplete) return;
    setStep("finished");
    setAutoPlayMoves(false);
    sendRobotCommand("stop").catch(() => {});
  }, [isWorkoutComplete]);

  useEffect(() => {
    if (step !== "finished" || !voiceGuidanceEnabled) return;
    if (completionVoicePlayedRef.current) return;
    completionVoicePlayedRef.current = true;
    const trainerName = selectedTrainer ? selectedTrainer.name : "Coach";
    const trainerLine = trainerVoiceStyle?.completionLine;
    const fallbackLine = VOICE_CONFIG.global?.completionPrompt;
    const completionLine = renderTemplate(trainerLine || fallbackLine, {
      trainerName,
      seconds: MOVE_DURATION_SECONDS,
      current: formatMoveName(currentMove),
      next: formatMoveName(nextMove),
    });
    speakText(completionLine);
  }, [step, voiceGuidanceEnabled, selectedTrainer, trainerVoiceStyle, currentMove, nextMove]);

  useEffect(() => {
    if (!voiceGuidanceEnabled || !voiceReady) return;

    let prompt = "";
    if (step === "start") {
      prompt = VOICE_CONFIG.global?.startPrompt || "";
    } else if (step === "workout-select") {
      prompt = VOICE_CONFIG.global?.workoutSelectPrompt || "";
    } else if (step === "custom-workout") {
      prompt = VOICE_CONFIG.global?.customWorkoutPrompt || "";
    } else if (step === "trainer-select") {
      prompt = VOICE_CONFIG.global?.trainerSelectPrompt || "";
    } else if (step === "instructions" && selectedTrainer) {
      const trainerIntro = renderTemplate(
        trainerVoiceStyle?.intro || "{{trainerName}} here.",
        { trainerName: selectedTrainer.name }
      );
      const workoutName = selectedWorkout?.label || "this workout";
      const workoutIntro = renderTemplate(
        workoutVoiceStyle?.intro || VOICE_CONFIG.global?.workoutIntroFallback || "",
        { workoutName }
      );
      prompt = renderTemplate(VOICE_CONFIG.global?.instructionsPrompt || "", {
        trainerIntro,
        workoutIntro,
        trainerName: selectedTrainer.name,
        workoutName,
      });
    } else if (step === "finished") {
      prompt = VOICE_CONFIG.global?.completionPrompt || "";
    }

    const promptKey = `${step}:${selectedTrainer ? selectedTrainer.id : "none"}`;
    if (!prompt || lastStepPromptRef.current === promptKey) return;
    lastStepPromptRef.current = promptKey;
    speakText(prompt);
  }, [step, selectedTrainer, selectedWorkout, voiceGuidanceEnabled, voiceReady, trainerVoiceStyle, workoutVoiceStyle]);

  useEffect(() => {
    if (step !== "custom-workout" && isListening) {
      stopListening();
      setIsListening(false);
    }
  }, [step, isListening]);

  if (step === "start") {
    return (
      <div className="screen center-screen">
        <h1 className="app-title">ROBOGYM</h1>
        <p className="subtitle">Train with your robot dog coach</p>
        <button
          className="secondary-btn"
          onClick={() => {
            setVoiceReady(false);
            setVoiceStatus("Click Enable Voice once");
            setStep("voice-test");
          }}
        >
          Simple Voice Test
        </button>
        <button className="secondary-btn" onClick={enableVoice}>
          Enable Voice
        </button>
        <p className="robot-status">{voiceStatus}</p>
        <button className="primary-btn" onClick={() => setStep("workout-select")}>
          Start Workout
        </button>
      </div>
    );
  }

  if (step === "voice-test") {
    return (
      <div className="screen center-screen">
        <h2 className="screen-title">Simple Voice Test</h2>
        <p className="subtitle">This mode only checks browser speech.</p>
        <button className="secondary-btn" onClick={enableVoice}>
          Enable Voice
        </button>
        <button className="primary-btn" onClick={runSimpleVoiceTest}>
          Speak Test Line
        </button>
        <p className="robot-status">{voiceStatus}</p>
        <p className="voice-note">{voiceDebug}</p>
        <details className="voice-troubleshoot">
          <summary>No sound? Check these settings</summary>
          <ul>
            <li><strong>Tab not muted</strong> — Right-click the tab → ensure "Mute site" is unchecked</li>
            <li><strong>System volume</strong> — Mac: menu bar volume / System Settings → Sound</li>
            <li><strong>Chrome audio</strong> — Settings → Privacy and security → Site settings → Sound → allow sites to play sound</li>
            <li><strong>Use Safari</strong> — If Chrome fails, try Safari (native voices are more reliable)</li>
          </ul>
        </details>
        <button className="secondary-btn" onClick={() => setStep("start")}>
          Back
        </button>
      </div>
    );
  }

  if (step === "workout-select") {
    return (
      <div className="screen">
        <h2 className="screen-title">Select Your Workout</h2>
        <div className="tile-grid">
          {WORKOUTS.map((workout) => (
            <button
              key={workout.id}
              className="tile"
              onClick={() => {
                setCustomWorkoutReason("");
                setSelectedWorkout(workout);
                setStep("trainer-select");
              }}
            >
              {workout.label}
            </button>
          ))}
          <button
            className="tile"
            onClick={() => {
              setCustomStatus("Describe your goals and generate a custom workout.");
              setStep("custom-workout");
            }}
          >
            Custom Workout
          </button>
        </div>
      </div>
    );
  }

  if (step === "custom-workout") {
    return (
      <div className="screen center-screen">
        <h2 className="screen-title">Custom Workout</h2>
        <div className="info-card">
          <p>Tell us what you want, and Gemini will create a 5-exercise workout.</p>
          <textarea
            className="custom-input"
            value={customPrompt}
            onChange={(ev) => setCustomPrompt(ev.target.value)}
            placeholder="Example: I want a low-impact workout for legs and balance."
          />
          <p className="meta-line">{customStatus}</p>
        </div>
        <div className="custom-actions">
          <button className="secondary-btn" onClick={startListening}>
            {isListening ? "Listening..." : "Speak Request"}
          </button>
          <button className="secondary-btn" onClick={stopListening}>
            Stop Mic
          </button>
          <button className="primary-btn" onClick={generateCustomWorkout}>
            Generate Workout
          </button>
        </div>
        <button className="secondary-btn" onClick={() => setStep("workout-select")}>
          Back
        </button>
      </div>
    );
  }

  if (step === "trainer-select") {
    return (
      <div className="screen">
        <h2 className="screen-title">Select Your Trainer</h2>
        <div className="tile-grid">
          {TRAINERS.map((trainer) => (
            <button
              key={trainer.id}
              className="tile trainer-tile"
              onClick={() => {
                setSelectedTrainer(trainer);
                setStep("instructions");
              }}
            >
              <span className="tile-title">{trainer.name}</span>
              <span className="tile-subtitle">{trainer.tagline}</span>
            </button>
          ))}
        </div>
        <button className="secondary-btn" onClick={() => setStep("workout-select")}>
          Back
        </button>
      </div>
    );
  }

  if (step === "instructions") {
    return (
      <div className="screen center-screen">
        <h2 className="screen-title">Instructions</h2>
        <div className="info-card">
          <p>1. Follow the voice instructions.</p>
          <p>2. The dog will demonstrate.</p>
          <p className="meta-line">
            Workout: <strong>{selectedWorkout ? selectedWorkout.label : "Not selected"}</strong>
          </p>
          <p className="meta-line">
            Trainer: <strong>{selectedTrainer ? selectedTrainer.name : "Not selected"}</strong>
          </p>
          {customWorkoutReason ? (
            <p className="meta-line">
              Custom goal: <strong>{customWorkoutReason}</strong>
            </p>
          ) : null}
          <p className="meta-line">
            Planned moves:
          </p>
          <ul className="moves-list">
            {workoutMoves.map((move) => (
              <li key={move}>{move}</li>
            ))}
          </ul>
        </div>
        <button className="primary-btn" onClick={beginCountdown}>
          Start in 3...
        </button>
      </div>
    );
  }

  if (step === "countdown") {
    return (
      <div className="screen center-screen">
        <h2 className="screen-title">Get Ready</h2>
        <div className="countdown-circle">{countdownValue}</div>
      </div>
    );
  }

  if (step === "finished") {
    return (
      <div className="screen center-screen">
        <h2 className="screen-title">Workout Complete</h2>
        <p className="subtitle">Great job! You completed 5 exercises.</p>
        <button className="primary-btn" onClick={goToStart}>
          Back to Start
        </button>
      </div>
    );
  }

  return (
    <div className="screen workout-screen">
      <div className="workout-header">
        <h2 className="exercise-title">{workoutTitle}</h2>
        <p className="current-exercise-line">
          Current exercise: <strong>{formatMoveName(currentMove)}</strong> ({moveSecondsLeft}s)
        </p>
        <p className="next-exercise-line">
          Next exercise: <strong>{formatMoveName(nextMove)}</strong>
        </p>
      </div>
      <CameraFeed />
      <div className="control-panel">
        <div className="control-title">Robot Controls</div>
        <label className="autoplay-toggle">
          <input
            type="checkbox"
            checked={voiceGuidanceEnabled}
            onChange={(ev) => {
              const enabled = ev.target.checked;
              setVoiceGuidanceEnabled(enabled);
              setVoiceStatus(enabled ? "Voice guidance on" : "Voice guidance off");
              lastStepPromptRef.current = "";
              if (!enabled && "speechSynthesis" in window) {
                window.speechSynthesis.cancel();
              } else if (enabled) {
                speakText(VOICE_CONFIG.global?.voiceEnabledPrompt || "Voice guidance enabled.");
              }
            }}
          />
          Voice guidance
        </label>
        <button className="control-btn voice-test-btn" onClick={enableVoice}>
          Enable Voice
        </button>
        <p className="robot-status">{voiceStatus}</p>
        <label className="autoplay-toggle">
          <input
            type="checkbox"
            checked={autoPlayMoves}
            onChange={(ev) => setAutoPlayMoves(ev.target.checked)}
          />
          Auto-play workout moves every 20s
        </label>
        <div className="control-actions">
          <button className="control-btn" onClick={() => runAction("stand_up")}>Stand Up</button>
          <button className="control-btn" onClick={() => runAction("sit")}>Sit</button>
          <button className="control-btn" onClick={() => runAction("hello")}>Hello</button>
          <button className="control-btn control-stop" onClick={sendStop}>STOP</button>
        </div>
        <div className="control-title">Movement Nudges</div>
        <div className="nudge-grid">
          <button className="control-btn" onClick={() => nudgeMove(0.3, 0)}>Forward</button>
          <button className="control-btn" onClick={() => nudgeMove(0, 0.3)}>Left</button>
          <button className="control-btn" onClick={() => nudgeMove(0, -0.3)}>Right</button>
          <button className="control-btn" onClick={() => nudgeMove(-0.3, 0)}>Back</button>
        </div>
        <p className="robot-status">{robotCommandStatus}</p>
      </div>
      <button className="secondary-btn" onClick={goToStart}>
        Back to Start
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
