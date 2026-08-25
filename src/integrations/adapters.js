import { normalizeManualSignals, summarizeActivities } from "./normalizedActivity.js";
import { getProvider, getProviderIds, providerCatalog } from "./providers.js";

const oauthImportBlockers = [
  "explicit backend feature-flag enablement for the official import route",
  "browser UI for import history controls",
  "provider-specific production permission review"
];

const prohibitedActions = [
  "collect passwords",
  "store tokens in the browser",
  "automate likes, follows, comments, or other engagement"
];

export function listImportAdapters() {
  return providerCatalog.map((provider) => createAdapterForProvider(provider));
}

export function getImportAdapter(providerId) {
  if (!getProviderIds().includes(providerId)) {
    throw new Error(`Unknown provider adapter: ${providerId}`);
  }
  return createAdapterForProvider(getProvider(providerId));
}

export function summarizeAdapterReadiness(providerId) {
  const adapter = getImportAdapter(providerId);
  return {
    providerId: adapter.providerId,
    label: adapter.label,
    canImportNow: adapter.canImportNow,
    importMode: adapter.importMode,
    nextRequiredStep: adapter.nextRequiredStep,
    guardrails: adapter.guardrails
  };
}

function createAdapterForProvider(provider) {
  if (provider.mode === "local") {
    return createManualAdapter(provider);
  }
  return createOfficialOAuthAdapter(provider);
}

function createManualAdapter(provider) {
  return {
    providerId: provider.id,
    label: provider.label,
    kind: "manual-local-adapter",
    canImportNow: true,
    importMode: "user-supplied text",
    supportedSignals: [...provider.supportedSignals],
    nextRequiredStep: "Persist local observations and connect them to portfolio history.",
    guardrails: ["use only explicit user-provided text", "keep processing local by default"],
    importActivities({ text = "", source = provider.id } = {}) {
      const activities = normalizeManualSignals(text, source);
      return {
        providerId: provider.id,
        activities,
        summary: summarizeActivities(activities)
      };
    }
  };
}

function createOfficialOAuthAdapter(provider) {
  return {
    providerId: provider.id,
    label: provider.label,
    kind: "official-oauth-read-adapter",
    canImportNow: false,
    importMode: "official OAuth read import",
    supportedSignals: [...provider.supportedSignals],
    requiredScopes: [...provider.defaultScopes],
    blockers: [...oauthImportBlockers],
    nextRequiredStep: "Add browser import history UI and complete provider review before enabling stored-grant imports.",
    guardrails: [
      "request least-privilege read scopes",
      "store tokens server-side only",
      ...prohibitedActions.map((action) => `do not ${action}`)
    ],
    importActivities() {
      throw new Error(
        `${provider.label} imports require browser history UI and provider permission review before user-facing stored-grant imports are enabled.`
      );
    }
  };
}
