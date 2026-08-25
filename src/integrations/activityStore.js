import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getProvider } from "./providers.js";
import { summarizeActivities } from "./normalizedActivity.js";

const storeVersion = 1;

const allowedActivityTypes = new Set([
  "bookmark",
  "follow",
  "like",
  "media",
  "mute",
  "page_interest",
  "post",
  "profile",
  "self_audit",
  "topic"
]);

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

export function createFileNormalizedActivityStore({ filePath } = {}) {
  const normalizedPath = normalizeFilePath(filePath);
  const activities = new Map(readActivitiesFromDisk(normalizedPath).map((activity) => [activityKey(activity), activity]));

  return {
    saveActivities(records = []) {
      if (!Array.isArray(records)) {
        throw new TypeError("Normalized activity store save requires an array.");
      }

      let inserted = 0;
      let updated = 0;
      for (const record of records) {
        const activity = normalizeStoredActivity(record);
        const key = activityKey(activity);
        if (activities.has(key)) {
          updated += 1;
        } else {
          inserted += 1;
        }
        activities.set(key, activity);
      }

      if (records.length) {
        writeActivitiesToDisk(normalizedPath, activities.values());
      }

      return {
        status: "normalized-activities-saved",
        inserted,
        updated,
        total: activities.size,
        summary: summarizeActivities([...activities.values()])
      };
    },

    listActivities(filters = {}) {
      return filterActivities([...activities.values()], filters);
    },

    deleteActivities(filters = {}) {
      assertDeletionBoundary(filters);
      const matched = filterActivities([...activities.values()], filters);
      for (const activity of matched) {
        activities.delete(activityKey(activity));
      }
      if (matched.length) {
        writeActivitiesToDisk(normalizedPath, activities.values());
      }
      return {
        status: "normalized-activities-deleted",
        deleted: matched.length,
        total: activities.size,
        summary: summarizeActivities([...activities.values()])
      };
    }
  };
}

function assertDeletionBoundary(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new TypeError("Normalized activity store delete filters must be an object.");
  }
  if (filters.source === undefined && filters.type === undefined && filters.since === undefined && filters.until === undefined) {
    throw new Error("Normalized activity store delete requires at least one source, type, or time boundary.");
  }
}

export function summarizeNormalizedActivityStoreReadiness() {
  return {
    status: "normalized-activity-store-ready",
    storage: "local JSON file containing sanitized normalized activity records",
    guardrails: [
      "stores normalized activity records only",
      "rejects token, authorization code, password, private message, and raw payload fields",
      "uses idempotent source/id upserts for import retries",
      "supports source and time-bounded deletion before production import wiring"
    ],
    remainingBeforeImports: [
      "add browser UI for import history controls",
      "complete provider-specific production permission review"
    ]
  };
}

function normalizeFilePath(filePath) {
  const normalized = String(filePath || "").trim();
  if (!normalized) {
    throw new Error("Normalized activity store requires a file path.");
  }
  return normalized;
}

function readActivitiesFromDisk(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw);
  if (parsed.version !== storeVersion || !Array.isArray(parsed.activities)) {
    throw new Error("Normalized activity store file has an unsupported format.");
  }
  return parsed.activities.map(normalizeStoredActivity);
}

function writeActivitiesToDisk(filePath, records) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  const payload = {
    version: storeVersion,
    activities: [...records].sort(sortActivities)
  };
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, filePath);
}

function normalizeStoredActivity(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Normalized activity store records must be objects.");
  }
  rejectProhibitedFields(record);

  const source = normalizeSource(record.source);
  const activity = {
    id: normalizeId(record.id),
    source,
    type: normalizeActivityType(record.type),
    label: normalizeLabel(record.label),
    weight: normalizeWeight(record.weight),
    capturedAt: normalizeTimestamp(record.capturedAt)
  };

  const externalId = normalizeOptionalScalar(record.externalId, "externalId");
  if (externalId) {
    activity.externalId = externalId;
  }

  const url = normalizeUrl(record.url);
  if (url) {
    activity.url = url;
  }

  const permissionScope = normalizePermissionScope(source, record.permissionScope);
  if (permissionScope) {
    activity.permissionScope = permissionScope;
  }

  return activity;
}

function filterActivities(records, filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new TypeError("Normalized activity store filters must be an object.");
  }

  const source = filters.source === undefined ? "" : normalizeSource(filters.source);
  const type = filters.type === undefined ? "" : normalizeActivityType(filters.type);
  const since = filters.since === undefined ? "" : normalizeTimestamp(filters.since);
  const until = filters.until === undefined ? "" : normalizeTimestamp(filters.until);
  const limit = normalizeLimit(filters.limit);

  const filtered = records
    .filter((activity) => !source || activity.source === source)
    .filter((activity) => !type || activity.type === type)
    .filter((activity) => !since || activity.capturedAt >= since)
    .filter((activity) => !until || activity.capturedAt <= until)
    .sort(sortActivities);

  return limit ? filtered.slice(0, limit) : filtered;
}

function normalizeSource(value) {
  const source = normalizeProviderBackedId(value, "source");
  getProvider(source);
  return source;
}

function normalizeId(value) {
  return normalizeProviderBackedId(value, "id");
}

function normalizeProviderBackedId(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9:._@-]{1,160}$/u.test(normalized)) {
    throw new Error(`Normalized activity store record has an invalid ${label}.`);
  }
  return normalized;
}

function normalizeActivityType(type) {
  const normalized = String(type || "").trim().toLowerCase().replaceAll("-", "_");
  if (!allowedActivityTypes.has(normalized)) {
    throw new Error(`Unsupported normalized activity type: ${type}`);
  }
  return normalized;
}

function normalizeLabel(value) {
  const label = String(value || "").replace(/\s+/gu, " ").trim();
  if (!label) {
    throw new Error("Normalized activity store record requires a label.");
  }
  return label.slice(0, 280);
}

function normalizeWeight(value) {
  const weight = Number(value ?? 1);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error(`Invalid normalized activity weight: ${value}`);
  }
  return weight;
}

function normalizeTimestamp(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error("Normalized activity store record requires capturedAt.");
  }
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid normalized activity timestamp: ${value}`);
  }
  return timestamp.toISOString();
}

function normalizeOptionalScalar(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (!/^[^\r\n]{1,200}$/u.test(normalized)) {
    throw new Error(`Normalized activity store record has an invalid ${label}.`);
  }
  return normalized;
}

function normalizeUrl(value) {
  const url = String(value || "").trim();
  if (!url) {
    return "";
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid normalized activity URL: ${url}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported normalized activity URL protocol: ${parsed.protocol}`);
  }
  return parsed.href;
}

function normalizePermissionScope(source, value) {
  const permissionScope = String(value || "").trim();
  if (!permissionScope) {
    return "";
  }

  const provider = getProvider(source);
  const allowedScopes = new Set(provider.scopes.map((scope) => scope.id));
  if (!allowedScopes.has(permissionScope)) {
    throw new Error(`Unsupported normalized activity permission scope for ${source}: ${permissionScope}`);
  }
  return permissionScope;
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Invalid normalized activity list limit: ${value}`);
  }
  return limit;
}

function rejectProhibitedFields(record) {
  for (const field of prohibitedFields) {
    if (Object.hasOwn(record, field)) {
      throw new Error(`Normalized activity store record must not include ${field}.`);
    }
  }
}

function activityKey(activity) {
  return `${activity.source}:${activity.id}`;
}

function sortActivities(a, b) {
  return a.capturedAt.localeCompare(b.capturedAt) || activityKey(a).localeCompare(activityKey(b));
}
