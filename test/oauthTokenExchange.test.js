import assert from "node:assert/strict";
import test from "node:test";
import {
  exchangeAuthorizationCodeForGrant,
  summarizeTokenExchangeRequirements
} from "../src/integrations/oauthTokenExchange.js";
import { createInMemoryTokenVault } from "../src/integrations/tokenVault.js";

const key = new Uint8Array(32).fill(9);
const now = () => Date.parse("2026-08-05T09:00:00.000Z");
const oauthState = {
  providerId: "twitter",
  scopes: ["tweet.read", "users.read"],
  redirectUri: "http://localhost:4175/oauth/callback",
  nonce: "nonce-123",
  codeVerifier: "verifier-123",
  createdAt: "2026-08-05T08:58:00.000Z"
};

function createVault() {
  return createInMemoryTokenVault({
    encryptionKey: key,
    now,
    randomBytes: (length) => new Uint8Array(length).fill(4)
  });
}

test("summarizeTokenExchangeRequirements exposes backend-only exchange guardrails", () => {
  const summary = summarizeTokenExchangeRequirements("twitter");

  assert.equal(summary.providerId, "twitter");
  assert.equal(summary.tokenEndpoint, "https://api.twitter.com/2/oauth2/token");
  assert.equal(summary.clientIdEnv, "TWITTER_CLIENT_ID");
  assert.equal(summary.clientSecretEnv, null);
  assert.ok(summary.guardrails.some((item) => item.includes("server-side only")));
});

test("exchangeAuthorizationCodeForGrant posts a PKCE token request and saves an encrypted grant summary", async () => {
  const vault = createVault();
  let capturedRequest;

  const result = await exchangeAuthorizationCodeForGrant({
    providerId: "twitter",
    accountId: "user-123",
    authorizationCode: "provider-code-123",
    oauthState,
    tokenVault: vault,
    clientConfig: { clientId: "client-123" },
    fetchImpl: async (url, init) => {
      capturedRequest = { url, init };
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
    now
  });

  const body = new URLSearchParams(capturedRequest.init.body);

  assert.equal(capturedRequest.url, "https://api.twitter.com/2/oauth2/token");
  assert.equal(capturedRequest.init.method, "POST");
  assert.equal(capturedRequest.init.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "provider-code-123");
  assert.equal(body.get("redirect_uri"), oauthState.redirectUri);
  assert.equal(body.get("code_verifier"), "verifier-123");
  assert.equal(body.get("client_id"), "client-123");
  assert.equal(result.status, "token-grant-saved");
  assert.equal(result.grant.hasRefreshToken, true);
  assert.equal(result.grant.tokenExpiresAt, "2026-08-05T10:00:00.000Z");
  assert.deepEqual(result.grant.scopes, ["tweet.read", "users.read"]);
  assert.equal(JSON.stringify(result).includes("server-side-access-token"), false);
  assert.equal(JSON.stringify(result).includes("provider-code-123"), false);
  assert.equal(vault.loadGrant({ providerId: "twitter", accountId: "user-123" }).tokenSet.accessToken, "server-side-access-token");
});

test("exchangeAuthorizationCodeForGrant rejects placeholder clients and mismatched state before fetch", async () => {
  const fetchImpl = async () => {
    throw new Error("fetch should not run");
  };

  await assert.rejects(
    () =>
      exchangeAuthorizationCodeForGrant({
        providerId: "twitter",
        accountId: "user-123",
        authorizationCode: "provider-code-123",
        oauthState,
        tokenVault: createVault(),
        clientConfig: { clientId: "TWITTER_CLIENT_ID" },
        fetchImpl,
        now
      }),
    /requires TWITTER_CLIENT_ID/u
  );

  await assert.rejects(
    () =>
      exchangeAuthorizationCodeForGrant({
        providerId: "twitter",
        accountId: "user-123",
        authorizationCode: "provider-code-123",
        oauthState: { ...oauthState, providerId: "instagram" },
        tokenVault: createVault(),
        clientConfig: { clientId: "client-123" },
        fetchImpl,
        now
      }),
    /does not match twitter/u
  );
});

test("exchangeAuthorizationCodeForGrant fails closed on provider errors and unsupported returned scopes", async () => {
  await assert.rejects(
    () =>
      exchangeAuthorizationCodeForGrant({
        providerId: "twitter",
        accountId: "user-123",
        authorizationCode: "provider-code-123",
        oauthState,
        tokenVault: createVault(),
        clientConfig: { clientId: "client-123" },
        fetchImpl: async () => ({
          ok: false,
          status: 400,
          async json() {
            return { error_description: "invalid grant" };
          }
        }),
        now
      }),
    /invalid grant/u
  );

  await assert.rejects(
    () =>
      exchangeAuthorizationCodeForGrant({
        providerId: "twitter",
        accountId: "user-123",
        authorizationCode: "provider-code-123",
        oauthState,
        tokenVault: createVault(),
        clientConfig: { clientId: "client-123" },
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          async json() {
            return {
              access_token: "server-side-access-token",
              scope: "tweet.write"
            };
          }
        }),
        now
      }),
    /unsupported scope/u
  );
});
