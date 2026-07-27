import { analyzeSignals, createPlan, goals, platforms } from "./feedPlanner.js";

const state = {
  goalId: "discipline",
  horizonDays: 14,
  intensity: 3,
  avoid: "",
  signals: "discipline systems, gym routines, high protein recipes, deep work, founder advice"
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

function init() {
  goalSelect.innerHTML = goals.map((goal) => `<option value="${goal.id}">${goal.label}</option>`).join("");
  connectionList.innerHTML = platforms
    .map(
      (platform) => `
        <article class="connection-card">
          <div>
            <strong>${platform.label}</strong>
            <span>${platform.status}</span>
          </div>
          <button type="button" ${platform.id !== "manual" ? "disabled" : ""}>${platform.id === "manual" ? "Import" : "Soon"}</button>
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
  renderPlan();
  renderSignals();
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
}

function exportPlan() {
  const plan = createPlan(state);
  const payload = {
    project: "Brain Hacking",
    exportedAt: new Date().toISOString(),
    state,
    plan
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "brain-hacking-plan.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

init();
