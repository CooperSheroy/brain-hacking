import { analyzeSignals, createPlan, goals } from "./feedPlanner.js";
import { getImportAdapter, summarizeAdapterReadiness } from "./integrations/adapters.js";
import { createOAuthState, summarizeConsent } from "./integrations/oauth.js";
import { normalizeManualSignals, summarizeActivities } from "./integrations/normalizedActivity.js";
import { getProvider, providerCatalog } from "./integrations/providers.js";

const state = {
  goalId: "discipline",
  horizonDays: 14,
  intensity: 3,
  avoid: "",
  signals: "discipline systems, gym routines, high protein recipes, deep work, founder advice",
  selectedProviderId: "twitter"
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

function init() {
  goalSelect.innerHTML = goals.map((goal) => `<option value="${goal.id}">${goal.label}</option>`).join("");
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
  signalChips.innerHTML = analysis.topSignals
    .map((signal) => `<span class="chip">${signal.label}<strong>${signal.weight}</strong></span>`)
    .join("");
  portfolioGrid.innerHTML = [
    { label: "Goal alignment", value: analysis.alignment },
    ...analysis.traits
  ]
    .map(
      (item) => `
        <article class="portfolio-card">
          <div>
            <strong>${item.label}</strong>
            <span>${item.value}%</span>
          </div>
          <meter min="0" max="100" value="${item.value}"></meter>
        </article>
      `
    )
    .join("");
  signalChips.insertAdjacentHTML(
    "beforeend",
    `<span class="chip">local activities<strong>${activitySummary.total}</strong></span>`
  );
}

function renderIntegrationDetail() {
  const provider = getProvider(state.selectedProviderId);
  const consent = summarizeConsent(provider, provider.defaultScopes);
  const adapter = getImportAdapter(provider.id);
  const readiness = summarizeAdapterReadiness(provider.id);
  selectedProviderBadge.textContent = provider.label;
  const callbackUrl = `${location.origin}/oauth/callback`;
  const statePreview =
    provider.mode === "oauth-pkce"
      ? createOAuthState({
          providerId: provider.id,
          scopes: provider.defaultScopes,
          redirectUri: callbackUrl
        })
      : null;

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
        statePreview
          ? `<span>Redirect: ${statePreview.redirectUri}</span><span>State nonce generated locally</span>`
          : "<span>No external authorization required</span>"
      }
    </div>
  `;
}

function exportPlan() {
  const plan = createPlan(state);
  const provider = getProvider(state.selectedProviderId);
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
    plan
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "brain-hacking-plan.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function formatStatus(status) {
  return status.replaceAll("-", " ");
}

init();
