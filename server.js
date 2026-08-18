import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";
import { getProvider } from "./src/integrations/providers.js";
import { buildAuthorizationRequest, createOAuthState, summarizeConsent } from "./src/integrations/oauth.js";
import { parseOAuthCallback } from "./src/integrations/oauthCallback.js";
import { exchangeAuthorizationCodeForGrant } from "./src/integrations/oauthTokenExchange.js";
import { createServerOAuthRuntime, summarizeServerOAuthRuntime } from "./src/integrations/oauthRuntime.js";

const root = process.cwd();
const port = Number(process.env.PORT || 4175);
const pendingOAuthStates = new Map();

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

export function createRequestHandler(options = {}) {
  const rootDir = options.rootDir || root;
  const stateStore = options.stateStore || pendingOAuthStates;
  const now = options.now || Date.now;
  const oauthRuntime =
    options.oauthRuntime ||
    createServerOAuthRuntime({
      env: options.env || process.env,
      rootDir,
      fetchImpl: options.fetchImpl || globalThis.fetch,
      now
    });

  return async function handleRequest(req, res) {
    const requestUrl = req.url || "/";
    const parsed = new URL(requestUrl, `http://${req.headers.host || `localhost:${port}`}`);

    try {
      if (parsed.pathname === "/api/oauth/authorization") {
        await handleOAuthAuthorization(parsed, res, stateStore, now);
        return;
      }

      if (parsed.pathname === "/api/oauth/token-exchange") {
        await handleOAuthTokenExchange(req, res, stateStore, oauthRuntime, now);
        return;
      }

      if (parsed.pathname === "/api/oauth/runtime") {
        sendJson(res, 200, summarizeServerOAuthRuntime(options.env || process.env, rootDir));
        return;
      }

      if (parsed.pathname === "/oauth/callback") {
        handleOAuthCallback(requestUrl, res, stateStore, now);
        return;
      }

      const filePath = resolvePathForRoot(requestUrl, rootDir);
      const body = await readFile(filePath);
      send(res, 200, body, types[extname(filePath)] || "application/octet-stream");
    } catch (error) {
      if (parsed.pathname.startsWith("/api/") || parsed.pathname === "/oauth/callback") {
        sendJson(res, 400, {
          ok: false,
          error: error.message
        });
        return;
      }

      send(res, 404, "Not found", "text/plain; charset=utf-8");
    }
  };
}

function resolvePathForRoot(url, rootDir) {
  const requested = new URL(url, `http://localhost:${port}`).pathname;
  const clean = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  if (clean === "/" || !extname(clean)) {
    return join(rootDir, "index.html");
  }
  return join(rootDir, clean);
}

async function handleOAuthAuthorization(url, res, stateStore, now) {
  const providerId = url.searchParams.get("provider") || "";
  const provider = getProvider(providerId);
  if (provider.mode !== "oauth-pkce") {
    throw new Error(`${provider.label} does not require OAuth authorization.`);
  }

  const redirectUri = url.searchParams.get("redirect_uri") || `${url.origin}/oauth/callback`;
  const state = createOAuthState({
    providerId: provider.id,
    scopes: provider.defaultScopes,
    redirectUri,
    randomBytes: (length) => new Uint8Array(randomBytes(length)),
    now
  });
  stateStore.set(state.nonce, state);

  const clientId = process.env[provider.oauth.clientIdPlaceholder] || provider.oauth.clientIdPlaceholder;
  const request = await buildAuthorizationRequest(provider, state, {
    clientId,
    digest: nodeSha256Digest
  });

  sendJson(res, 200, {
    providerId: provider.id,
    label: provider.label,
    authorizationUrl: request.url,
    redirectUri: state.redirectUri,
    stateNonce: state.nonce,
    expiresInSeconds: 600,
    scopes: summarizeConsent(provider, state.scopes),
    guardrails: [
      "official OAuth only",
      "least-privilege read scopes",
      "no passwords or browser token storage"
    ]
  });
}

function handleOAuthCallback(requestUrl, res, stateStore, now) {
  const result = parseOAuthCallback(requestUrl, stateStore.values(), { now });
  if (result.stateNonce) {
    stateStore.delete(result.stateNonce);
  }
  sendJson(res, result.ok ? 200 : 400, result);
}

async function handleOAuthTokenExchange(req, res, stateStore, oauthRuntime, now) {
  if (req.method !== "POST") {
    throw new Error("OAuth token exchange route requires POST.");
  }

  const payload = await readJsonBody(req);
  const stateNonce = normalizeRouteValue(payload.stateNonce || payload.state, "OAuth state nonce");
  const authorizationCode = normalizeRouteValue(payload.authorizationCode || payload.code, "OAuth authorization code");
  const accountId = normalizeRouteValue(payload.accountId, "OAuth account id");
  const pendingState = stateStore.get(stateNonce);

  if (!pendingState) {
    throw new Error("OAuth callback state could not be verified.");
  }
  if (payload.providerId && payload.providerId !== pendingState.providerId) {
    throw new Error(`OAuth token exchange provider ${payload.providerId} does not match pending state.`);
  }

  const callbackAudit = parseOAuthCallback(
    `/oauth/callback?code=${encodeURIComponent(authorizationCode)}&state=${encodeURIComponent(stateNonce)}`,
    stateStore.values(),
    { now }
  );
  const exchange = await exchangeAuthorizationCodeForGrant({
    providerId: pendingState.providerId,
    accountId,
    authorizationCode,
    oauthState: pendingState,
    tokenVault: oauthRuntime.loadTokenVault(),
    clientConfig: oauthRuntime.getClientConfig(pendingState.providerId),
    fetchImpl: oauthRuntime.fetchImpl,
    now
  });

  stateStore.delete(stateNonce);
  sendJson(res, 200, {
    ok: true,
    status: "token-exchange-complete",
    providerId: exchange.providerId,
    accountId: exchange.accountId,
    callback: callbackAudit,
    exchange,
    guardrails: [
      "authorization code was consumed by the backend route",
      "token material was persisted only through the encrypted vault",
      "response contains only sanitized grant metadata"
    ]
  });
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8192) {
      throw new Error("OAuth token exchange request body is too large.");
    }
  }

  if (!body.trim()) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("OAuth token exchange request body must be JSON.");
  }
}

function normalizeRouteValue(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

async function nodeSha256Digest(bytes) {
  return createHash("sha256").update(bytes).digest();
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload, null, 2), "application/json; charset=utf-8");
}

function send(res, status, body, contentType) {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(body);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const server = createServer(createRequestHandler());
  server.listen(port, () => {
    console.log(`Brain Hacking is running at http://localhost:${port}`);
  });
}
