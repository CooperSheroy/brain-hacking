const defaultListLimit = 20;
const maxListLimit = 200;

const unsafeSnapshotFields = [
  "accessToken",
  "authorizationCode",
  "clientSecret",
  "password",
  "privateMessage",
  "rawPayload",
  "refreshToken",
  "token",
  "tokenSet"
];

const guardrails = [
  "return derived portfolio snapshots only",
  "never expose OAuth tokens, authorization codes, client secrets, raw provider payloads, or private messages",
  "delete portfolio snapshots only through explicit goal or time filters",
  "compare snapshots only within the same goal"
];

export function listPortfolioHistory({
  portfolioHistoryStore,
  auditLog,
  goalId,
  since,
  until,
  limit = defaultListLimit,
  now = Date.now
} = {}) {
  const store = assertPortfolioHistoryStore(portfolioHistoryStore, "listSnapshots");
  const filters = normalizePortfolioHistoryFilters({ goalId, since, until, limit });
  const snapshots = store.listSnapshots(filters).map(sanitizeSnapshot);
  appendAuditEvent(auditLog, {
    action: "portfolio-history-listed",
    status: "portfolio-history-list-ready",
    metadata: {
      goalId: filters.goalId || "",
      snapshotCount: snapshots.length,
      hasTimeBoundary: Boolean(filters.since || filters.until)
    }
  });

  return {
    status: "portfolio-history-list-ready",
    listedAt: new Date(now()).toISOString(),
    filters,
    snapshots,
    summary: summarizeSnapshots(snapshots),
    guardrails: [...guardrails]
  };
}

export function exportPortfolioHistory({
  portfolioHistoryStore,
  auditLog,
  goalId,
  since,
  until,
  now = Date.now
} = {}) {
  const store = assertPortfolioHistoryStore(portfolioHistoryStore, "listSnapshots");
  const filters = normalizePortfolioHistoryFilters({ goalId, since, until });
  const snapshots = store.listSnapshots(filters).map(sanitizeSnapshot);
  appendAuditEvent(auditLog, {
    action: "portfolio-history-exported",
    status: "portfolio-history-export-ready",
    metadata: {
      goalId: filters.goalId || "",
      snapshotCount: snapshots.length,
      hasTimeBoundary: Boolean(filters.since || filters.until)
    }
  });

  return {
    status: "portfolio-history-export-ready",
    exportedAt: new Date(now()).toISOString(),
    filters,
    snapshots,
    summary: summarizeSnapshots(snapshots),
    retentionNote: "Export contains derived portfolio snapshots only; OAuth grants, token material, and raw provider payloads remain separate.",
    guardrails: [...guardrails]
  };
}

export function deletePortfolioHistory({
  portfolioHistoryStore,
  auditLog,
  goalId,
  since,
  until,
  now = Date.now
} = {}) {
  const store = assertPortfolioHistoryStore(portfolioHistoryStore, "deleteSnapshots");
  const filters = normalizePortfolioHistoryFilters({ goalId, since, until });
  const result = store.deleteSnapshots(filters);
  appendAuditEvent(auditLog, {
    action: "portfolio-history-deleted",
    status: "portfolio-history-delete-complete",
    metadata: {
      goalId: filters.goalId || "",
      deleted: result.deleted,
      total: result.total,
      hasTimeBoundary: Boolean(filters.since || filters.until)
    }
  });

  return {
    status: "portfolio-history-delete-complete",
    deletedAt: new Date(now()).toISOString(),
    filters,
    deleted: result.deleted,
    total: result.total,
    guardrails: [...guardrails]
  };
}

export function compareLatestPortfolioHistory({
  portfolioHistoryStore,
  auditLog,
  goalId,
  now = Date.now
} = {}) {
  const store = assertPortfolioHistoryStore(portfolioHistoryStore, "compareLatest");
  const normalizedGoalId = normalizeOptionalId(goalId, "goal id");
  const result = store.compareLatest(normalizedGoalId);
  assertNoUnsafeFields(result);
  appendAuditEvent(auditLog, {
    action: "portfolio-history-compared",
    status: result.status,
    metadata: {
      goalId: normalizedGoalId,
      beforeSnapshotId: result.beforeSnapshotId || "",
      afterSnapshotId: result.afterSnapshotId || ""
    }
  });

  return {
    ...result,
    comparedAt: new Date(now()).toISOString(),
    guardrails: [...guardrails]
  };
}

export function summarizePortfolioHistoryControlsReadiness() {
  return {
    status: "portfolio-history-controls-ready",
    supportedOperations: [
      "list derived portfolio snapshots",
      "export derived portfolio snapshots",
      "delete snapshots by goal or time boundary",
      "compare the latest two snapshots for one goal"
    ],
    guardrails: [...guardrails],
    remainingBeforeProduction: [
      "add browser controls for portfolio history review and deletion confirmations",
      "wire saved import batches into snapshot creation after user approval",
      "decide user-visible retention defaults before enabling scheduled snapshots"
    ]
  };
}

function normalizePortfolioHistoryFilters({ goalId, since, until, limit } = {}) {
  const filters = {};
  const normalizedGoalId = normalizeOptionalId(goalId, "goal id");
  if (normalizedGoalId) {
    filters.goalId = normalizedGoalId;
  }
  const normalizedSince = normalizeOptionalTimestamp(since, "since");
  if (normalizedSince) {
    filters.since = normalizedSince;
  }
  const normalizedUntil = normalizeOptionalTimestamp(until, "until");
  if (normalizedUntil) {
    filters.until = normalizedUntil;
  }
  const normalizedLimit = normalizeOptionalLimit(limit);
  if (normalizedLimit) {
    filters.limit = normalizedLimit;
  }
  return filters;
}

function sanitizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Portfolio history records must be derived snapshot objects.");
  }
  assertNoUnsafeFields(snapshot);
  return {
    id: String(snapshot.id),
    capturedAt: String(snapshot.capturedAt),
    goal: { ...snapshot.goal },
    note: String(snapshot.note || ""),
    activitySummary: {
      total: snapshot.activitySummary?.total || 0,
      bySource: { ...(snapshot.activitySummary?.bySource || {}) },
      byType: { ...(snapshot.activitySummary?.byType || {}) }
    },
    dimensions: (snapshot.dimensions || []).map((dimension) => ({
      ...dimension,
      evidence: [...(dimension.evidence || [])]
    })),
    clusters: (snapshot.clusters || []).map((cluster) => ({ ...cluster }))
  };
}

function assertNoUnsafeFields(value, path = "record") {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const currentPath = `${path}.${key}`;
    if (unsafeSnapshotFields.some((field) => field.toLowerCase() === key.toLowerCase())) {
      throw new Error(`Portfolio history record contains unsafe field: ${currentPath}`);
    }
    assertNoUnsafeFields(child, currentPath);
  }
}

function summarizeSnapshots(snapshots) {
  return {
    total: snapshots.length,
    byGoal: countBy(snapshots, (snapshot) => snapshot.goal.id)
  };
}

function countBy(values, keyForValue) {
  const counts = {};
  for (const value of values) {
    const key = keyForValue(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function normalizeOptionalId(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (!/^[a-zA-Z0-9:._@-]{1,160}$/u.test(normalized)) {
    throw new Error(`Portfolio history ${label} filter must be a stable identifier.`);
  }
  return normalized;
}

function normalizeOptionalTimestamp(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Portfolio history ${label} filter must be a valid timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeOptionalLimit(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Portfolio history limit must be a positive integer: ${value}`);
  }
  return Math.min(limit, maxListLimit);
}

function assertPortfolioHistoryStore(portfolioHistoryStore, method) {
  if (typeof portfolioHistoryStore?.[method] !== "function") {
    throw new TypeError(`Portfolio history controls require a store with ${method}().`);
  }
  return portfolioHistoryStore;
}

function appendAuditEvent(auditLog, event) {
  if (!auditLog) {
    return;
  }
  if (typeof auditLog.append !== "function") {
    throw new TypeError("Portfolio history controls require an audit log with append().");
  }
  auditLog.append(event);
}
