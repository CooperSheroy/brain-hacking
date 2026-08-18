import { normalizeManualSignals, summarizeActivities } from "./normalizedActivity.js";
import { getProvider, getProviderIds, providerCatalog } from "./providers.js";

const oauthImportBlockers = [
  "user-visible disconnect, deletion, and export controls for stored grants",
  "audit logging for consent, import, and account-disconnect events",
  "feature-flagged import worker that reads through the official API client",
  "provider rate-limit handling",
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
    nextRequiredStep: "Add disconnect/delete/export controls and audit logging before enabling stored-grant imports.",
    guardrails: [
      "request least-privilege read scopes",
      "store tokens server-side only",
      ...prohibitedActions.map((action) => `do not ${action}`)
    ],
    importActivities() {
      throw new Error(
        `${provider.label} imports require disconnect/delete/export controls, audit logging, and a feature-flagged official API import worker first.`
      );
    }
  };
}
