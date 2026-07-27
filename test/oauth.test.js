import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildAuthorizationRequest, createOAuthState, summarizeConsent } from "../src/integrations/oauth.js";
import { getProvider } from "../src/integrations/providers.js";

test("createOAuthState builds auditable PKCE state", () => {
  const state = createOAuthState({
    providerId: "twitter",
    scopes: ["tweet.read", "users.read"],
    redirectUri: "http://localhost:4175/oauth/callback",
    randomBytes: (length) => new Uint8Array(length).fill(7),
    now: () => 1785150000000
  });

  assert.equal(state.providerId, "twitter");
  assert.deepEqual(state.scopes, ["tweet.read", "users.read"]);
  assert.equal(state.createdAt, "2026-07-27T11:00:00.000Z");
  assert.ok(state.codeVerifier.length > 20);
  assert.ok(state.nonce.length > 10);
});

test("buildAuthorizationRequest creates provider authorization URL", async () => {
  const provider = getProvider("twitter");
  const state = createOAuthState({
    providerId: "twitter",
    scopes: provider.defaultScopes,
    redirectUri: "http://localhost:4175/oauth/callback",
    randomBytes: (length) => new Uint8Array(length).fill(3)
  });
  const digest = async (bytes) => createHash("sha256").update(bytes).digest();

  const request = await buildAuthorizationRequest(provider, state, {
    clientId: "client-123",
    digest
  });
  const url = new URL(request.url);

  assert.equal(url.origin, "https://twitter.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-123");
  assert.equal(url.searchParams.get("scope"), "tweet.read users.read offline.access");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("state"));
});

test("summarizeConsent maps provider scopes to risk labels", () => {
  const provider = getProvider("instagram");
  const consent = summarizeConsent(provider, provider.defaultScopes);

  assert.deepEqual(
    consent.map((scope) => scope.risk),
    ["low", "medium"]
  );
});
