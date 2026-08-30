import assert from "node:assert/strict";
import test from "node:test";
import { createOfficialImportWorker, summarizeOfficialImportWorkerReadiness } from "../src/integrations/officialImportWorker.js";
import { createMemoryOAuthAuditLog } from "../src/integrations/oauthAuditLog.js";
import { createInMemoryTokenVault } from "../src/integrations/tokenVault.js";

const key = new Uint8Array(32).fill(12);
const now = () => Date.parse("2026-08-21T04:30:00.000Z");

function createVault(scopes = ["tweet.read", "users.read"]) {
  const vault = createInMemoryTokenVault({
    encryptionKey: key,
    now,
    randomBytes: (length) => new Uint8Array(length).fill(9)
  });
  vault.saveGrant({
    providerId: "twitter",
    accountId: "user-123",
    scopes,
    tokenSet: {
      accessToken: "server-side-access-token",
      tokenType: "Bearer",
      expiresAt: "2026-08-21T05:30:00.000Z"
    }
  });
  return vault;
}

test("official import worker stays inert until explicitly enabled", async () => {
  const worker = createOfficialImportWorker({
    enabled: false,
    fetchImpl: async () => {
      throw new Error("fetch should not run while disabled");
    },
    now
  });

  const result = await worker.runImport({ providerId: "twitter", accountId: "user-123" });

  assert.equal(worker.enabled, false);
  assert.equal(result.status, "official-import-disabled");
  assert.equal(result.summary.total, 0);
  assert.equal(result.guardrails.some((guardrail) => guardrail.includes("feature-flagged")), true);
});

test("official import worker imports consented endpoints through the read client", async () => {
  const auditLog = createMemoryOAuthAuditLog({ now });
  const requestedUrls = [];
  const worker = createOfficialImportWorker({
    enabled: true,
    tokenVault: createVault(),
    auditLog,
    now,
    fetchImpl: async (url, init) => {
      requestedUrls.push(url);
      assert.equal(init.method, "GET");
      assert.equal(init.headers.authorization, "Bearer server-side-access-token");
      return {
        ok: true,
        status: 200,
        async json() {
          if (url.includes("liked_tweets")) {
            return { data: [{ id: "tweet-1", text: "Deep work system" }] };
          }
          return { data: [{ id: "account-1", text: "Fitness consistency coach" }] };
        }
      };
    }
  });

  const result = await worker.runImport({ providerId: "twitter", accountId: "user-123", limit: 5 });

  assert.equal(result.status, "official-import-succeeded");
  assert.deepEqual(result.importedEndpoints, ["liked-posts", "following"]);
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.bySource.twitter, 2);
  assert.equal(JSON.stringify(result).includes("server-side-access-token"), false);
  assert.deepEqual(requestedUrls, [
    "https://api.twitter.com/2/users/user-123/liked_tweets?limit=5",
    "https://api.twitter.com/2/users/user-123/following?limit=5"
  ]);
  assert.deepEqual(
    auditLog.list().map((event) => event.status),
    [
      "official-read-import-started",
      "official-read-import-succeeded",
      "official-read-import-started",
      "official-read-import-succeeded"
    ]
  );
});

test("official import worker passes endpoint cursors and returns next cursors", async () => {
  const requestedUrls = [];
  const worker = createOfficialImportWorker({
    enabled: true,
    tokenVault: createVault(["tweet.read"]),
    now,
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: [{ id: "tweet-2", text: "Reading queue cleanup" }],
            meta: { next_token: "next_page_2" }
          };
        }
      };
    }
  });

  const result = await worker.runImport({
    providerId: "twitter",
    accountId: "user-123",
    endpointIds: ["liked-posts"],
    cursors: { "liked-posts": "page_1" }
  });

  assert.equal(result.status, "official-import-succeeded");
  assert.deepEqual(requestedUrls, [
    "https://api.twitter.com/2/users/user-123/liked_tweets?pagination_token=page_1"
  ]);
  assert.deepEqual(result.nextCursors, { "liked-posts": "next_page_2" });
  assert.equal(JSON.stringify(result).includes("server-side-access-token"), false);
});

test("official import worker rejects unknown cursor endpoint ids", async () => {
  const worker = createOfficialImportWorker({
    enabled: true,
    tokenVault: createVault(),
    now,
    fetchImpl: async () => {
      throw new Error("fetch should not run for unknown cursor endpoints");
    }
  });

  await assert.rejects(
    () => worker.runImport({ providerId: "twitter", accountId: "user-123", cursors: { unknown: "page_1" } }),
    /Unknown official import cursor endpoint id: unknown/u
  );
});

test("official import worker skips endpoints outside the consented scopes", async () => {
  const requestedUrls = [];
  const worker = createOfficialImportWorker({
    enabled: true,
    tokenVault: createVault(["tweet.read"]),
    now,
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: [{ id: "tweet-1", text: "Study routines" }] };
        }
      };
    }
  });

  const result = await worker.runImport({ providerId: "twitter", accountId: "user-123" });

  assert.equal(result.status, "official-import-succeeded");
  assert.deepEqual(result.importedEndpoints, ["liked-posts"]);
  assert.deepEqual(result.skippedEndpoints, ["following"]);
  assert.equal(requestedUrls.length, 1);
});

test("official import worker rejects unknown requested endpoints", async () => {
  const worker = createOfficialImportWorker({
    enabled: true,
    tokenVault: createVault(),
    now,
    fetchImpl: async () => {
      throw new Error("fetch should not run for unknown endpoints");
    }
  });

  await assert.rejects(
    () => worker.runImport({ providerId: "twitter", accountId: "user-123", endpointIds: ["unknown"] }),
    /Unknown official import endpoint id: unknown/u
  );
});

test("official import worker stops on provider rate limits and returns retry guidance", async () => {
  const worker = createOfficialImportWorker({
    enabled: true,
    tokenVault: createVault(),
    now,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: {
        get(name) {
          return name.toLowerCase() === "retry-after" ? "120" : "";
        }
      },
      async json() {
        return { title: "Too many requests" };
      }
    })
  });

  const result = await worker.runImport({ providerId: "twitter", accountId: "user-123" });

  assert.equal(result.status, "official-import-rate-limited");
  assert.equal(result.failedEndpointId, "liked-posts");
  assert.equal(result.retryAfterSeconds, 120);
  assert.deepEqual(result.importedEndpoints, []);
  assert.equal(result.summary.total, 0);
});

test("official import worker readiness keeps production work explicit", () => {
  const readiness = summarizeOfficialImportWorkerReadiness();

  assert.equal(readiness.status, "feature-flagged-import-worker-ready");
  assert.ok(readiness.remainingBeforeProduction.some((item) => item.includes("disabled until explicit operator enablement")));
  assert.ok(readiness.remainingBeforeProduction.includes("complete provider-specific production permission review"));
});
