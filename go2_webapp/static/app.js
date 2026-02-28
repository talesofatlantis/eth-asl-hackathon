const { useEffect, useMemo, useState } = React;
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

  const moveSecondsLeft = useMemo(() => {
    if (workoutMoves.length === 0) return MOVE_DURATION_SECONDS;
    const secondsIntoMove = elapsedSeconds % MOVE_DURATION_SECONDS;
    return MOVE_DURATION_SECONDS - secondsIntoMove;
  }, [workoutMoves, elapsedSeconds]);

  const currentMove = useMemo(() => {
    if (workoutMoves.length === 0) return "No move selected";
    return workoutMoves[currentMoveIndex] || workoutMoves[0];
  }, [workoutMoves, currentMoveIndex]);

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

  if (step === "start") {
    return (
      <div className="screen center-screen">
        <h1 className="app-title">ROBOGYM</h1>
        <p className="subtitle">Train with your robot dog coach</p>
        <button className="primary-btn" onClick={() => setStep("workout-select")}>
          Start Workout
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

  return (
    <div className="screen workout-screen">
      <div className="workout-header">
        <h2 className="exercise-title">{workoutTitle}</h2>
        <p className="current-exercise-line">
          Current exercise: <strong>{currentMove}</strong> ({moveSecondsLeft}s)
        </p>
      </div>
      <CameraFeed />
      <button className="secondary-btn" onClick={goToStart}>
        Back to Start
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
