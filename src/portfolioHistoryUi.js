import { goals } from "./feedPlanner.js";

export const portfolioHistoryDefaultLimit = 20;

export function createPortfolioHistoryFilters({
  goalId = "",
  since = "",
  until = "",
  limit = portfolioHistoryDefaultLimit
} = {}) {
  const filters = {};
  const normalizedGoalId = normalizeOptionalText(goalId);
  if (normalizedGoalId && normalizedGoalId !== "all") {
    filters.goal = normalizedGoalId;
  }

  const normalizedSince = normalizeOptionalDate(since);
  if (normalizedSince) {
    filters.since = normalizedSince;
  }

  const normalizedUntil = normalizeOptionalDate(until);
  if (normalizedUntil) {
    filters.until = normalizedUntil;
  }

  filters.limit = normalizeHistoryLimit(limit);
  return filters;
}

export function createPortfolioHistoryUrl(path, filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function createPortfolioHistoryDeleteBody(filters = {}) {
  const body = {};
  if (filters.goal) {
    body.goalId = filters.goal;
  }
  if (filters.since) {
    body.since = filters.since;
  }
  if (filters.until) {
    body.until = filters.until;
  }
  if (!body.goalId && !body.since && !body.until) {
    throw new Error("Portfolio history deletion requires a goal or time filter.");
  }
  return body;
}

export function createPortfolioGoalOptions() {
  return [
    { value: "all", label: "All goals" },
    ...goals.map((goal) => ({ value: goal.id, label: goal.label }))
  ];
}

export function summarizePortfolioHistoryResponse(payload = {}) {
  const total = Number(payload.summary?.total ?? payload.snapshots?.length ?? payload.deleted ?? 0);
  const byGoal = Object.entries(payload.summary?.byGoal || {})
    .map(([goal, count]) => `${goal}: ${count}`)
    .join(", ");
  return byGoal ? `${total} snapshots (${byGoal})` : `${total} snapshots`;
}

export function summarizePortfolioComparison(payload = {}) {
  if (payload.status === "portfolio-history-insufficient-snapshots") {
    return `${payload.available || 0}/${payload.required || 2} snapshots available`;
  }
  return payload.comparison?.headline || "No comparison available";
}

export function isPortfolioHistoryDeleteEnabled(filters = {}) {
  return Boolean(filters.goal || filters.since || filters.until);
}

function normalizeOptionalText(value) {
  return String(value || "").trim();
}

function normalizeOptionalDate(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return "";
  }
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) {
    return "";
  }
  return timestamp.toISOString();
}

function normalizeHistoryLimit(value) {
  const limit = Number(value || portfolioHistoryDefaultLimit);
  if (!Number.isInteger(limit) || limit <= 0) {
    return portfolioHistoryDefaultLimit;
  }
  return Math.min(limit, 100);
}
