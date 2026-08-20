import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryOAuthAuditLog } from "../src/integrations/oauthAuditLog.js";
import { createOfficialReadClient, listOfficialReadEndpoints } from "../src/integrations/officialApiClient.js";
import { createInMemoryTokenVault } from "../src/integrations/tokenVault.js";

const key = new Uint8Array(32).fill(7);
const now = () => Date.parse("2026-08-04T08:00:00.000Z");

function createVault(scopes = ["tweet.read", "users.read"], tokenSet = {}) {
  const vault = createInMemoryTokenVault({
    encryptionKey: key,
    now,
    randomBytes: (length) => new Uint8Array(length).fill(3)
  });
  vault.saveGrant({
    providerId: "twitter",
    accountId: "user-123",
    scopes,
    tokenSet: {
      accessToken: "server-side-access-token",
      tokenType: "Bearer",
      expiresAt: "2026-08-04T09:00:00.000Z",
      ...tokenSet
    }
  });
  return vault;
}

test("listOfficialReadEndpoints exposes least-privilege read endpoints without URLs", () => {
  const endpoints = listOfficialReadEndpoints("twitter");

  assert.deepEqual(
    endpoints.map((endpoint) => [endpoint.id, endpoint.scope, endpoint.method]),
    [
      ["liked-posts", "tweet.read", "GET"],
      ["following", "users.read", "GET"]
    ]
  );
  assert.equal("urlTemplate" in endpoints[0], false);
  assert.throws(() => listOfficialReadEndpoints("manual"), /does not support official OAuth API reads/u);
});

test("official read client imports provider data through vault-backed read requests", async () => {
  let capturedRequest;
  const auditLog = createMemoryOAuthAuditLog({ now });
  const client = createOfficialReadClient({
    providerId: "twitter",
    accountId: "user-123",
    tokenVault: createVault(),
    auditLog,
    now,
    fetchImpl: async (url, init) => {
      capturedRequest = { url, init };
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: [
              {
                id: "tweet-1",
                text: "Deep work planning thread",
                createdAt: "2026-08-03T16:30:00.000Z",
                url: "https://twitter.com/example/status/1"
              }
            ]
          };
        }
      };
    }
  });

  const result = await client.importActivities("liked-posts", { limit: 10 });

  assert.equal(capturedRequest.url, "https://api.twitter.com/2/users/user-123/liked_tweets?limit=10");
  assert.equal(capturedRequest.init.method, "GET");
  assert.equal(capturedRequest.init.headers.authorization, "Bearer server-side-access-token");
  assert.equal(result.importMode, "official OAuth read import");
  assert.equal(result.requiredScope, "tweet.read");
  assert.equal(result.signalType, "likes");
  assert.equal(result.summary.total, 1);
  assert.equal(result.summary.bySource.twitter, 1);
  assert.equal(result.summary.byType.like, 1);
  assert.deepEqual(
    auditLog.list().map((event) => [event.status, event.metadata.endpointId]),
    [
      ["official-read-import-started", "liked-posts"],
      ["official-read-import-succeeded", "liked-posts"]
    ]
  );
  assert.deepEqual(result.activities, [
    {
      id: "twitter-tweet-1",
      source: "twitter",
      type: "like",
      label: "Deep work planning thread",
      weight: 1,
      capturedAt: "2026-08-03T16:30:00.000Z",
      externalId: "tweet-1",
      url: "https://twitter.com/example/status/1",
      permissionScope: "tweet.read"
    }
  ]);
  assert.equal(JSON.stringify(result).includes("server-side-access-token"), false);
});

test("official read client blocks missing scopes and expired grants before fetch", async () => {
  const fetchImpl = async () => {
    throw new Error("fetch should not run");
  };

  const missingScopeClient = createOfficialReadClient({
    providerId: "twitter",
    accountId: "user-123",
    tokenVault: createVault(["users.read"]),
    fetchImpl,
    now
  });
  await assert.rejects(
    () => missingScopeClient.importActivities("liked-posts"),
    /missing required scope: tweet.read/u
  );

  const expiredClient = createOfficialReadClient({
    providerId: "twitter",
    accountId: "user-123",
    tokenVault: createVault(["tweet.read"], { expiresAt: "2026-08-04T07:59:00.000Z" }),
    fetchImpl,
    now
  });
  await assert.rejects(() => expiredClient.importActivities("liked-posts"), /has expired/u);
});

test("official read client surfaces provider failures and rate limits", async () => {
  const auditLog = createMemoryOAuthAuditLog({ now });
  const rateLimitedClient = createOfficialReadClient({
    providerId: "twitter",
    accountId: "user-123",
    tokenVault: createVault(),
    auditLog,
    now,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      async json() {
        return { title: "Too many requests" };
      }
    })
  });

  await assert.rejects(() => rateLimitedClient.importActivities("liked-posts"), /rate limit/u);
  assert.deepEqual(
    auditLog.list().map((event) => event.status),
    ["official-read-import-started", "official-read-import-failed"]
  );

  const failedClient = createOfficialReadClient({
    providerId: "twitter",
    accountId: "user-123",
    tokenVault: createVault(),
    now,
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      async json() {
        return { error: { message: "scope revoked" } };
      }
    })
  });

  await assert.rejects(() => failedClient.importActivities("liked-posts"), /scope revoked/u);
});
