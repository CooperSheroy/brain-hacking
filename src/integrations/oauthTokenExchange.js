import { createHash } from "node:crypto";
import { getProvider } from "./providers.js";

export function summarizeTokenExchangeRequirements(providerId) {
  const provider = assertExchangeProvider(providerId);
  return {
    providerId: provider.id,
    label: provider.label,
    status: "backend-token-exchange-boundary-ready",
    tokenEndpoint: provider.oauth.tokenUrl,
    clientIdEnv: provider.oauth.clientIdPlaceholder,
    clientSecretEnv: provider.oauth.clientSecretPlaceholder || null,
    grantType: "authorization_code",
    guardrails: [
      "exchange authorization codes server-side only",
      "persist token material only through the encrypted token vault",
      "return grant summaries without raw codes, secrets, or tokens"
    ]
  };
}

export async function exchangeAuthorizationCodeForGrant({
  providerId,
  accountId,
  authorizationCode,
  oauthState,
  tokenVault,
  clientConfig,
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  const provider = assertExchangeProvider(providerId);
  const state = assertOAuthState(provider, oauthState);
  const code = normalizeAuthorizationCode(authorizationCode);
  const account = normalizeAccountId(accountId);
  const client = normalizeClientConfig(provider, clientConfig);

  if (!tokenVault?.saveGrant) {
    throw new TypeError("OAuth token exchange requires an encrypted server-side token vault.");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("OAuth token exchange requires a fetch implementation.");
  }

  const issuedAtMs = now();
  const response = await fetchImpl(provider.oauth.tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body: buildTokenRequestBody({ code, state, client })
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(formatExchangeError(provider.id, response.status, payload));
  }

  const grantSummary = tokenVault.saveGrant({
    providerId: provider.id,
    accountId: account,
    scopes: resolveGrantedScopes(provider, state.scopes, payload.scope),
    tokenSet: normalizeTokenResponse(payload, issuedAtMs),
    nowValue: issuedAtMs
  });

  return {
    providerId: provider.id,
    accountId: account,
    status: "token-grant-saved",
    authorizationCodeFingerprint: fingerprintSecret(code),
    grant: grantSummary,
    guardrails: [
      "raw authorization code was not returned",
      "raw token material was stored only in the encrypted vault",
      "provider API reads still require endpoint scope checks"
    ]
  };
}

function assertExchangeProvider(providerId) {
  const provider = getProvider(providerId);
  if (provider.mode !== "oauth-pkce" || !provider.oauth?.tokenUrl) {
    throw new Error(`${provider.label} does not support OAuth token exchange.`);
  }
  return provider;
}

function assertOAuthState(provider, state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("OAuth token exchange requires verified PKCE state.");
  }
  if (state.providerId !== provider.id) {
    throw new Error(`OAuth state provider ${state.providerId || "unknown"} does not match ${provider.id}.`);
  }
  if (!Array.isArray(state.scopes) || state.scopes.length === 0) {
    throw new Error("OAuth state must include requested scopes.");
  }
  if (!state.redirectUri) {
    throw new Error("OAuth state must include the redirect URI used during consent.");
  }
  if (!state.codeVerifier) {
    throw new Error("OAuth state must include the PKCE code verifier.");
  }
  return state;
}

function normalizeAuthorizationCode(authorizationCode) {
  const code = String(authorizationCode || "").trim();
  if (!/^[a-zA-Z0-9._~:/?#\[\]@!$&'()*+,;=%-]{8,2048}$/u.test(code)) {
    throw new Error("OAuth authorization code must be a provider-issued opaque value.");
  }
  return code;
}

function normalizeAccountId(accountId) {
  const normalized = String(accountId || "").trim();
  if (!/^[a-zA-Z0-9:._@-]{1,120}$/u.test(normalized)) {
    throw new Error("OAuth token exchange account id must be a stable non-secret identifier.");
  }
  return normalized;
}

function normalizeClientConfig(provider, clientConfig = {}) {
  const clientId = String(clientConfig.clientId || "").trim();
  if (!clientId || clientId === provider.oauth.clientIdPlaceholder) {
    throw new Error(`OAuth token exchange requires ${provider.oauth.clientIdPlaceholder}.`);
  }

  const clientSecret = String(clientConfig.clientSecret || "").trim();
  if (provider.oauth.clientSecretPlaceholder && clientSecret === provider.oauth.clientSecretPlaceholder) {
    throw new Error(`OAuth token exchange requires real server-side ${provider.oauth.clientSecretPlaceholder}.`);
  }

  return { clientId, clientSecret };
}

function buildTokenRequestBody({ code, state, client }) {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", state.redirectUri);
  body.set("code_verifier", state.codeVerifier);
  body.set("client_id", client.clientId);
  if (client.clientSecret) {
    body.set("client_secret", client.clientSecret);
  }
  return body.toString();
}

async function readJsonResponse(response) {
  if (!response || typeof response !== "object") {
    throw new TypeError("OAuth token endpoint response must be an object.");
  }
  if (typeof response.json === "function") {
    return response.json();
  }
  return {};
}

function resolveGrantedScopes(provider, requestedScopes, returnedScope) {
  const providerScopes = new Set(provider.scopes.map((scope) => scope.id));
  const returnedScopes = splitScopes(returnedScope);
  const scopes = returnedScopes.length ? returnedScopes : requestedScopes;

  for (const scope of scopes) {
    if (!providerScopes.has(scope)) {
      throw new Error(`OAuth token response included unsupported scope for ${provider.id}: ${scope}`);
    }
  }
  return [...new Set(scopes)];
}

function splitScopes(scopeValue) {
  return String(scopeValue || "")
    .split(/[\s,]+/u)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function normalizeTokenResponse(payload, issuedAtMs) {
  const accessToken = String(payload?.access_token || "").trim();
  if (!accessToken) {
    throw new Error("OAuth token response did not include an access token.");
  }

  const tokenSet = {
    accessToken,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type || "Bearer",
    issuedAt: new Date(issuedAtMs).toISOString(),
    scope: payload.scope
  };
  const expiresInSeconds = Number(payload.expires_in);
  if (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0) {
    tokenSet.expiresAt = new Date(issuedAtMs + expiresInSeconds * 1000).toISOString();
  }
  return tokenSet;
}

function formatExchangeError(providerId, status, payload) {
  const detail = cleanErrorDetail(payload?.error_description || payload?.error || payload?.title);
  return detail
    ? `${providerId} OAuth token exchange failed with status ${status}: ${detail}`
    : `${providerId} OAuth token exchange failed with status ${status}.`;
}

function cleanErrorDetail(value) {
  return String(value || "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
}

function fingerprintSecret(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
