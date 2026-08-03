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

export function comparePortfolioMaps(beforeActivities = [], afterActivities = [], selectedGoalId = "discipline") {
  const before = buildPortfolioMap(beforeActivities, selectedGoalId);
  const after = buildPortfolioMap(afterActivities, selectedGoalId);
  const beforeClusters = new Map(before.clusters.map((cluster) => [cluster.label, cluster]));
  const afterClusters = new Map(after.clusters.map((cluster) => [cluster.label, cluster]));

  const dimensions = after.dimensions.map((current) => {
    const previous = before.dimensions.find((dimension) => dimension.id === current.id);
    const delta = current.value - (previous?.value ?? 0);
    return {
      id: current.id,
      label: current.label,
      before: previous?.value ?? 0,
      after: current.value,
      delta,
      direction: describeDirection(delta)
    };
  });

  const emergingClusters = after.clusters
    .map((cluster) => ({
      label: cluster.label,
      before: beforeClusters.get(cluster.label)?.weight ?? 0,
      after: cluster.weight,
      delta: cluster.weight - (beforeClusters.get(cluster.label)?.weight ?? 0),
      goalMatched: cluster.goalMatched
    }))
    .filter((cluster) => cluster.delta > 0)
    .sort(sortClusterDeltas)
    .slice(0, 5);

  const fadingClusters = before.clusters
    .map((cluster) => ({
      label: cluster.label,
      before: cluster.weight,
      after: afterClusters.get(cluster.label)?.weight ?? 0,
      delta: (afterClusters.get(cluster.label)?.weight ?? 0) - cluster.weight,
      goalMatched: cluster.goalMatched
    }))
    .filter((cluster) => cluster.delta < 0)
    .sort(sortClusterDeltas)
    .slice(0, 5);

  return {
    goal: after.goal,
    beforeSummary: before.summary,
    afterSummary: after.summary,
    activityDelta: after.summary.total - before.summary.total,
    dimensions,
    emergingClusters,
    fadingClusters,
    headline: createChangeHeadline(dimensions, emergingClusters)
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

function describeDirection(delta) {
  if (delta > 0) {
    return "up";
  }
  if (delta < 0) {
    return "down";
  }
  return "flat";
}

function sortClusterDeltas(a, b) {
  return Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label);
}

function createChangeHeadline(dimensions, emergingClusters) {
  const strongestDimension = [...dimensions].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const topCluster = emergingClusters.find((cluster) => cluster.goalMatched) || emergingClusters[0];

  if (!strongestDimension || strongestDimension.delta === 0) {
    return topCluster
      ? `Stable portfolio with more signal around ${topCluster.label}.`
      : "Stable portfolio with no meaningful snapshot movement yet.";
  }

  const direction = strongestDimension.delta > 0 ? "increased" : "decreased";
  const clusterNote = topCluster ? `; strongest emerging cluster is ${topCluster.label}` : "";
  return `${strongestDimension.label} ${direction} by ${Math.abs(strongestDimension.delta)} points${clusterNote}.`;
}
