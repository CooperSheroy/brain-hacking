import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildPortfolioMap } from "./portfolioModel.js";
import { summarizeActivities } from "./integrations/normalizedActivity.js";

const storeVersion = 1;
const maxSnapshots = 200;

const prohibitedFields = new Set([
  "accessToken",
  "authorizationCode",
  "clientSecret",
  "password",
  "privateMessage",
  "rawPayload",
  "refreshToken",
  "token"
]);

export function createFilePortfolioHistoryStore({ filePath } = {}) {
  const normalizedPath = normalizeFilePath(filePath);
  const snapshots = new Map(readSnapshotsFromDisk(normalizedPath).map((snapshot) => [snapshot.id, snapshot]));

  return {
    saveSnapshot({ activities = [], goalId = "discipline", capturedAt = new Date().toISOString(), note = "" } = {}) {
      assertActivitiesAreSanitized(activities);
      const portfolio = buildPortfolioMap(activities, goalId);
      const snapshot = normalizeSnapshot({
        id: createSnapshotId(portfolio.goal.id, capturedAt),
        capturedAt,
        goal: portfolio.goal,
        note,
        activitySummary: summarizeActivities(activities),
        dimensions: portfolio.dimensions,
        clusters: portfolio.clusters
      });

      const existed = snapshots.has(snapshot.id);
      snapshots.set(snapshot.id, snapshot);
      trimSnapshots(snapshots);
      writeSnapshotsToDisk(normalizedPath, snapshots.values());

      return {
        status: "portfolio-snapshot-saved",
        inserted: existed ? 0 : 1,
        updated: existed ? 1 : 0,
        total: snapshots.size,
        snapshot
      };
    },

    listSnapshots(filters = {}) {
      return filterSnapshots([...snapshots.values()], filters);
    },

    compareLatest(goalId = "") {
      const filtered = filterSnapshots([...snapshots.values()], { goalId, limit: 2 });
      if (filtered.length < 2) {
        return {
          status: "portfolio-history-insufficient-snapshots",
          required: 2,
          available: filtered.length
        };
      }

      const [after, before] = filtered;
      return {
        status: "portfolio-history-compared",
        beforeSnapshotId: before.id,
        afterSnapshotId: after.id,
        comparison: comparePortfolioSnapshots(before, after)
      };
    },

    deleteSnapshots(filters = {}) {
      assertDeletionBoundary(filters);
      const matched = filterSnapshots([...snapshots.values()], filters);
      for (const snapshot of matched) {
        snapshots.delete(snapshot.id);
      }
      if (matched.length) {
        writeSnapshotsToDisk(normalizedPath, snapshots.values());
      }
      return {
        status: "portfolio-snapshots-deleted",
        deleted: matched.length,
        total: snapshots.size
      };
    }
  };
}

export function comparePortfolioSnapshots(beforeSnapshot, afterSnapshot) {
  const before = normalizeSnapshot(beforeSnapshot);
  const after = normalizeSnapshot(afterSnapshot);
  if (before.goal.id !== after.goal.id) {
    throw new Error("Portfolio snapshots must use the same goal to compare.");
  }

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
    beforeSummary: before.activitySummary,
    afterSummary: after.activitySummary,
    activityDelta: after.activitySummary.total - before.activitySummary.total,
    dimensions,
    emergingClusters,
    fadingClusters,
    headline: createChangeHeadline(dimensions, emergingClusters)
  };
}

export function summarizePortfolioHistoryStoreReadiness() {
  return {
    status: "portfolio-history-store-ready",
    storage: "local JSON file containing derived portfolio snapshots",
    guardrails: [
      "stores derived portfolio dimensions and clusters instead of OAuth tokens or raw provider payloads",
      "rejects activities containing token, password, private message, or raw payload fields before snapshotting",
      "keeps comparisons local and goal-scoped",
      "caps retained snapshots to bound local sensitive inference history"
    ],
    remainingBeforeProduction: [
      "wire saved import batches into snapshot creation after user approval",
      "add browser controls for history review, export, and deletion",
      "decide user-visible retention defaults before enabling scheduled snapshots"
    ]
  };
}

function normalizeFilePath(filePath) {
  const normalized = String(filePath || "").trim();
  if (!normalized) {
    throw new Error("Portfolio history store requires a file path.");
  }
  return normalized;
}

function readSnapshotsFromDisk(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw);
  if (parsed.version !== storeVersion || !Array.isArray(parsed.snapshots)) {
    throw new Error("Portfolio history store file has an unsupported format.");
  }
  return parsed.snapshots.map(normalizeSnapshot);
}

function writeSnapshotsToDisk(filePath, records) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  const payload = {
    version: storeVersion,
    snapshots: [...records].sort(sortSnapshots)
  };
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, filePath);
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Portfolio snapshot must be an object.");
  }

  const goal = normalizeGoal(snapshot.goal);
  return {
    id: normalizeId(snapshot.id),
    capturedAt: normalizeTimestamp(snapshot.capturedAt),
    goal,
    note: normalizeNote(snapshot.note),
    activitySummary: normalizeActivitySummary(snapshot.activitySummary),
    dimensions: normalizeDimensions(snapshot.dimensions),
    clusters: normalizeClusters(snapshot.clusters)
  };
}

function normalizeGoal(goal) {
  if (!goal || typeof goal !== "object" || Array.isArray(goal)) {
    throw new Error("Portfolio snapshot requires a goal.");
  }
  return {
    id: normalizeId(goal.id),
    label: normalizeText(goal.label, "goal label", 80)
  };
}

function normalizeActivitySummary(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    throw new Error("Portfolio snapshot requires an activity summary.");
  }
  return {
    total: normalizeCount(summary.total, "activity total"),
    bySource: normalizeCountMap(summary.bySource, "activity source"),
    byType: normalizeCountMap(summary.byType, "activity type")
  };
}

function normalizeDimensions(dimensions) {
  if (!Array.isArray(dimensions)) {
    throw new Error("Portfolio snapshot dimensions must be an array.");
  }
  return dimensions.map((dimension) => ({
    id: normalizeId(dimension.id),
    label: normalizeText(dimension.label, "dimension label", 80),
    value: normalizePercentage(dimension.value),
    evidence: normalizeTextList(dimension.evidence, "dimension evidence", 120),
    explanation: normalizeText(dimension.explanation, "dimension explanation", 220)
  }));
}

function normalizeClusters(clusters) {
  if (!Array.isArray(clusters)) {
    throw new Error("Portfolio snapshot clusters must be an array.");
  }
  return clusters.map((cluster) => ({
    label: normalizeText(cluster.label, "cluster label", 80),
    weight: normalizeWeight(cluster.weight),
    goalMatched: Boolean(cluster.goalMatched)
  }));
}

function filterSnapshots(records, filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new TypeError("Portfolio history filters must be an object.");
  }

  const goalId = filters.goalId === undefined || filters.goalId === "" ? "" : normalizeId(filters.goalId);
  const since = filters.since === undefined ? "" : normalizeTimestamp(filters.since);
  const until = filters.until === undefined ? "" : normalizeTimestamp(filters.until);
  const limit = normalizeLimit(filters.limit);

  const filtered = records
    .filter((snapshot) => !goalId || snapshot.goal.id === goalId)
    .filter((snapshot) => !since || snapshot.capturedAt >= since)
    .filter((snapshot) => !until || snapshot.capturedAt <= until)
    .sort((a, b) => sortSnapshots(b, a));

  return limit ? filtered.slice(0, limit) : filtered;
}

function assertDeletionBoundary(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new TypeError("Portfolio history delete filters must be an object.");
  }
  if (filters.goalId === undefined && filters.since === undefined && filters.until === undefined) {
    throw new Error("Portfolio history delete requires at least one goal or time boundary.");
  }
}

function assertActivitiesAreSanitized(activities) {
  if (!Array.isArray(activities)) {
    throw new TypeError("Portfolio snapshot activities must be an array.");
  }
  for (const activity of activities) {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
      throw new TypeError("Portfolio snapshot activities must contain objects.");
    }
    for (const field of prohibitedFields) {
      if (Object.hasOwn(activity, field)) {
        throw new Error(`Portfolio snapshot activity must not include ${field}.`);
      }
    }
  }
}

function trimSnapshots(snapshots) {
  const ordered = [...snapshots.values()].sort(sortSnapshots);
  for (const snapshot of ordered.slice(0, Math.max(0, ordered.length - maxSnapshots))) {
    snapshots.delete(snapshot.id);
  }
}

function createSnapshotId(goalId, capturedAt) {
  return `${normalizeId(goalId)}:${normalizeTimestamp(capturedAt).replaceAll(/[^0-9]/gu, "")}`;
}

function normalizeId(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9:._@-]{1,160}$/u.test(normalized)) {
    throw new Error(`Portfolio history has an invalid id: ${value}`);
  }
  return normalized;
}

function normalizeText(value, label, maxLength) {
  const normalized = String(value || "").replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Portfolio history has an invalid ${label}.`);
  }
  return normalized;
}

function normalizeNote(value) {
  const normalized = String(value || "").replace(/\s+/gu, " ").trim();
  return normalized.slice(0, 280);
}

function normalizeTextList(values, label, maxLength) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.slice(0, 3).map((value) => normalizeText(value, label, maxLength));
}

function normalizeCountMap(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [normalizeId(key), normalizeCount(count, label)])
      .sort((a, b) => a[0].localeCompare(b[0]))
  );
}

function normalizeCount(value, label) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Portfolio history has an invalid ${label}.`);
  }
  return count;
}

function normalizePercentage(value) {
  const percentage = Number(value);
  if (!Number.isFinite(percentage)) {
    throw new Error(`Portfolio history has an invalid percentage: ${value}`);
  }
  return Math.max(0, Math.min(100, Math.round(percentage)));
}

function normalizeWeight(value) {
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error(`Portfolio history has an invalid cluster weight: ${value}`);
  }
  return weight;
}

function normalizeTimestamp(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error("Portfolio history requires capturedAt.");
  }
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid portfolio history timestamp: ${value}`);
  }
  return timestamp.toISOString();
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Invalid portfolio history list limit: ${value}`);
  }
  return limit;
}

function sortSnapshots(a, b) {
  return a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id);
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
