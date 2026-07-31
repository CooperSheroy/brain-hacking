import { goals } from "./feedPlanner.js";
import { summarizeActivities } from "./integrations/normalizedActivity.js";

const noiseTerms = new Set([
  "drama",
  "doomscrolling",
  "gossip",
  "outrage",
  "rage",
  "ragebait",
  "scandal",
  "viral"
]);

const exploratoryTypes = new Set(["follow", "media", "page_interest", "post"]);
const executionTypes = new Set(["bookmark", "self_audit", "topic"]);

export function buildPortfolioMap(activities = [], selectedGoalId = "discipline") {
  if (!Array.isArray(activities)) {
    throw new TypeError("Portfolio activities must be an array.");
  }

  const selectedGoal = goals.find((goal) => goal.id === selectedGoalId) || goals[0];
  const weightedActivities = activities.map(toWeightedActivity);
  const totalWeight = weightedActivities.reduce((sum, activity) => sum + activity.weight, 0);
  const goalMatches = weightedActivities.filter((activity) => matchesGoal(activity, selectedGoal));
  const noisyActivities = weightedActivities.filter((activity) => includesAnyToken(activity.tokens, noiseTerms));
  const exploratoryWeight = sumMatchingWeight(weightedActivities, (activity) => exploratoryTypes.has(activity.type));
  const executionWeight = sumMatchingWeight(weightedActivities, (activity) => executionTypes.has(activity.type));
  const uniqueTokens = new Set(weightedActivities.flatMap((activity) => activity.tokens));
  const totalTokens = weightedActivities.reduce((sum, activity) => sum + activity.tokens.length, 0);

  const alignment = percentage(sumWeight(goalMatches), totalWeight);
  const novelty = percentage(uniqueTokens.size, Math.max(1, totalTokens));
  const executionBias = percentage(executionWeight + sumWeight(goalMatches) * 0.35, totalWeight * 1.35);
  const noiseExposure = percentage(sumWeight(noisyActivities), Math.max(1, totalWeight));
  const attentionFocus = Math.max(0, Math.min(100, Math.round((alignment * 0.7 + executionBias * 0.3) - noiseExposure * 0.25)));

  return {
    goal: {
      id: selectedGoal.id,
      label: selectedGoal.label
    },
    summary: summarizeActivities(activities),
    dimensions: [
      {
        id: "aspiration_alignment",
        label: "Aspiration alignment",
        value: alignment,
        evidence: evidenceLabels(goalMatches),
        explanation: "Share of weighted activity that overlaps the selected goal topics."
      },
      {
        id: "attention_focus",
        label: "Attention focus",
        value: attentionFocus,
        evidence: evidenceLabels(goalMatches),
        explanation: "Blend of goal alignment and execution-oriented signals, reduced by noisy terms."
      },
      {
        id: "novelty",
        label: "Novelty",
        value: novelty,
        evidence: topClusters(weightedActivities, selectedGoal).slice(0, 3).map((cluster) => cluster.label),
        explanation: "Breadth of distinct topics compared with repeated signal volume."
      },
      {
        id: "execution_bias",
        label: "Execution bias",
        value: executionBias,
        evidence: evidenceLabels(weightedActivities.filter((activity) => executionTypes.has(activity.type))),
        explanation: "Weight from saves, self-audits, and explicit topics that can become plans."
      },
      {
        id: "noise_exposure",
        label: "Noise exposure",
        value: noiseExposure,
        evidence: evidenceLabels(noisyActivities),
        explanation: "Weight from terms associated with outrage, gossip, or low-agency scrolling."
      }
    ],
    clusters: topClusters(weightedActivities, selectedGoal)
  };
}

function toWeightedActivity(activity) {
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
    throw new TypeError("Portfolio activity must be an object.");
  }

  return {
    ...activity,
    label: String(activity.label || "").trim(),
    type: String(activity.type || "topic"),
    weight: normalizeWeight(activity.weight),
    tokens: tokenize(activity.label)
  };
}

function topClusters(activities, goal) {
  const weightsByToken = new Map();
  for (const activity of activities) {
    for (const token of activity.tokens) {
      weightsByToken.set(token, (weightsByToken.get(token) || 0) + activity.weight);
    }
  }

  return [...weightsByToken.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([label, weight]) => ({
      label,
      weight,
      goalMatched: goal.topics.some((topic) => tokenize(topic).includes(label))
    }));
}

function matchesGoal(activity, goal) {
  return goal.topics.some((topic) => tokenize(topic).some((token) => activity.tokens.includes(token)));
}

function includesAnyToken(tokens, tokenSet) {
  return tokens.some((token) => tokenSet.has(token));
}

function sumMatchingWeight(activities, predicate) {
  return sumWeight(activities.filter(predicate));
}

function sumWeight(activities) {
  return activities.reduce((sum, activity) => sum + activity.weight, 0);
}

function percentage(value, total) {
  if (!total) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function evidenceLabels(activities) {
  return activities
    .slice(0, 3)
    .map((activity) => activity.label)
    .filter(Boolean);
}

function normalizeWeight(value) {
  const weight = Number(value ?? 1);
  if (!Number.isFinite(weight) || weight <= 0) {
    return 1;
  }
  return weight;
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9+#]+/u)
    .filter((token) => token.length > 2);
}
