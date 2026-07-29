import { createHash, timingSafeEqual } from "node:crypto";
import { getProvider } from "./providers.js";

const defaultMaxAgeMs = 10 * 60 * 1000;

export function parseOAuthCallback(callbackUrl, pendingStates, options = {}) {
  const url = new URL(callbackUrl, "http://localhost");
  const receivedAt = new Date((options.now || Date.now)()).toISOString();
  const stateNonce = readOAuthParam(url, "state");
  const providerError = readOAuthParam(url, "error");
  const providerErrorDescription = readOAuthParam(url, "error_description");
  const pendingState = stateNonce ? findPendingState(pendingStates, stateNonce) : null;

  if (providerError) {
    return {
      ok: false,
      status: "provider-error",
      providerId: pendingState?.providerId || null,
      stateNonce,
      stateVerified: Boolean(pendingState),
      error: providerError,
      errorDescription: providerErrorDescription,
      receivedAt
    };
  }

  const authorizationCode = readOAuthParam(url, "code");
  if (!authorizationCode) {
    throw new Error("OAuth callback is missing authorization code.");
  }
  if (!stateNonce) {
    throw new Error("OAuth callback is missing state.");
  }
  if (!pendingState) {
    throw new Error("OAuth callback state could not be verified.");
  }

  assertStateFresh(pendingState, options.maxAgeMs ?? defaultMaxAgeMs, options.now || Date.now);
  const provider = getProvider(pendingState.providerId);

  return {
    ok: true,
    status: "authorization-code-received",
    providerId: provider.id,
    label: provider.label,
    stateNonce,
    stateVerified: true,
    scopes: [...pendingState.scopes],
    redirectUri: pendingState.redirectUri,
    authorizationCodeFingerprint: fingerprintSecret(authorizationCode),
    receivedAt,
    tokenExchangeReady: false,
    nextRequiredStep: "Exchange the code in a backend service, then store encrypted tokens server-side.",
    guardrails: [
      "do not persist raw authorization codes",
      "do not expose token material to the browser",
      "do not call provider APIs until encrypted token storage exists"
    ]
  };
}

function readOAuthParam(url, name) {
  const value = url.searchParams.get(name);
  if (!value) return "";
  if (!/^[a-zA-Z0-9._~:/?#\[\]@!$&'()*+,;=% -]{1,2048}$/u.test(value)) {
    throw new Error(`Invalid OAuth callback parameter: ${name}`);
  }
  return value;
}

function findPendingState(pendingStates, stateNonce) {
  return [...pendingStates].find((state) => constantTimeEqual(state.nonce, stateNonce)) || null;
}

function constantTimeEqual(left = "", right = "") {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertStateFresh(state, maxAgeMs, now) {
  const createdAtMs = Date.parse(state.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    throw new Error("OAuth callback state has an invalid creation timestamp.");
  }
  if (now() - createdAtMs > maxAgeMs) {
    throw new Error("OAuth callback state has expired.");
  }
}

function fingerprintSecret(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
