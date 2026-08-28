import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createRequestHandler } from "../server.js";
import { createMemoryOAuthAuditLog } from "../src/integrations/oauthAuditLog.js";
import { createInMemoryTokenVault } from "../src/integrations/tokenVault.js";

test("server creates OAuth authorization metadata and verifies callback state", async () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-07-29T10:02:00.000Z")
  });
  const server = createServer(
    createRequestHandler({
      stateStore: new Map(),
      now: () => Date.parse("2026-07-29T10:02:00.000Z"),
      oauthRuntime: {
        loadAuditLog: () => auditLog
      }
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
    assert.deepEqual(
      auditLog.list().map((event) => event.action),
      ["authorization-requested", "callback-received"]
    );
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
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-18T09:30:00.000Z")
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
        loadAuditLog: () => auditLog,
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
    assert.deepEqual(
      auditLog.list().map((event) => event.action),
      ["authorization-requested", "callback-received", "token-exchange-completed"]
    );
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
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-19T04:10:00.000Z")
  });

  const server = createServer(
    createRequestHandler({
      now: () => Date.parse("2026-08-19T04:10:00.000Z"),
      oauthRuntime: {
        fetchImpl: async () => {
          throw new Error("fetch should not run");
        },
        loadTokenVault: () => vault,
        loadAuditLog: () => auditLog,
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
    assert.deepEqual(
      auditLog.list().map((event) => event.action),
      ["grant-listed", "grant-exported", "grant-disconnected", "grant-listed"]
    );
  } finally {
    await close(server);
  }
});

test("server keeps official OAuth import route inert until backend flag is enabled", async () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-24T04:10:00.000Z")
  });
  const server = createServer(
    createRequestHandler({
      now: () => Date.parse("2026-08-24T04:10:00.000Z"),
      oauthRuntime: {
        officialImportsEnabled: false,
        fetchImpl: async () => {
          throw new Error("fetch should not run while official imports are disabled");
        },
        loadTokenVault: () => {
          throw new Error("token vault should not load while official imports are disabled");
        },
        loadActivityStore: () => {
          throw new Error("activity store should not load while official imports are disabled");
        },
        loadAuditLog: () => auditLog
      }
    })
  );
  await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/oauth/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "twitter", accountId: "user-123" })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, "official-import-disabled");
    assert.equal(payload.importedActivityCount, 0);
    assert.equal(payload.persistence.status, "normalized-activities-not-persisted");
    assert.equal("activities" in payload, false);
    assert.deepEqual(auditLog.list(), []);
  } finally {
    await close(server);
  }
});

test("server official OAuth import route persists normalized activities when enabled", async () => {
  const vault = createInMemoryTokenVault({
    encryptionKey: new Uint8Array(32).fill(11),
    now: () => Date.parse("2026-08-24T04:15:00.000Z"),
    randomBytes: (length) => new Uint8Array(length).fill(8)
  });
  vault.saveGrant({
    providerId: "twitter",
    accountId: "user-123",
    scopes: ["tweet.read"],
    tokenSet: {
      accessToken: "server-side-access-token",
      tokenType: "Bearer",
      expiresAt: "2026-08-24T05:15:00.000Z"
    }
  });
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-24T04:15:00.000Z")
  });
  const persistedActivities = [];
  const activityStore = {
    saveActivities(records) {
      persistedActivities.push(...records);
      return {
        status: "normalized-activities-saved",
        inserted: records.length,
        updated: 0,
        total: persistedActivities.length,
        summary: {
          total: persistedActivities.length,
          bySource: { twitter: persistedActivities.length },
          byType: { like: persistedActivities.length }
        }
      };
    }
  };
  const server = createServer(
    createRequestHandler({
      now: () => Date.parse("2026-08-24T04:15:00.000Z"),
      oauthRuntime: {
        officialImportsEnabled: true,
        fetchImpl: async (url, init) => {
          assert.equal(url, "https://api.twitter.com/2/users/user-123/liked_tweets?limit=1");
          assert.equal(init.method, "GET");
          assert.equal(init.headers.authorization, "Bearer server-side-access-token");
          return {
            ok: true,
            status: 200,
            async json() {
              return { data: [{ id: "tweet-1", text: "Deep work systems" }] };
            }
          };
        },
        loadTokenVault: () => vault,
        loadActivityStore: () => activityStore,
        loadAuditLog: () => auditLog
      }
    })
  );
  await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/oauth/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "twitter",
        accountId: "user-123",
        endpointIds: ["liked-posts"],
        limit: 1
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, "official-import-succeeded");
    assert.equal(payload.importedActivityCount, 1);
    assert.equal(payload.importSummary.bySource.twitter, 1);
    assert.equal(payload.persistence.status, "normalized-activities-persisted");
    assert.equal(persistedActivities[0].id, "twitter-tweet-1");
    assert.equal(JSON.stringify(payload).includes("server-side-access-token"), false);
    assert.equal("activities" in payload, false);
    assert.deepEqual(
      auditLog.list().map((event) => event.status),
      [
        "official-read-import-started",
        "official-read-import-succeeded",
        "official-import-activities-persisted"
      ]
    );
  } finally {
    await close(server);
  }
});

test("server exposes sanitized import history list, export, and delete controls", async () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-25T08:00:00.000Z")
  });
  const storedActivities = [
    {
      id: "twitter-liked-123",
      source: "twitter",
      type: "like",
      label: "Deep work systems",
      weight: 1,
      capturedAt: "2026-08-20T09:00:00.000Z",
      permissionScope: "tweet.read"
    },
    {
      id: "manual-1",
      source: "manual",
      type: "topic",
      label: "Evidence-based fitness",
      weight: 1,
      capturedAt: "2026-08-21T09:00:00.000Z"
    }
  ];
  const activityStore = {
    listActivities(filters = {}) {
      return storedActivities.filter((activity) => !filters.source || activity.source === filters.source);
    },
    deleteActivities(filters = {}) {
      const matched = storedActivities.filter((activity) => !filters.source || activity.source === filters.source);
      return {
        status: "normalized-activities-deleted",
        deleted: matched.length,
        total: storedActivities.length - matched.length,
        summary: {
          total: storedActivities.length - matched.length,
          bySource: { manual: 1 },
          byType: { topic: 1 }
        }
      };
    }
  };
  const server = createServer(
    createRequestHandler({
      now: () => Date.parse("2026-08-25T08:00:00.000Z"),
      oauthRuntime: {
        loadActivityStore: () => activityStore,
        loadAuditLog: () => auditLog
      }
    })
  );
  await listen(server);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const listResponse = await fetch(`${baseUrl}/api/oauth/import-history?provider=twitter`);
    const listing = await listResponse.json();
    const exportResponse = await fetch(`${baseUrl}/api/oauth/import-history/export`);
    const exported = await exportResponse.json();
    const deleteResponse = await fetch(`${baseUrl}/api/oauth/import-history`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "twitter" })
    });
    const deleted = await deleteResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(listing.status, "import-history-list-ready");
    assert.equal(listing.activities.length, 1);
    assert.equal(listing.activities[0].id, "twitter-liked-123");
    assert.equal(exportResponse.status, 200);
    assert.equal(exported.status, "import-history-export-ready");
    assert.equal(exported.activities.length, 2);
    assert.equal(JSON.stringify(exported).includes("server-side-access-token"), false);
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleted.status, "import-history-delete-complete");
    assert.equal(deleted.deleted, 1);
    assert.deepEqual(
      auditLog.list().map((event) => event.action),
      ["import-history-listed", "import-history-exported", "import-history-deleted"]
    );
  } finally {
    await close(server);
  }
});

test("server exposes sanitized portfolio history list, export, compare, and delete controls", async () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-26T08:00:00.000Z")
  });
  const storedSnapshots = [
    {
      id: "discipline:20260820090000000",
      capturedAt: "2026-08-20T09:00:00.000Z",
      goal: { id: "discipline", label: "Discipline" },
      note: "baseline",
      activitySummary: { total: 1, bySource: { twitter: 1 }, byType: { like: 1 } },
      dimensions: [
        {
          id: "aspiration_alignment",
          label: "Aspiration alignment",
          value: 20,
          evidence: ["Deep work"],
          explanation: "Share of weighted activity that overlaps the selected goal topics."
        }
      ],
      clusters: [{ label: "deep", weight: 1, goalMatched: true }]
    },
    {
      id: "discipline:20260821090000000",
      capturedAt: "2026-08-21T09:00:00.000Z",
      goal: { id: "discipline", label: "Discipline" },
      note: "follow-up",
      activitySummary: { total: 2, bySource: { twitter: 2 }, byType: { like: 1, follow: 1 } },
      dimensions: [
        {
          id: "aspiration_alignment",
          label: "Aspiration alignment",
          value: 35,
          evidence: ["Deep work"],
          explanation: "Share of weighted activity that overlaps the selected goal topics."
        }
      ],
      clusters: [{ label: "deep", weight: 2, goalMatched: true }]
    }
  ];
  const portfolioHistoryStore = {
    listSnapshots(filters = {}) {
      return storedSnapshots.filter((snapshot) => !filters.goalId || snapshot.goal.id === filters.goalId);
    },
    compareLatest(goalId = "") {
      const matching = storedSnapshots.filter((snapshot) => !goalId || snapshot.goal.id === goalId);
      return {
        status: "portfolio-history-compared",
        beforeSnapshotId: matching[0].id,
        afterSnapshotId: matching[1].id,
        comparison: {
          headline: "Aspiration alignment increased by 15 points.",
          dimensions: []
        }
      };
    },
    deleteSnapshots(filters = {}) {
      const matched = storedSnapshots.filter((snapshot) => !filters.goalId || snapshot.goal.id === filters.goalId);
      return {
        status: "portfolio-snapshots-deleted",
        deleted: matched.length,
        total: storedSnapshots.length - matched.length
      };
    }
  };
  const server = createServer(
    createRequestHandler({
      now: () => Date.parse("2026-08-26T08:00:00.000Z"),
      oauthRuntime: {
        loadPortfolioHistoryStore: () => portfolioHistoryStore,
        loadAuditLog: () => auditLog
      }
    })
  );
  await listen(server);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const listResponse = await fetch(`${baseUrl}/api/portfolio/history?goal=discipline`);
    const listing = await listResponse.json();
    const exportResponse = await fetch(`${baseUrl}/api/portfolio/history/export`);
    const exported = await exportResponse.json();
    const compareResponse = await fetch(`${baseUrl}/api/portfolio/history/compare?goalId=discipline`);
    const compared = await compareResponse.json();
    const deleteResponse = await fetch(`${baseUrl}/api/portfolio/history`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goalId: "discipline" })
    });
    const deleted = await deleteResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(listing.status, "portfolio-history-list-ready");
    assert.equal(listing.snapshots.length, 2);
    assert.equal(exportResponse.status, 200);
    assert.equal(exported.status, "portfolio-history-export-ready");
    assert.equal(JSON.stringify(exported).includes("server-side-access-token"), false);
    assert.equal(compareResponse.status, 200);
    assert.equal(compared.status, "portfolio-history-compared");
    assert.match(compared.comparison.headline, /increased by 15/u);
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleted.status, "portfolio-history-delete-complete");
    assert.equal(deleted.deleted, 2);
    assert.deepEqual(
      auditLog.list().map((event) => event.action),
      [
        "portfolio-history-listed",
        "portfolio-history-exported",
        "portfolio-history-compared",
        "portfolio-history-deleted"
      ]
    );
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
