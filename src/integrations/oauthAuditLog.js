import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const logVersion = 1;
const allowedActions = new Set([
  "authorization-requested",
  "callback-received",
  "token-exchange-completed",
  "grant-listed",
  "grant-exported",
  "grant-disconnected",
  "import-history-listed",
  "import-history-exported",
  "import-history-deleted",
  "portfolio-history-listed",
  "portfolio-history-exported",
  "portfolio-history-deleted",
  "portfolio-history-compared",
  "official-read-import-attempted"
]);
const tokenLikeFields = [
  "accessToken",
  "refreshToken",
  "authorizationCode",
  "clientSecret",
  "tokenSet",
  "encryptedTokenSet",
  "code",
  "password"
];

export function createFileOAuthAuditLog({ filePath, now = Date.now } = {}) {
  const normalizedPath = normalizeFilePath(filePath);
  const events = readEventsFromDisk(normalizedPath);

  return {
    append(event) {
      const prepared = normalizeEvent(event, now);
      events.push(prepared);
      writeEventsToDisk(normalizedPath, events);
      return prepared;
    },

    list({ providerId, accountId, action } = {}) {
      return events
        .filter((event) => !providerId || event.providerId === normalizeOptionalId(providerId, "provider id"))
        .filter((event) => !accountId || event.accountId === normalizeOptionalId(accountId, "account id"))
        .filter((event) => !action || event.action === normalizeAction(action))
        .map((event) => ({ ...event, metadata: { ...event.metadata } }));
    }
  };
}

export function createMemoryOAuthAuditLog({ now = Date.now } = {}) {
  const events = [];

  return {
    append(event) {
      const prepared = normalizeEvent(event, now);
      events.push(prepared);
      return prepared;
    },

    list({ providerId, accountId, action } = {}) {
      return events
        .filter((event) => !providerId || event.providerId === normalizeOptionalId(providerId, "provider id"))
        .filter((event) => !accountId || event.accountId === normalizeOptionalId(accountId, "account id"))
        .filter((event) => !action || event.action === normalizeAction(action))
        .map((event) => ({ ...event, metadata: { ...event.metadata } }));
    }
  };
}

export function summarizeOAuthAuditLogReadiness() {
  return {
    status: "oauth-audit-log-ready",
    storage: "append-only local JSON event log for OAuth integration control events",
    events: [...allowedActions],
    guardrails: [
      "records sanitized provider, account, action, status, and metadata only",
      "rejects token-like fields before persistence",
      "keeps official imports gated behind explicit backend feature flags"
    ],
    remainingBeforeImports: [
      "provider-specific production permission review"
    ]
  };
}

function normalizeFilePath(filePath) {
  const normalized = String(filePath || "").trim();
  if (!normalized) {
    throw new Error("OAuth audit log requires a file path.");
  }
  return normalized;
}

function readEventsFromDisk(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw);
  if (parsed.version !== logVersion || !Array.isArray(parsed.events)) {
    throw new Error("OAuth audit log file has an unsupported format.");
  }
  return parsed.events.map((event) => normalizeEvent(event, Date.now));
}

function writeEventsToDisk(filePath, events) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  const payload = {
    version: logVersion,
    events
  };
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, filePath);
}

function normalizeEvent(event, now) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("OAuth audit log events must be objects.");
  }
  assertNoTokenLikeFields(event);

  return {
    id: normalizeEventId(event.id || createEventId(event, now)),
    action: normalizeAction(event.action),
    providerId: normalizeOptionalId(event.providerId, "provider id"),
    accountId: normalizeOptionalId(event.accountId, "account id"),
    status: normalizeStatus(event.status),
    createdAt: normalizeTimestamp(event.createdAt || new Date(now()).toISOString()),
    metadata: normalizeMetadata(event.metadata || {})
  };
}

function createEventId(event, now) {
  return `${normalizeAction(event.action)}:${new Date(now()).toISOString()}:${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeEventId(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9:._@-]{1,180}$/u.test(normalized)) {
    throw new Error("OAuth audit log event id must be a stable non-secret identifier.");
  }
  return normalized;
}

function normalizeAction(action) {
  const normalized = String(action || "").trim();
  if (!allowedActions.has(normalized)) {
    throw new Error(`Unsupported OAuth audit log action: ${normalized || "unknown"}`);
  }
  return normalized;
}

function normalizeOptionalId(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (!/^[a-zA-Z0-9:._@-]{1,120}$/u.test(normalized)) {
    throw new Error(`OAuth audit log event has an invalid ${label}.`);
  }
  return normalized;
}

function normalizeStatus(status) {
  const normalized = String(status || "").trim();
  if (!/^[a-z][a-z0-9-]{1,80}$/u.test(normalized)) {
    throw new Error("OAuth audit log event status must be a short machine-readable string.");
  }
  return normalized;
}

function normalizeTimestamp(value) {
  const timestamp = new Date(String(value || "").trim());
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`OAuth audit log event has an invalid timestamp: ${value}`);
  }
  return timestamp.toISOString();
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("OAuth audit log metadata must be an object.");
  }
  assertNoTokenLikeFields(metadata);

  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [normalizeMetadataKey(key), normalizeMetadataValue(value)])
  );
}

function normalizeMetadataKey(key) {
  const normalized = String(key || "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/u.test(normalized)) {
    throw new Error("OAuth audit log metadata keys must be short identifiers.");
  }
  return normalized;
}

function normalizeMetadataValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("OAuth audit log metadata numbers must be finite.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMetadataValue(item));
  }
  if (typeof value === "object") {
    throw new Error("OAuth audit log metadata values must be scalar or scalar arrays.");
  }

  return String(value)
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

function assertNoTokenLikeFields(value, path = "") {
  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (tokenLikeFields.some((field) => field.toLowerCase() === key.toLowerCase())) {
      throw new Error(`OAuth audit log event cannot include token-like field: ${currentPath}`);
    }
    if (child && typeof child === "object") {
      assertNoTokenLikeFields(child, currentPath);
    }
  }
}
