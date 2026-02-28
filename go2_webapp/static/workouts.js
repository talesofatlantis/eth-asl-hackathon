// Edit this file to control which moves belong to each workout.
// The names in "moves" must match the action names supported by go2_bridge.
window.ROBOGYM_WORKOUTS = [
  {
    id: "yoga-relax",
    label: "Guided Session",
    exerciseName: "Gentle Yoga Flow",
    moves: ["hello", "stand_up", "stretch", "stretch", "stretch", "hello", "sit", "balance_stand", "stand_up", "heart","dance2", "back_flip"]
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