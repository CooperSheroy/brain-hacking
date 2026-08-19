import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createRequestHandler } from "../server.js";
import { createInMemoryTokenVault } from "../src/integrations/tokenVault.js";

test("server creates OAuth authorization metadata and verifies callback state", async () => {
  const server = createServer(
    createRequestHandler({
      stateStore: new Map(),
      now: () => Date.parse("2026-07-29T10:02:00.000Z")
    })
  );
  await listen(server);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const authorizationResponse = await fetch(`${baseUrl}/api/oauth/authorization?provider=twitter`);
    const authorization = await authorizationResponse.json();

    assert.equal(authorizationResponse.status, 200);
    assert.equal(authorization.providerId, "twitter");
    assert.ok(authorization.authorizationUrl.includes("response_type=code"));
    assert.ok(authorization.stateNonce);
    assert.equal(authorization.guardrails.includes("no passwords or browser token storage"), true);

    const callbackResponse = await fetch(
      `${baseUrl}/oauth/callback?code=provider-code-123&state=${authorization.stateNonce}`
    );
    const callback = await callbackResponse.json();

    assert.equal(callbackResponse.status, 200);
    assert.equal(callback.status, "authorization-code-received");
    assert.equal(callback.tokenExchangeReady, false);
    assert.equal("code" in callback, false);
  } finally {
    await close(server);
  }
});

test("server exchanges verified OAuth callbacks through backend vault wiring", async () => {
  const stateStore = new Map();
  const vault = createInMemoryTokenVault({
    encryptionKey: new Uint8Array(32).fill(7),
    now: () => Date.parse("2026-08-18T09:30:00.000Z"),
    randomBytes: (length) => new Uint8Array(length).fill(5)
  });
  let capturedTokenRequest;
  const server = createServer(
    createRequestHandler({
      stateStore,
      now: () => Date.parse("2026-08-18T09:30:00.000Z"),
      oauthRuntime: {
        fetchImpl: async (url, init) => {
          capturedTokenRequest = { url, init };
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                access_token: "server-side-access-token",
                refresh_token: "server-side-refresh-token",
                token_type: "Bearer",
                expires_in: 3600,
                scope: "tweet.read users.read"
              };
            }
          };
        },
        loadTokenVault: () => vault,
        getClientConfig: () => ({ clientId: "client-123" })
      }
    })
  );
  await listen(server);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const authorizationResponse = await fetch(`${baseUrl}/api/oauth/authorization?provider=twitter`);
    const authorization = await authorizationResponse.json();
    const exchangeResponse = await fetch(`${baseUrl}/api/oauth/token-exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "twitter",
        stateNonce: authorization.stateNonce,
        authorizationCode: "provider-code-123",
        accountId: "user-123"
      })
    });
    const exchange = await exchangeResponse.json();

    assert.equal(exchangeResponse.status, 200);
    assert.equal(exchange.status, "token-exchange-complete");
    assert.equal(exchange.providerId, "twitter");
    assert.equal(exchange.exchange.status, "token-grant-saved");
    assert.equal(exchange.exchange.grant.hasRefreshToken, true);
    assert.equal(JSON.stringify(exchange).includes("server-side-access-token"), false);
    assert.equal(JSON.stringify(exchange).includes("provider-code-123"), false);
    assert.equal(stateStore.size, 0);
    assert.equal(capturedTokenRequest.url, "https://api.twitter.com/2/oauth2/token");
    assert.equal(vault.loadGrant({ providerId: "twitter", accountId: "user-123" }).tokenSet.accessToken, "server-side-access-token");
  } finally {
    await close(server);
  }
});

test("server exposes sanitized OAuth grant list, export, and disconnect controls", async () => {
  const vault = createInMemoryTokenVault({
    encryptionKey: new Uint8Array(32).fill(10),
    now: () => Date.parse("2026-08-19T04:10:00.000Z"),
    randomBytes: (length) => new Uint8Array(length).fill(6)
  });
  vault.saveGrant({
    providerId: "twitter",
    accountId: "user-123",
    scopes: ["tweet.read", "users.read"],
    tokenSet: {
      accessToken: "server-side-access-token",
      refreshToken: "server-side-refresh-token",
      tokenType: "Bearer",
      expiresAt: "2026-08-19T05:10:00.000Z"
    }
  });

  const server = createServer(
    createRequestHandler({
      now: () => Date.parse("2026-08-19T04:10:00.000Z"),
      oauthRuntime: {
        fetchImpl: async () => {
          throw new Error("fetch should not run");
        },
        loadTokenVault: () => vault,
        getClientConfig: () => ({ clientId: "client-123" })
      }
    })
  );
  await listen(server);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const listResponse = await fetch(`${baseUrl}/api/oauth/grants?provider=twitter`);
    const listing = await listResponse.json();
    const exportResponse = await fetch(`${baseUrl}/api/oauth/grants/export`);
    const exported = await exportResponse.json();
    const deleteResponse = await fetch(`${baseUrl}/api/oauth/grants`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "twitter", accountId: "user-123" })
    });
    const disconnected = await deleteResponse.json();
    const emptyResponse = await fetch(`${baseUrl}/api/oauth/grants`);
    const empty = await emptyResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(listing.status, "oauth-grant-list-ready");
    assert.equal(listing.grants.length, 1);
    assert.equal(listing.grants[0].accountId, "user-123");
    assert.equal(exportResponse.status, 200);
    assert.equal(exported.status, "oauth-grant-export-ready");
    assert.equal(JSON.stringify(exported).includes("server-side-access-token"), false);
    assert.equal(JSON.stringify(exported).includes("server-side-refresh-token"), false);
    assert.equal(deleteResponse.status, 200);
    assert.equal(disconnected.status, "oauth-grant-disconnected");
    assert.equal(disconnected.deleted, true);
    assert.equal(emptyResponse.status, 200);
    assert.deepEqual(empty.grants, []);
  } finally {
    await close(server);
  }
});

test("server rejects OAuth callbacks that lack server-created state", async () => {
  const server = createServer(createRequestHandler({ stateStore: new Map() }));
  await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/oauth/callback?code=abc&state=unknown`);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.error, /state could not be verified/u);
  } finally {
    await close(server);
  }
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
