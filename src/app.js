import { analyzeSignals, createPlan, goals } from "./feedPlanner.js";
import { getImportAdapter, summarizeAdapterReadiness } from "./integrations/adapters.js";
import { summarizeConsent } from "./integrations/oauth.js";
import {
  createImportHistoryDeleteBody,
  createImportHistoryFilters,
  createImportHistoryUrl,
  createProviderOptions,
  isHistoryDeleteEnabled,
  summarizeHistoryResponse
} from "./integrations/importHistoryUi.js";
import { normalizeManualSignals, summarizeActivities } from "./integrations/normalizedActivity.js";
import { getProvider, providerCatalog } from "./integrations/providers.js";
import { buildPortfolioMap } from "./portfolioModel.js";
import {
  createPortfolioGoalOptions,
  createPortfolioHistoryDeleteBody,
  createPortfolioHistoryFilters,
  createPortfolioHistoryUrl,
  isPortfolioHistoryDeleteEnabled,
  summarizePortfolioComparison,
  summarizePortfolioHistoryResponse
} from "./portfolioHistoryUi.js";

const state = {
  goalId: "discipline",
  horizonDays: 14,
  intensity: 3,
  avoid: "",
  signals: "discipline systems, gym routines, high protein recipes, deep work, founder advice",
  selectedProviderId: "twitter",
  historyProviderId: "all",
  historyType: "",
  historyLimit: 25,
  historyStatus: "Not loaded",
  historyActivities: [],
  portfolioHistoryGoalId: "all",
  portfolioHistorySince: "",
  portfolioHistoryUntil: "",
  portfolioHistoryLimit: 20,
  portfolioHistoryStatus: "Not loaded",
  portfolioSnapshots: [],
  portfolioComparisonStatus: "No comparison loaded"
};

const goalSelect = document.querySelector("#goalSelect");
const horizonSelect = document.querySelector("#horizonSelect");
const intensityInput = document.querySelector("#intensityInput");
const avoidInput = document.querySelector("#avoidInput");
const promptList = document.querySelector("#promptList");
const timelineList = document.querySelector("#timelineList");
const confidenceBadge = document.querySelector("#confidenceBadge");
const connectionList = document.querySelector("#connectionList");
const signalsInput = document.querySelector("#signalsInput");
const signalChips = document.querySelector("#signalChips");
const portfolioGrid = document.querySelector("#portfolioGrid");
const viewTitle = document.querySelector("#viewTitle");
const integrationDetail = document.querySelector("#integrationDetail");
const selectedProviderBadge = document.querySelector("#selectedProviderBadge");
const historyProviderSelect = document.querySelector("#historyProviderSelect");
const historyTypeInput = document.querySelector("#historyTypeInput");
const historyLimitInput = document.querySelector("#historyLimitInput");
const historyRefreshButton = document.querySelector("#historyRefreshButton");
const historyExportButton = document.querySelector("#historyExportButton");
const historyDeleteButton = document.querySelector("#historyDeleteButton");
const historyStatus = document.querySelector("#historyStatus");
const historyList = document.querySelector("#historyList");
const portfolioHistoryGoalSelect = document.querySelector("#portfolioHistoryGoalSelect");
const portfolioHistorySinceInput = document.querySelector("#portfolioHistorySinceInput");
const portfolioHistoryUntilInput = document.querySelector("#portfolioHistoryUntilInput");
const portfolioHistoryLimitInput = document.querySelector("#portfolioHistoryLimitInput");
const portfolioHistoryRefreshButton = document.querySelector("#portfolioHistoryRefreshButton");
const portfolioHistoryExportButton = document.querySelector("#portfolioHistoryExportButton");
const portfolioHistoryCompareButton = document.querySelector("#portfolioHistoryCompareButton");
const portfolioHistoryDeleteButton = document.querySelector("#portfolioHistoryDeleteButton");
const portfolioHistoryStatus = document.querySelector("#portfolioHistoryStatus");
const portfolioComparisonStatus = document.querySelector("#portfolioComparisonStatus");
const portfolioHistoryList = document.querySelector("#portfolioHistoryList");

function init() {
  goalSelect.innerHTML = goals.map((goal) => `<option value="${goal.id}">${goal.label}</option>`).join("");
  historyProviderSelect.innerHTML = createProviderOptions()
    .map((provider) => `<option value="${provider.value}">${provider.label}</option>`)
    .join("");
  portfolioHistoryGoalSelect.innerHTML = createPortfolioGoalOptions()
    .map((goal) => `<option value="${goal.value}">${goal.label}</option>`)
    .join("");
  connectionList.innerHTML = providerCatalog
    .map(
      (platform) => `
        <article class="connection-card ${platform.id === state.selectedProviderId ? "is-selected" : ""}">
          <div>
            <strong>${platform.label}</strong>
            <span>${formatStatus(platform.status)}</span>
          </div>
          <button type="button" data-provider="${platform.id}">${platform.mode === "local" ? "Use" : "Review"}</button>
        </article>
      `
    )
    .join("");
  signalsInput.value = state.signals;
  bindEvents();
  render();
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  document.querySelector("#plannerForm").addEventListener("input", () => {
    state.goalId = goalSelect.value;
    state.horizonDays = Number(horizonSelect.value);
    state.intensity = Number(intensityInput.value);
    state.avoid = avoidInput.value;
    render();
  });

  signalsInput.addEventListener("input", () => {
    state.signals = signalsInput.value;
    renderSignals();
  });

  document.querySelector("#regenerateButton").addEventListener("click", renderPlan);
  document.querySelector("#exportButton").addEventListener("click", exportPlan);
  document.querySelector("#historyControls").addEventListener("input", () => {
    readHistoryControls();
    renderImportHistory();
  });
  historyRefreshButton.addEventListener("click", refreshImportHistory);
  historyExportButton.addEventListener("click", exportImportHistory);
  historyDeleteButton.addEventListener("click", deleteImportHistory);
  document.querySelector("#portfolioHistoryControls").addEventListener("input", () => {
    readPortfolioHistoryControls();
    renderPortfolioHistory();
  });
  portfolioHistoryRefreshButton.addEventListener("click", refreshPortfolioHistory);
  portfolioHistoryExportButton.addEventListener("click", exportPortfolioHistory);
  portfolioHistoryCompareButton.addEventListener("click", comparePortfolioHistory);
  portfolioHistoryDeleteButton.addEventListener("click", deletePortfolioHistory);

  connectionList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-provider]");
    if (!button) return;
    state.selectedProviderId = button.dataset.provider;
    renderConnections();
    renderIntegrationDetail();
  });
}

function switchView(view) {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((panel) => panel.classList.remove("is-visible"));
  document.querySelector(`#${view}View`).classList.add("is-visible");
  viewTitle.textContent =
    view === "planner" ? "Feed Steering Planner" : view === "signals" ? "Feed Signals" : "Personality Portfolio";
}

function render() {
  renderConnections();
  renderPlan();
  renderSignals();
  renderIntegrationDetail();
  renderImportHistory();
  renderPortfolioHistory();
}

function renderConnections() {
  document.querySelectorAll(".connection-card").forEach((card) => {
    const button = card.querySelector("[data-provider]");
    card.classList.toggle("is-selected", button?.dataset.provider === state.selectedProviderId);
  });
}

function renderPlan() {
  const plan = createPlan(state);
  confidenceBadge.textContent = plan.posture;
  promptList.innerHTML = plan.prompts
    .map(
      (item) => `
        <article class="prompt-card">
          <span>${item.platformHint}</span>
          <h4>${item.title}</h4>
          <p>${item.prompt}</p>
        </article>
      `
    )
    .join("");
  timelineList.innerHTML = plan.timeline
    .slice(0, 7)
    .map(
      (item) => `
        <article class="timeline-item">
          <strong>Day ${item.day}</strong>
          <div>
            <h4>${item.title}</h4>
            <p>${item.check}</p>
          </div>
        </article>
      `
    )
    .join("");
}

function renderSignals() {
  const analysis = analyzeSignals(state.signals, state.goalId);
  const activities = normalizeManualSignals(state.signals);
  const activitySummary = summarizeActivities(activities);
  const portfolio = buildPortfolioMap(activities, state.goalId);
  signalChips.innerHTML = analysis.topSignals
    .map((signal) => `<span class="chip">${escapeHtml(signal.label)}<strong>${signal.weight}</strong></span>`)
    .join("");
  portfolioGrid.innerHTML = portfolio.dimensions
    .map(
      (item) => `
        <article class="portfolio-card">
          <div>
            <strong>${escapeHtml(item.label)}</strong>
            <span>${item.value}%</span>
          </div>
          <meter min="0" max="100" value="${item.value}"></meter>
          <p>${escapeHtml(formatEvidence(item))}</p>
        </article>
      `
    )
    .join("");
  signalChips.insertAdjacentHTML(
    "beforeend",
    [
      `<span class="chip">local activities<strong>${activitySummary.total}</strong></span>`,
      ...portfolio.clusters
        .slice(0, 4)
        .map((cluster) => `<span class="chip">${escapeHtml(cluster.label)}<strong>${cluster.weight}</strong></span>`)
    ].join("")
  );
}

function renderIntegrationDetail() {
  const provider = getProvider(state.selectedProviderId);
  const consent = summarizeConsent(provider, provider.defaultScopes);
  const adapter = getImportAdapter(provider.id);
  const readiness = summarizeAdapterReadiness(provider.id);
  selectedProviderBadge.textContent = provider.label;
  const callbackUrl = `${location.origin}/oauth/callback`;
  const authorizationEndpoint = `${location.origin}/api/oauth/authorization?provider=${provider.id}`;

  integrationDetail.innerHTML = `
    <div class="integration-summary">
      <div>
        <strong>${provider.label}</strong>
        <span>${formatStatus(provider.status)}</span>
      </div>
      <p>${readiness.canImportNow ? "Processes explicit local text only through the manual adapter." : "Official OAuth adapter is read-only by design and waits for backend token handling."}</p>
    </div>
    <div class="adapter-card">
      <div>
        <span>Adapter</span>
        <strong>${adapter.kind}</strong>
      </div>
      <div>
        <span>Mode</span>
        <strong>${readiness.importMode}</strong>
      </div>
      <div>
        <span>Next</span>
        <strong>${readiness.nextRequiredStep}</strong>
      </div>
    </div>
    <div class="scope-grid">
      ${consent
        .map(
          (scope) => `
            <article class="scope-card">
              <span>${scope.risk} risk</span>
              <strong>${scope.label}</strong>
              <p>${scope.reason}</p>
            </article>
          `
        )
        .join("")}
    </div>
    <div class="integration-meta">
      <span>Signals: ${provider.supportedSignals.join(", ")}</span>
      ${
        provider.mode === "oauth-pkce"
          ? `<span>Start: ${authorizationEndpoint}</span><span>Redirect: ${callbackUrl}</span>`
          : "<span>No external authorization required</span>"
      }
    </div>
  `;
}

function renderImportHistory() {
  const filters = getHistoryFilters();
  historyProviderSelect.value = state.historyProviderId;
  historyTypeInput.value = state.historyType;
  historyLimitInput.value = state.historyLimit;
  historyStatus.textContent = state.historyStatus;
  historyDeleteButton.disabled = !isHistoryDeleteEnabled(filters);
  historyList.innerHTML = state.historyActivities.length
    ? state.historyActivities
        .map(
          (activity) => `
            <article class="history-item">
              <div>
                <strong>${escapeHtml(activity.label)}</strong>
                <span>${escapeHtml(activity.source)} &middot; ${escapeHtml(activity.type)} &middot; ${formatDate(activity.capturedAt)}</span>
              </div>
              <span>${escapeHtml(activity.permissionScope || "local")}</span>
            </article>
          `
        )
        .join("")
    : `<p class="empty-state">${escapeHtml(state.historyStatus)}</p>`;
}

function renderPortfolioHistory() {
  const filters = getPortfolioHistoryFilters();
  portfolioHistoryGoalSelect.value = state.portfolioHistoryGoalId;
  portfolioHistorySinceInput.value = state.portfolioHistorySince;
  portfolioHistoryUntilInput.value = state.portfolioHistoryUntil;
  portfolioHistoryLimitInput.value = state.portfolioHistoryLimit;
  portfolioHistoryStatus.textContent = state.portfolioHistoryStatus;
  portfolioComparisonStatus.textContent = state.portfolioComparisonStatus;
  portfolioHistoryDeleteButton.disabled = !isPortfolioHistoryDeleteEnabled(filters);
  portfolioHistoryList.innerHTML = state.portfolioSnapshots.length
    ? state.portfolioSnapshots
        .map(
          (snapshot) => `
            <article class="history-item">
              <div>
                <strong>${escapeHtml(snapshot.goal?.label || snapshot.goal?.id || "Portfolio snapshot")}</strong>
                <span>${formatDate(snapshot.capturedAt)} &middot; ${snapshot.activitySummary?.total || 0} activities</span>
              </div>
              <span>${escapeHtml(formatTopSnapshotMetric(snapshot))}</span>
            </article>
          `
        )
        .join("")
    : `<p class="empty-state">${escapeHtml(state.portfolioHistoryStatus)}</p>`;
}

async function refreshImportHistory() {
  readHistoryControls();
  state.historyStatus = "Loading history";
  renderImportHistory();

  try {
    const response = await fetch(createImportHistoryUrl("/api/oauth/import-history", getHistoryFilters()));
    const payload = await response.json();
    assertHistoryResponse(response, payload);
    state.historyActivities = payload.activities || [];
    state.historyStatus = summarizeHistoryResponse(payload);
  } catch (error) {
    state.historyActivities = [];
    state.historyStatus = error.message;
  }

  renderImportHistory();
}

async function exportImportHistory() {
  readHistoryControls();
  try {
    const response = await fetch(createImportHistoryUrl("/api/oauth/import-history/export", getHistoryFilters()));
    const payload = await response.json();
    assertHistoryResponse(response, payload);
    downloadJson(payload, "brain-hacking-import-history.json");
    state.historyStatus = summarizeHistoryResponse(payload);
  } catch (error) {
    state.historyStatus = error.message;
  }
  renderImportHistory();
}

async function deleteImportHistory() {
  readHistoryControls();
  const filters = getHistoryFilters();
  let body;
  try {
    body = createImportHistoryDeleteBody(filters);
  } catch (error) {
    state.historyStatus = error.message;
    renderImportHistory();
    return;
  }
  if (!confirm(`Delete import history for ${formatDeleteBoundary(body)}?`)) {
    return;
  }

  try {
    const response = await fetch("/api/oauth/import-history", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    assertHistoryResponse(response, payload);
    state.historyActivities = [];
    state.historyStatus = `Deleted ${payload.deleted || 0} records`;
  } catch (error) {
    state.historyStatus = error.message;
  }
  renderImportHistory();
}

async function refreshPortfolioHistory() {
  readPortfolioHistoryControls();
  state.portfolioHistoryStatus = "Loading snapshots";
  renderPortfolioHistory();

  try {
    const response = await fetch(createPortfolioHistoryUrl("/api/portfolio/history", getPortfolioHistoryFilters()));
    const payload = await response.json();
    assertPortfolioHistoryResponse(response, payload);
    state.portfolioSnapshots = payload.snapshots || [];
    state.portfolioHistoryStatus = summarizePortfolioHistoryResponse(payload);
  } catch (error) {
    state.portfolioSnapshots = [];
    state.portfolioHistoryStatus = error.message;
  }

  renderPortfolioHistory();
}

async function exportPortfolioHistory() {
  readPortfolioHistoryControls();
  try {
    const response = await fetch(createPortfolioHistoryUrl("/api/portfolio/history/export", getPortfolioHistoryFilters()));
    const payload = await response.json();
    assertPortfolioHistoryResponse(response, payload);
    downloadJson(payload, "brain-hacking-portfolio-history.json");
    state.portfolioHistoryStatus = summarizePortfolioHistoryResponse(payload);
  } catch (error) {
    state.portfolioHistoryStatus = error.message;
  }
  renderPortfolioHistory();
}

async function comparePortfolioHistory() {
  readPortfolioHistoryControls();
  const filters = getPortfolioHistoryFilters();
  const goal = filters.goal || state.goalId;

  try {
    const response = await fetch(createPortfolioHistoryUrl("/api/portfolio/history/compare", { goal }));
    const payload = await response.json();
    assertPortfolioHistoryResponse(response, payload);
    state.portfolioComparisonStatus = summarizePortfolioComparison(payload);
  } catch (error) {
    state.portfolioComparisonStatus = error.message;
  }
  renderPortfolioHistory();
}

async function deletePortfolioHistory() {
  readPortfolioHistoryControls();
  const filters = getPortfolioHistoryFilters();
  let body;
  try {
    body = createPortfolioHistoryDeleteBody(filters);
  } catch (error) {
    state.portfolioHistoryStatus = error.message;
    renderPortfolioHistory();
    return;
  }
  if (!confirm(`Delete portfolio snapshots for ${formatPortfolioDeleteBoundary(body)}?`)) {
    return;
  }

  try {
    const response = await fetch("/api/portfolio/history", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    assertPortfolioHistoryResponse(response, payload);
    state.portfolioSnapshots = [];
    state.portfolioHistoryStatus = `Deleted ${payload.deleted || 0} snapshots`;
  } catch (error) {
    state.portfolioHistoryStatus = error.message;
  }
  renderPortfolioHistory();
}

function exportPlan() {
  const plan = createPlan(state);
  const provider = getProvider(state.selectedProviderId);
  const localActivities = normalizeManualSignals(state.signals);
  const payload = {
    project: "Brain Hacking",
    exportedAt: new Date().toISOString(),
    state,
    selectedProvider: {
      id: provider.id,
      label: provider.label,
      mode: provider.mode,
      scopes: provider.defaultScopes,
      adapter: summarizeAdapterReadiness(provider.id)
    },
    localActivitySummary: summarizeActivities(localActivities),
    portfolio: buildPortfolioMap(localActivities, state.goalId),
    plan
  };
  downloadJson(payload, "brain-hacking-plan.json");
}

function readHistoryControls() {
  state.historyProviderId = historyProviderSelect.value;
  state.historyType = historyTypeInput.value;
  state.historyLimit = Number(historyLimitInput.value);
}

function readPortfolioHistoryControls() {
  state.portfolioHistoryGoalId = portfolioHistoryGoalSelect.value;
  state.portfolioHistorySince = portfolioHistorySinceInput.value;
  state.portfolioHistoryUntil = portfolioHistoryUntilInput.value;
  state.portfolioHistoryLimit = Number(portfolioHistoryLimitInput.value);
}

function getHistoryFilters() {
  return createImportHistoryFilters({
    providerId: state.historyProviderId,
    type: state.historyType,
    limit: state.historyLimit
  });
}

function getPortfolioHistoryFilters() {
  return createPortfolioHistoryFilters({
    goalId: state.portfolioHistoryGoalId,
    since: state.portfolioHistorySince,
    until: state.portfolioHistoryUntil,
    limit: state.portfolioHistoryLimit
  });
}

function assertHistoryResponse(response, payload) {
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || "Import history request failed.");
  }
}

function assertPortfolioHistoryResponse(response, payload) {
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || "Portfolio history request failed.");
  }
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function formatStatus(status) {
  return status.replaceAll("-", " ");
}

function formatEvidence(item) {
  return item.evidence.length ? item.evidence.join(", ") : item.explanation;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "";
  }
  return timestamp.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDeleteBoundary(body) {
  return [body.source, body.type].filter(Boolean).join(" / ");
}

function formatPortfolioDeleteBoundary(body) {
  return [body.goalId, body.since, body.until].filter(Boolean).join(" / ");
}

function formatTopSnapshotMetric(snapshot) {
  const topDimension = [...(snapshot.dimensions || [])].sort((a, b) => b.value - a.value)[0];
  return topDimension ? `${topDimension.label}: ${topDimension.value}%` : "derived snapshot";
}

init();
