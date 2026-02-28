// Edit this file to customize all spoken text/personality.
// Available placeholders:
// - {{trainerName}}  {{current}}  {{next}}  {{seconds}}  {{trainerIntro}}  {{workoutIntro}}  {{workoutName}}
window.ROBOGYM_VOICE_CONFIG = {
  global: {
    startPrompt: "Click start to start the workout.",
    simpleVoiceTestPrompt: "This is a simple voice test from Robogym.",
    workoutSelectPrompt: "Choose your workout.",
    customWorkoutPrompt: "Describe your goal. Then generate your custom workout.",
    trainerSelectPrompt: "Choose your intensity.",
    instructionsPrompt:
      "{{trainerIntro}} {{workoutIntro}} Follow the voice instructions, and the dog will demonstrate.",
    completionPrompt: "Workout complete. Congratulations.",
    voiceEnabledPrompt: "Voice guidance enabled.",
    moveFallbackLine: "Now: {{current}}. Next: {{next}} in {{seconds}} seconds.",
    workoutIntroFallback: "Today we are doing {{workoutName}}.",
  },
  trainers: {
    "intensity-low": {
      intro: "Low intensity. Stay calm and controlled.",
      moveLine:
        "Breathe and focus. Now: {{current}}. Next: {{next}} in {{seconds}} seconds.",
      completionLine:
        "Great control today. Workout complete.",
    },
    "intensity-medium": {
      intro: "Medium intensity. Let's go, you've got this.",
      moveLine:
        "Steady pace. Now: {{current}}. Next: {{next}} in {{seconds}} seconds.",
      completionLine:
        "Nice work. Workout complete.",
    },
    "intensity-high": {
      intro: "High intensity. Time to push hard.",
      moveLine:
        "Intensity on. Now: {{current}}. Next: {{next}} in {{seconds}} seconds. Stay strong.",
      completionLine:
        "Outstanding effort. Workout complete.",
    },
  },
  workouts: {
    "yoga-relax": {
      intro: "Welcome to Guided Session. This workout is all about smooth movement and breathing.",
    },
    "full-body": {
      intro: "Welcome to Full Body. We will wake up your whole body with strong balanced moves.",
    },
    "hardcode": {
      intro: "Welcome to Hardcode. This is a high-energy challenge, so stay sharp and focused.",
    },
  },
};
