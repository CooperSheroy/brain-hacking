import { createOfficialReadClient, listOfficialReadEndpoints } from "./officialApiClient.js";
import { summarizeActivities } from "./normalizedActivity.js";
import { getProvider } from "./providers.js";

const importMode = "official OAuth read import";

const guardrails = [
  "run only when explicitly feature-flagged by the backend",
  "use stored OAuth grants from the server-side vault",
  "read only endpoints covered by consented least-privilege scopes",
  "stop on provider rate limits instead of retrying around them",
  "never automate likes, follows, comments, or other engagement"
];

export function createOfficialImportWorker({
  enabled = false,
  tokenVault,
  auditLog,
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Official import worker requires a fetch implementation.");
  }

  return {
    enabled: Boolean(enabled),
    guardrails: [...guardrails],

    async runImport({ providerId, accountId, endpointIds, limit } = {}) {
      const provider = assertOAuthProvider(providerId);
      const normalizedAccountId = normalizeAccountId(accountId);
      if (!enabled) {
        return emptyResult({
          status: "official-import-disabled",
          providerId: provider.id,
          accountId: normalizedAccountId,
          importedAt: now
        });
      }

      const vault = assertTokenVault(tokenVault);
      const grant = findGrantSummary(vault, provider.id, normalizedAccountId);
      const endpoints = selectEndpoints(provider.id, grant.scopes, endpointIds);
      if (!endpoints.length) {
        return emptyResult({
          status: "official-import-no-consented-endpoints",
          providerId: provider.id,
          accountId: normalizedAccountId,
          importedAt: now,
          skippedEndpoints: skippedEndpoints(provider.id, grant.scopes, endpointIds)
        });
      }

      const client = createOfficialReadClient({
        providerId: provider.id,
        accountId: normalizedAccountId,
        tokenVault: vault,
        auditLog,
        fetchImpl,
        now
      });
      const activities = [];
      const importedEndpoints = [];

      for (const endpoint of endpoints) {
        try {
          const result = await client.importActivities(endpoint.id, { limit });
          activities.push(...result.activities);
          importedEndpoints.push(endpoint.id);
        } catch (error) {
          if (error.providerStatus === 429) {
            return {
              status: "official-import-rate-limited",
              providerId: provider.id,
              accountId: normalizedAccountId,
              importMode,
              importedAt: new Date(now()).toISOString(),
              importedEndpoints,
              failedEndpointId: endpoint.id,
              retryAfterSeconds: error.retryAfterSeconds || null,
              activities,
              summary: summarizeActivities(activities),
              guardrails: [...guardrails]
            };
          }
          throw error;
        }
      }

      return {
        status: "official-import-succeeded",
        providerId: provider.id,
        accountId: normalizedAccountId,
        importMode,
        importedAt: new Date(now()).toISOString(),
        importedEndpoints,
        skippedEndpoints: skippedEndpoints(provider.id, grant.scopes, endpointIds),
        activities,
        summary: summarizeActivities(activities),
        guardrails: [...guardrails]
      };
    }
  };
}

export function summarizeOfficialImportWorkerReadiness() {
  return {
    status: "feature-flagged-import-worker-ready",
    importMode,
    guardrails: [...guardrails],
    remainingBeforeProduction: [
      "wire a backend route or scheduler that keeps the worker disabled by default",
      "complete provider-specific production permission review",
      "persist normalized activity snapshots for portfolio history"
    ]
  };
}

function assertOAuthProvider(providerId) {
  const provider = getProvider(providerId);
  if (provider.mode !== "oauth-pkce") {
    throw new Error(`${provider.label} does not support official OAuth API imports.`);
  }
  return provider;
}

function assertTokenVault(tokenVault) {
  if (!tokenVault?.listGrants || !tokenVault?.loadGrant) {
    throw new TypeError("Official import worker requires a server-side token vault.");
  }
  return tokenVault;
}

function findGrantSummary(tokenVault, providerId, accountId) {
  const grant = tokenVault.listGrants(providerId).find((item) => item.accountId === accountId);
  if (!grant) {
    throw new Error(`No OAuth grant found for ${providerId}.`);
  }
  return grant;
}

function selectEndpoints(providerId, scopes, endpointIds) {
  const catalog = listOfficialReadEndpoints(providerId);
  const requested = normalizeEndpointIds(endpointIds, catalog);
  return catalog.filter((endpoint) => {
    const requestedMatch = !requested.length || requested.includes(endpoint.id);
    return requestedMatch && scopes.includes(endpoint.scope);
  });
}

function skippedEndpoints(providerId, scopes, endpointIds) {
  const catalog = listOfficialReadEndpoints(providerId);
  const requested = normalizeEndpointIds(endpointIds, catalog);
  return catalog
    .filter((endpoint) => (!requested.length || requested.includes(endpoint.id)) && !scopes.includes(endpoint.scope))
    .map((endpoint) => endpoint.id);
}

function normalizeEndpointIds(endpointIds, catalog) {
  if (endpointIds === undefined || endpointIds === null) {
    return [];
  }
  if (!Array.isArray(endpointIds)) {
    throw new TypeError("Official import endpoint ids must be an array.");
  }
  const normalized = endpointIds.map((id) => String(id || "").trim()).filter(Boolean);
  if (normalized.length !== endpointIds.length) {
    throw new Error("Official import endpoint ids must be non-empty strings.");
  }
  const endpointIdsById = new Set(catalog.map((endpoint) => endpoint.id));
  const unknown = normalized.filter((id) => !endpointIdsById.has(id));
  if (unknown.length) {
    throw new Error(`Unknown official import endpoint id: ${unknown[0]}`);
  }
  return [...new Set(normalized)];
}

function normalizeAccountId(accountId) {
  const normalized = String(accountId || "").trim();
  if (!/^[a-zA-Z0-9:._@-]{1,120}$/u.test(normalized)) {
    throw new Error("Official import worker account id must be a stable non-secret identifier.");
  }
  return normalized;
}

function emptyResult({ status, providerId, accountId, importedAt, skippedEndpoints = [] }) {
  return {
    status,
    providerId,
    accountId,
    importMode,
    importedAt: new Date(importedAt()).toISOString(),
    importedEndpoints: [],
    skippedEndpoints,
    activities: [],
    summary: summarizeActivities([]),
    guardrails: [...guardrails]
  };
}
