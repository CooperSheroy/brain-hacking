import { summarizeActivities } from "./normalizedActivity.js";
import { getProvider } from "./providers.js";

const defaultListLimit = 50;
const maxListLimit = 500;

const guardrails = [
  "return sanitized normalized activity records only",
  "never expose OAuth tokens, authorization codes, client secrets, or raw provider payloads",
  "delete imported history only through explicit source, type, or time filters"
];

export function listImportHistory({
  activityStore,
  auditLog,
  providerId,
  source,
  type,
  since,
  until,
  limit = defaultListLimit,
  now = Date.now
} = {}) {
  const store = assertActivityStore(activityStore, "listActivities");
  const filters = normalizeHistoryFilters({ providerId, source, type, since, until, limit });
  const activities = store.listActivities(filters).map(sanitizeActivity);
  appendAuditEvent(auditLog, {
    action: "import-history-listed",
    providerId: filters.source,
    status: "import-history-list-ready",
    metadata: {
      activityCount: activities.length,
      hasTimeBoundary: Boolean(filters.since || filters.until)
    }
  });

  return {
    status: "import-history-list-ready",
    listedAt: new Date(now()).toISOString(),
    filters,
    activities,
    summary: summarizeActivities(activities),
    guardrails: [...guardrails]
  };
}

export function exportImportHistory({
  activityStore,
  auditLog,
  providerId,
  source,
  type,
  since,
  until,
  now = Date.now
} = {}) {
  const store = assertActivityStore(activityStore, "listActivities");
  const filters = normalizeHistoryFilters({ providerId, source, type, since, until });
  const activities = store.listActivities(filters).map(sanitizeActivity);
  appendAuditEvent(auditLog, {
    action: "import-history-exported",
    providerId: filters.source,
    status: "import-history-export-ready",
    metadata: {
      activityCount: activities.length,
      hasTimeBoundary: Boolean(filters.since || filters.until)
    }
  });

  return {
    status: "import-history-export-ready",
    exportedAt: new Date(now()).toISOString(),
    filters,
    activities,
    summary: summarizeActivities(activities),
    retentionNote: "Export contains normalized activity history only; OAuth grants and token material remain separate.",
    guardrails: [...guardrails]
  };
}

export function deleteImportHistory({
  activityStore,
  auditLog,
  providerId,
  source,
  type,
  since,
  until,
  now = Date.now
} = {}) {
  const store = assertActivityStore(activityStore, "deleteActivities");
  const filters = normalizeHistoryFilters({ providerId, source, type, since, until });
  const result = store.deleteActivities(filters);
  appendAuditEvent(auditLog, {
    action: "import-history-deleted",
    providerId: filters.source,
    status: "import-history-delete-complete",
    metadata: {
      deleted: result.deleted,
      total: result.total,
      hasTimeBoundary: Boolean(filters.since || filters.until)
    }
  });

  return {
    status: "import-history-delete-complete",
    deletedAt: new Date(now()).toISOString(),
    filters,
    deleted: result.deleted,
    total: result.total,
    summary: result.summary,
    guardrails: [...guardrails]
  };
}

export function summarizeImportHistoryControlsReadiness() {
  return {
    status: "import-history-controls-ready",
    supportedOperations: [
      "list normalized import history",
      "export normalized import history",
      "delete history by source, type, or time boundary"
    ],
    guardrails: [...guardrails],
    remainingBeforeProduction: [
      "harden browser history retention UX",
      "complete provider-specific production permission review",
      "define scheduled import retention defaults"
    ]
  };
}

function normalizeHistoryFilters({ providerId, source, type, since, until, limit } = {}) {
  const filters = {};
  const normalizedSource = normalizeOptionalSource(source || providerId);
  if (normalizedSource) {
    filters.source = normalizedSource;
  }
  const normalizedType = normalizeOptionalText(type);
  if (normalizedType) {
    filters.type = normalizedType;
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

function sanitizeActivity(activity) {
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
    throw new TypeError("Import history records must be normalized activity objects.");
  }
  const unsafeFields = [
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
  for (const field of unsafeFields) {
    if (Object.hasOwn(activity, field)) {
      throw new Error(`Import history record contains unsafe field: ${field}`);
    }
  }
  return { ...activity };
}

function normalizeOptionalSource(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return "";
  }
  getProvider(normalized);
  return normalized;
}

function normalizeOptionalText(value) {
  return String(value || "").trim();
}

function normalizeOptionalTimestamp(value, label) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return "";
  }
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Import history ${label} filter must be a valid timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeOptionalLimit(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Import history limit must be a positive integer: ${value}`);
  }
  return Math.min(limit, maxListLimit);
}

function assertActivityStore(activityStore, method) {
  if (typeof activityStore?.[method] !== "function") {
    throw new TypeError(`Import history controls require an activity store with ${method}().`);
  }
  return activityStore;
}

function appendAuditEvent(auditLog, event) {
  if (!auditLog) {
    return;
  }
  if (typeof auditLog.append !== "function") {
    throw new TypeError("Import history controls require an audit log with append().");
  }
  auditLog.append(event);
}
