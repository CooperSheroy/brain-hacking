import { getProvider } from "./providers.js";

const activityTypeAliases = new Map([
  ["bookmarks", "bookmark"],
  ["creator clusters", "follow"],
  ["export notes", "topic"],
  ["follows", "follow"],
  ["liked", "like"],
  ["likes", "like"],
  ["media captions", "media"],
  ["muted topic notes", "mute"],
  ["muted topics", "mute"],
  ["owned media", "media"],
  ["page interests", "page_interest"],
  ["pasted topics", "topic"],
  ["posts", "post"],
  ["recent posts", "post"],
  ["saved content", "bookmark"],
  ["saves", "bookmark"],
  ["self-audits", "self_audit"]
]);

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

const prohibitedProviderFields = new Set([
  "accessToken",
  "authorizationCode",
  "privateMessage",
  "rawPayload",
  "refreshToken",
  "token"
]);

export function normalizeManualSignals(text, source = "manual") {
  return text
    .split(/[\n,]/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((label, index) => ({
      id: `${source}-${index + 1}`,
      source,
      type: "topic",
      label,
      weight: 1,
      capturedAt: new Date(0).toISOString()
    }));
}

export function normalizeProviderActivities(providerId, records = []) {
  if (!Array.isArray(records)) {
    throw new TypeError("Provider activity records must be an array.");
  }
  return records.map((record, index) => normalizeProviderActivity(providerId, record, index));
}

export function normalizeProviderActivity(providerId, record = {}, index = 0) {
  if (!providerId || typeof providerId !== "string") {
    throw new TypeError("Provider id is required to normalize provider activity.");
  }
  const provider = getProvider(providerId);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Provider activity record must be an object.");
  }
  rejectProhibitedFields(record);

  const externalId = cleanScalar(record.externalId ?? record.id ?? `${index + 1}`);
  const label = cleanScalar(record.label ?? record.title ?? record.name ?? record.text ?? record.caption);
  if (!label) {
    throw new Error("Provider activity record requires a label, title, name, text, or caption.");
  }

  const activity = {
    id: `${providerId}-${externalId}`,
    source: providerId,
    type: normalizeActivityType(record.type ?? record.signalType),
    label,
    weight: normalizeWeight(record.weight),
    capturedAt: normalizeTimestamp(record.capturedAt ?? record.createdAt ?? record.timestamp),
    externalId
  };

  const url = normalizeUrl(record.url ?? record.permalink);
  if (url) {
    activity.url = url;
  }

  const permissionScope = normalizePermissionScope(provider, record.permissionScope ?? record.scope);
  if (permissionScope) {
    activity.permissionScope = permissionScope;
  }

  return activity;
}

export function summarizeActivities(activities) {
  const bySource = new Map();
  const byType = new Map();

  for (const activity of activities) {
    bySource.set(activity.source, (bySource.get(activity.source) || 0) + 1);
    byType.set(activity.type, (byType.get(activity.type) || 0) + 1);
  }

  return {
    total: activities.length,
    bySource: Object.fromEntries(bySource),
    byType: Object.fromEntries(byType)
  };
}

function normalizeActivityType(type = "topic") {
  const normalized = cleanScalar(type).toLowerCase().replaceAll("-", "_");
  const aliased = activityTypeAliases.get(normalized) || normalized;
  if (!allowedActivityTypes.has(aliased)) {
    throw new Error(`Unsupported activity type: ${type}`);
  }
  return aliased;
}

function normalizeTimestamp(value) {
  if (!value) {
    return new Date(0).toISOString();
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid activity timestamp: ${value}`);
  }
  return timestamp.toISOString();
}

function normalizeUrl(value) {
  const url = cleanScalar(value);
  if (!url) {
    return "";
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid activity URL: ${url}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported activity URL protocol: ${parsed.protocol}`);
  }
  return parsed.href;
}

function normalizePermissionScope(provider, value) {
  const permissionScope = cleanScalar(value);
  if (!permissionScope) {
    return "";
  }

  const allowedScopes = new Set(provider.scopes.map((scope) => scope.id));
  if (!allowedScopes.has(permissionScope)) {
    throw new Error(`Unsupported permission scope for ${provider.id}: ${permissionScope}`);
  }
  return permissionScope;
}

function normalizeWeight(value) {
  if (value === undefined || value === null || value === "") {
    return 1;
  }
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error(`Invalid activity weight: ${value}`);
  }
  return weight;
}

function cleanScalar(value) {
  return String(value ?? "").trim();
}

function rejectProhibitedFields(record) {
  for (const field of prohibitedProviderFields) {
    if (Object.hasOwn(record, field)) {
      throw new Error(`Provider activity record must not include ${field}.`);
    }
  }
}
