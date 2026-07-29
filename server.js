import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";
import { getProvider } from "./src/integrations/providers.js";
import { buildAuthorizationRequest, createOAuthState, summarizeConsent } from "./src/integrations/oauth.js";
import { parseOAuthCallback } from "./src/integrations/oauthCallback.js";

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

  return async function handleRequest(req, res) {
    const requestUrl = req.url || "/";
    const parsed = new URL(requestUrl, `http://${req.headers.host || `localhost:${port}`}`);

    try {
      if (parsed.pathname === "/api/oauth/authorization") {
        await handleOAuthAuthorization(parsed, res, stateStore, now);
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
