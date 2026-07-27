const textEncoder = new TextEncoder();

export function createOAuthState({ providerId, scopes, redirectUri, randomBytes = secureRandomBytes, now = Date.now }) {
  assertProviderId(providerId);
  assertScopes(scopes);
  assertRedirectUri(redirectUri);

  const verifier = base64Url(randomBytes(32));
  const nonce = base64Url(randomBytes(16));

  return {
    providerId,
    scopes: [...scopes],
    redirectUri,
    nonce,
    codeVerifier: verifier,
    createdAt: new Date(now()).toISOString()
  };
}

export async function buildAuthorizationRequest(provider, state, options = {}) {
  if (!provider?.oauth?.authorizationUrl) {
    throw new Error(`Provider ${provider?.id || "unknown"} does not support OAuth authorization.`);
  }
  if (provider.id !== state.providerId) {
    throw new Error(`OAuth state provider ${state.providerId} does not match ${provider.id}.`);
  }

  const challenge = await pkceChallenge(state.codeVerifier, options.digest);
  const url = new URL(provider.oauth.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", options.clientId || provider.oauth.clientIdPlaceholder);
  url.searchParams.set("redirect_uri", state.redirectUri);
  url.searchParams.set("scope", state.scopes.join(" "));
  url.searchParams.set("state", state.nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return {
    url: url.toString(),
    state,
    codeChallenge: challenge,
    codeChallengeMethod: "S256"
  };
}

export function summarizeConsent(provider, scopes) {
  const knownScopes = new Map(provider.scopes.map((scope) => [scope.id, scope]));
  return scopes.map((scopeId) => {
    const scope = knownScopes.get(scopeId);
    return {
      id: scopeId,
      label: scope?.label || scopeId,
      risk: scope?.risk || "unknown",
      reason: scope?.reason || "Requested by the provider adapter."
    };
  });
}

async function pkceChallenge(verifier, digest = defaultDigest) {
  const hash = await digest(textEncoder.encode(verifier));
  return base64Url(new Uint8Array(hash));
}

async function defaultDigest(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is required to create PKCE challenges.");
  }
  return crypto.subtle.digest("SHA-256", bytes);
}

function secureRandomBytes(length) {
  const bytes = new Uint8Array(length);
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Web Crypto is required to create OAuth state.");
  }
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes) {
  const encoded = btoa(String.fromCharCode(...bytes));
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function assertProviderId(providerId) {
  if (!/^[a-z][a-z0-9-]{1,40}$/u.test(providerId || "")) {
    throw new Error("Invalid provider id.");
  }
}

function assertScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("At least one OAuth scope is required.");
  }
  for (const scope of scopes) {
    if (!/^[a-zA-Z0-9:._-]+$/u.test(scope)) {
      throw new Error(`Invalid OAuth scope: ${scope}`);
    }
  }
}

function assertRedirectUri(redirectUri) {
  const parsed = new URL(redirectUri);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Redirect URI must be http or https.");
  }
}
