import { providerCatalog } from "./providers.js";

export const importHistoryDefaultLimit = 25;

export function createImportHistoryFilters({ providerId = "", type = "", limit = importHistoryDefaultLimit } = {}) {
  const filters = {};
  const normalizedProvider = normalizeOptionalText(providerId);
  if (normalizedProvider && normalizedProvider !== "all") {
    filters.provider = normalizedProvider;
  }

  const normalizedType = normalizeOptionalText(type).toLowerCase().replaceAll("-", "_");
  if (normalizedType) {
    filters.type = normalizedType;
  }

  filters.limit = normalizeHistoryLimit(limit);
  return filters;
}

export function createImportHistoryUrl(path, filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function createImportHistoryDeleteBody(filters = {}) {
  const body = {};
  if (filters.provider) {
    body.source = filters.provider;
  }
  if (filters.type) {
    body.type = filters.type;
  }
  if (!body.source && !body.type) {
    throw new Error("Import history deletion requires a provider or type filter.");
  }
  return body;
}

export function createProviderOptions() {
  return [
    { value: "all", label: "All sources" },
    ...providerCatalog.map((provider) => ({ value: provider.id, label: provider.label }))
  ];
}

export function summarizeHistoryResponse(payload = {}) {
  const total = Number(payload.summary?.total ?? payload.activities?.length ?? payload.deleted ?? 0);
  const bySource = Object.entries(payload.summary?.bySource || {})
    .map(([source, count]) => `${source}: ${count}`)
    .join(", ");
  return bySource ? `${total} records (${bySource})` : `${total} records`;
}

export function isHistoryDeleteEnabled(filters = {}) {
  return Boolean(filters.provider || filters.type);
}

function normalizeOptionalText(value) {
  return String(value || "").trim();
}

function normalizeHistoryLimit(value) {
  const limit = Number(value || importHistoryDefaultLimit);
  if (!Number.isInteger(limit) || limit <= 0) {
    return importHistoryDefaultLimit;
  }
  return Math.min(limit, 100);
}
