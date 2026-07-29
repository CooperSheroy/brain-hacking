import assert from "node:assert/strict";
import test from "node:test";
import { parseOAuthCallback } from "../src/integrations/oauthCallback.js";

const pendingState = {
  providerId: "twitter",
  scopes: ["tweet.read", "users.read"],
  redirectUri: "http://localhost:4175/oauth/callback",
  nonce: "nonce-123",
  codeVerifier: "verifier-123",
  createdAt: "2026-07-29T10:00:00.000Z"
};

test("parseOAuthCallback verifies pending state without exposing raw code", () => {
  const result = parseOAuthCallback(
    "/oauth/callback?code=provider-code-123&state=nonce-123",
    [pendingState],
    { now: () => Date.parse("2026-07-29T10:02:00.000Z") }
  );

  assert.equal(result.ok, true);
  assert.equal(result.providerId, "twitter");
  assert.equal(result.status, "authorization-code-received");
  assert.equal(result.stateVerified, true);
  assert.equal(result.tokenExchangeReady, false);
  assert.equal(result.authorizationCodeFingerprint.length, 16);
  assert.equal("code" in result, false);
  assert.equal("codeVerifier" in result, false);
});

test("parseOAuthCallback rejects unknown state", () => {
  assert.throws(
    () =>
      parseOAuthCallback("/oauth/callback?code=provider-code-123&state=wrong-state", [pendingState], {
        now: () => Date.parse("2026-07-29T10:02:00.000Z")
      }),
    /state could not be verified/u
  );
});

test("parseOAuthCallback marks provider denial without token exchange", () => {
  const result = parseOAuthCallback(
    "/oauth/callback?error=access_denied&error_description=user%20cancelled&state=nonce-123",
    [pendingState],
    { now: () => Date.parse("2026-07-29T10:02:00.000Z") }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, "provider-error");
  assert.equal(result.providerId, "twitter");
  assert.equal(result.stateVerified, true);
  assert.equal(result.error, "access_denied");
});
