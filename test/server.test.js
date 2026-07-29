import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createRequestHandler } from "../server.js";

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
