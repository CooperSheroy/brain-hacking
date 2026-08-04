import { normalizeProviderActivities } from "./normalizedActivity.js";
import { getProvider } from "./providers.js";

const readEndpointCatalog = {
  twitter: [
    {
      id: "liked-posts",
      label: "Liked posts",
      scope: "tweet.read",
      signalType: "likes",
      urlTemplate: "https://api.twitter.com/2/users/{accountId}/liked_tweets"
    },
    {
      id: "following",
      label: "Following",
      scope: "users.read",
      signalType: "follows",
      urlTemplate: "https://api.twitter.com/2/users/{accountId}/following"
    }
  ],
  instagram: [
    {
      id: "owned-media",
      label: "Owned media",
      scope: "user_media",
      signalType: "media",
      urlTemplate: "https://graph.instagram.com/me/media"
    },
    {
      id: "profile",
      label: "Profile",
      scope: "user_profile",
      signalType: "profile",
      urlTemplate: "https://graph.instagram.com/me"
    }
  ],
  facebook: [
    {
      id: "profile",
      label: "Profile",
      scope: "public_profile",
      signalType: "profile",
      urlTemplate: "https://graph.facebook.com/v20.0/me"
    }
  ]
};

export function listOfficialReadEndpoints(providerId) {
  const provider = assertOAuthProvider(providerId);
  return getEndpointCatalog(provider.id).map(({ urlTemplate, ...endpoint }) => ({
    ...endpoint,
    method: "GET"
  }));
}

export function createOfficialReadClient({
  providerId,
  accountId,
  tokenVault,
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  const provider = assertOAuthProvider(providerId);
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!tokenVault?.loadGrant) {
    throw new TypeError("Official read client requires a backend token vault.");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Official read client requires a fetch implementation.");
  }

  return {
    providerId: provider.id,
    accountId: normalizedAccountId,
    endpoints: listOfficialReadEndpoints(provider.id),

    async importActivities(endpointId, options = {}) {
      const endpoint = findEndpoint(provider.id, endpointId);
      const grant = tokenVault.loadGrant({ providerId: provider.id, accountId: normalizedAccountId });
      assertUsableGrant(provider.id, grant, endpoint.scope, now);

      const url = buildEndpointUrl(endpoint, normalizedAccountId, options);
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `${grant.tokenSet.tokenType || "Bearer"} ${grant.tokenSet.accessToken}`
        }
      });

      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(formatProviderError(provider.id, response.status, payload));
      }

      const records = extractRecords(payload).map((record) => ({
        ...record,
        signalType: record.signalType || endpoint.signalType,
        permissionScope: record.permissionScope || endpoint.scope
      }));
      const activities = normalizeProviderActivities(provider.id, records);

      return {
        providerId: provider.id,
        accountId: normalizedAccountId,
        endpointId: endpoint.id,
        importedAt: new Date(now()).toISOString(),
        activities
      };
    }
  };
}

function assertOAuthProvider(providerId) {
  const provider = getProvider(providerId);
  if (provider.mode !== "oauth-pkce") {
    throw new Error(`${provider.label} does not support official OAuth API reads.`);
  }
  return provider;
}

function getEndpointCatalog(providerId) {
  return readEndpointCatalog[providerId] || [];
}

function findEndpoint(providerId, endpointId) {
  const endpoint = getEndpointCatalog(providerId).find((item) => item.id === endpointId);
  if (!endpoint) {
    throw new Error(`Unknown official read endpoint for ${providerId}: ${endpointId}`);
  }
  return endpoint;
}

function assertUsableGrant(providerId, grant, requiredScope, now) {
  if (!grant?.tokenSet?.accessToken) {
    throw new Error(`No usable OAuth access token found for ${providerId}.`);
  }
  if (!grant.scopes?.includes(requiredScope)) {
    throw new Error(`OAuth grant for ${providerId} is missing required scope: ${requiredScope}`);
  }
  if (grant.tokenExpiresAt && Date.parse(grant.tokenExpiresAt) <= now()) {
    throw new Error(`OAuth grant for ${providerId} has expired.`);
  }
}

function buildEndpointUrl(endpoint, accountId, options) {
  const url = new URL(endpoint.urlTemplate.replace("{accountId}", encodeURIComponent(accountId)));
  const limit = Number(options.limit);
  if (Number.isInteger(limit) && limit > 0) {
    url.searchParams.set("limit", String(Math.min(limit, 100)));
  }
  return url.toString();
}

async function readJsonResponse(response) {
  if (!response || typeof response !== "object") {
    throw new TypeError("Provider API response must be an object.");
  }
  if (typeof response.json !== "function") {
    return {};
  }
  return response.json();
}

function formatProviderError(providerId, status, payload) {
  if (status === 429) {
    return `${providerId} API rate limit reached; retry after the provider reset window.`;
  }
  const detail = cleanErrorDetail(payload?.error_description || payload?.error?.message || payload?.title);
  return detail
    ? `${providerId} API read failed with status ${status}: ${detail}`
    : `${providerId} API read failed with status ${status}.`;
}

function extractRecords(payload) {
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (payload?.data && typeof payload.data === "object") {
    return [payload.data];
  }
  throw new Error("Provider API payload did not include importable data records.");
}

function normalizeAccountId(accountId) {
  const normalized = String(accountId || "").trim();
  if (!/^[a-zA-Z0-9:._@-]{1,120}$/u.test(normalized)) {
    throw new Error("Official read client account id must be a stable non-secret identifier.");
  }
  return normalized;
}

function cleanErrorDetail(value) {
  return String(value || "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
}
