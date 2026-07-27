export const goals = [
  {
    id: "discipline",
    label: "More disciplined",
    intent: "discipline",
    topics: ["deep work", "fitness consistency", "habit systems", "sleep hygiene", "study routines"],
    actions: ["save practical routines", "follow credible operators", "hide outrage loops", "comment on process notes"]
  },
  {
    id: "recipes",
    label: "More recipes",
    intent: "recipes",
    topics: ["high-protein meals", "regional cooking", "quick dinners", "meal prep", "food science"],
    actions: ["save recipe posts", "watch full cooking demos", "follow test kitchens", "search ingredient swaps"]
  },
  {
    id: "founder",
    label: "Sharper founder brain",
    intent: "founder",
    topics: ["customer discovery", "distribution", "pricing", "product strategy", "fundraising mechanics"],
    actions: ["follow operators", "save teardown threads", "mute vague hustle content", "search case studies"]
  },
  {
    id: "calm",
    label: "Calmer feed",
    intent: "calm",
    topics: ["mindfulness", "slow productivity", "long-form essays", "nature walks", "digital minimalism"],
    actions: ["pause autoplay", "hide rage bait", "save reflective posts", "follow low-noise creators"]
  }
];

export function createPlan({ goalId, horizonDays = 14, intensity = 3, avoid = "" }) {
  const goal = goals.find((item) => item.id === goalId) || goals[0];
  const avoidTerms = avoid
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const dailyCount = Math.min(5, Math.max(2, Number(intensity) + 1));
  const prompts = goal.topics.slice(0, dailyCount).map((topic, index) => ({
    title: topic,
    prompt: `Search, save, or intentionally engage with ${topic}. Prefer posts with concrete steps, lived examples, or source-backed detail.`,
    platformHint: index % 2 === 0 ? "Search and save" : "Follow or mute"
  }));

  const timeline = Array.from({ length: Number(horizonDays) }, (_, index) => {
    const action = goal.actions[index % goal.actions.length];
    const topic = goal.topics[index % goal.topics.length];
    return {
      day: index + 1,
      title: `${action} around ${topic}`,
      check: avoidTerms.length
        ? `Avoid: ${avoidTerms.join(", ")}`
        : "Check whether the feed is rewarding the behavior you want."
    };
  });

  return {
    goal,
    prompts,
    timeline,
    posture: Number(intensity) >= 4 ? "Aggressive" : Number(intensity) <= 2 ? "Gentle" : "Balanced"
  };
}

export function analyzeSignals(text, selectedGoalId) {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token.length > 2);
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const topSignals = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([label, weight]) => ({ label, weight }));

  const selectedGoal = goals.find((goal) => goal.id === selectedGoalId) || goals[0];
  const matched = selectedGoal.topics.filter((topic) =>
    topic.split(" ").some((part) => counts.has(part.toLowerCase()))
  );

  return {
    topSignals,
    alignment: selectedGoal.topics.length ? Math.round((matched.length / selectedGoal.topics.length) * 100) : 0,
    traits: deriveTraits(topSignals, selectedGoal.intent)
  };
}

function deriveTraits(signals, intent) {
  const base = [
    { label: "Intentionality", value: Math.min(95, 48 + signals.length * 4) },
    { label: "Novelty appetite", value: intent === "recipes" || intent === "founder" ? 76 : 58 },
    { label: "Execution bias", value: intent === "discipline" || intent === "founder" ? 82 : 61 },
    { label: "Noise exposure", value: Math.max(18, 66 - signals.length * 3) }
  ];
  return base;
}
