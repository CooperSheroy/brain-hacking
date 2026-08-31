import assert from "node:assert/strict";
import test from "node:test";
import {
  compareLatestPortfolioHistory,
  createPortfolioSnapshotFromHistory,
  deletePortfolioHistory,
  exportPortfolioHistory,
  listPortfolioHistory,
  summarizePortfolioHistoryControlsReadiness
} from "../src/portfolioHistoryControls.js";
import { createMemoryOAuthAuditLog } from "../src/integrations/oauthAuditLog.js";

const snapshots = [
  {
    id: "discipline:20260821090000000",
    capturedAt: "2026-08-21T09:00:00.000Z",
    goal: { id: "discipline", label: "Discipline" },
    note: "first read",
    activitySummary: { total: 2, bySource: { twitter: 2 }, byType: { like: 1, follow: 1 } },
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
    id: "founder:20260822090000000",
    capturedAt: "2026-08-22T09:00:00.000Z",
    goal: { id: "founder", label: "Founder" },
    note: "",
    activitySummary: { total: 1, bySource: { manual: 1 }, byType: { topic: 1 } },
    dimensions: [],
    clusters: [{ label: "startup", weight: 1, goalMatched: true }]
  }
];

test("portfolio history controls create derived snapshots from sanitized import history", () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-26T06:50:00.000Z")
  });
  const activityStore = {
    listActivities(filters) {
      assert.deepEqual(filters, {
        source: "twitter",
        since: "2026-08-20T00:00:00.000Z",
        limit: 5
      });
      return [
        {
          id: "twitter-liked-123",
          source: "twitter",
          type: "like",
          label: "Deep work systems",
          weight: 1,
          capturedAt: "2026-08-20T09:00:00.000Z",
          permissionScope: "tweet.read"
        }
      ];
    }
  };
  const portfolioHistoryStore = {
    saveSnapshot({ activities, goalId, capturedAt, note }) {
      assert.equal(activities.length, 1);
      assert.equal(goalId, "discipline");
      assert.equal(capturedAt, "2026-08-26T06:45:00.000Z");
      assert.equal(note, "weekly import");
      return {
        status: "portfolio-snapshot-saved",
        inserted: 1,
        updated: 0,
        total: 1,
        snapshot: snapshots[0]
      };
    }
  };

  const result = createPortfolioSnapshotFromHistory({
    activityStore,
    portfolioHistoryStore,
    auditLog,
    goalId: "discipline",
    providerId: "twitter",
    since: "2026-08-20",
    limit: 5,
    note: "weekly import",
    capturedAt: "2026-08-26T06:45:00.000Z",
    now: () => Date.parse("2026-08-26T06:50:00.000Z")
  });

  assert.equal(result.status, "portfolio-history-snapshot-created");
  assert.equal(result.snapshot.id, "discipline:20260821090000000");
  assert.equal(result.persistence.inserted, 1);
  assert.equal(result.sourceActivitySummary.total, 2);
  assert.equal("activities" in result, false);
  assert.equal(JSON.stringify(result).includes("server-side-access-token"), false);
  assert.deepEqual(
    auditLog.list().map((event) => [event.action, event.status]),
    [["portfolio-history-snapshot-created", "portfolio-history-snapshot-created"]]
  );
});

test("portfolio history controls do not save empty source history snapshots", () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-26T06:55:00.000Z")
  });
  const result = createPortfolioSnapshotFromHistory({
    activityStore: {
      listActivities() {
        return [];
      }
    },
    portfolioHistoryStore: {
      saveSnapshot() {
        throw new Error("empty source history should not save a snapshot");
      }
    },
    auditLog,
    goalId: "discipline",
    now: () => Date.parse("2026-08-26T06:55:00.000Z")
  });

  assert.equal(result.status, "portfolio-history-snapshot-empty");
  assert.equal(result.sourceActivitySummary.total, 0);
  assert.equal("snapshot" in result, false);
  assert.deepEqual(
    auditLog.list().map((event) => event.status),
    ["portfolio-history-snapshot-empty"]
  );
});

test("portfolio history controls list derived snapshots with bounded filters", () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-26T07:00:00.000Z")
  });
  const store = {
    listSnapshots(filters) {
      assert.deepEqual(filters, {
        goalId: "discipline",
        since: "2026-08-20T00:00:00.000Z",
        limit: 2
      });
      return [snapshots[0]];
    }
  };

  const result = listPortfolioHistory({
    portfolioHistoryStore: store,
    auditLog,
    goalId: "discipline",
    since: "2026-08-20",
    limit: 2,
    now: () => Date.parse("2026-08-26T07:00:00.000Z")
  });

  assert.equal(result.status, "portfolio-history-list-ready");
  assert.equal(result.snapshots.length, 1);
  assert.equal(result.summary.byGoal.discipline, 1);
  assert.equal(result.guardrails.some((guardrail) => guardrail.includes("derived portfolio snapshots")), true);
  assert.deepEqual(
    auditLog.list().map((event) => event.action),
    ["portfolio-history-listed"]
  );
});

test("portfolio history controls export derived snapshots without raw materials", () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-26T07:10:00.000Z")
  });
  const store = {
    listSnapshots(filters) {
      assert.deepEqual(filters, { until: "2026-08-23T00:00:00.000Z" });
      return snapshots;
    }
  };

  const result = exportPortfolioHistory({
    portfolioHistoryStore: store,
    auditLog,
    until: "2026-08-23",
    now: () => Date.parse("2026-08-26T07:10:00.000Z")
  });

  assert.equal(result.status, "portfolio-history-export-ready");
  assert.equal(result.exportedAt, "2026-08-26T07:10:00.000Z");
  assert.equal(result.snapshots.length, 2);
  assert.equal(result.summary.byGoal.founder, 1);
  assert.equal(JSON.stringify(result).includes("accessToken"), false);
  assert.match(result.retentionNote, /derived portfolio snapshots only/u);
  assert.deepEqual(
    auditLog.list().map((event) => event.action),
    ["portfolio-history-exported"]
  );
});

test("portfolio history controls delete only through explicit goal or time boundaries", () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-26T07:20:00.000Z")
  });
  const store = {
    deleteSnapshots(filters) {
      assert.deepEqual(filters, { goalId: "founder" });
      return {
        status: "portfolio-snapshots-deleted",
        deleted: 1,
        total: 1
      };
    }
  };

  const result = deletePortfolioHistory({
    portfolioHistoryStore: store,
    auditLog,
    goalId: "founder",
    now: () => Date.parse("2026-08-26T07:20:00.000Z")
  });

  assert.equal(result.status, "portfolio-history-delete-complete");
  assert.equal(result.deleted, 1);
  assert.deepEqual(
    auditLog.list().map((event) => event.action),
    ["portfolio-history-deleted"]
  );
});

test("portfolio history controls compare latest snapshots for a goal", () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-26T07:30:00.000Z")
  });
  const store = {
    compareLatest(goalId) {
      assert.equal(goalId, "discipline");
      return {
        status: "portfolio-history-compared",
        beforeSnapshotId: "discipline:20260820090000000",
        afterSnapshotId: "discipline:20260821090000000",
        comparison: {
          headline: "Aspiration alignment increased by 10 points.",
          dimensions: []
        }
      };
    }
  };

  const result = compareLatestPortfolioHistory({
    portfolioHistoryStore: store,
    auditLog,
    goalId: "discipline",
    now: () => Date.parse("2026-08-26T07:30:00.000Z")
  });

  assert.equal(result.status, "portfolio-history-compared");
  assert.equal(result.comparison.headline, "Aspiration alignment increased by 10 points.");
  assert.deepEqual(
    auditLog.list().map((event) => event.action),
    ["portfolio-history-compared"]
  );
});

test("portfolio history controls reject unsafe records and invalid filters", () => {
  const unsafeStore = {
    listSnapshots() {
      return [{ ...snapshots[0], rawPayload: { provider: "payload" } }];
    }
  };

  assert.throws(
    () => listPortfolioHistory({ portfolioHistoryStore: unsafeStore }),
    /unsafe field: record\.rawPayload/u
  );
  assert.throws(
    () => listPortfolioHistory({ portfolioHistoryStore: unsafeStore, since: "not-a-date" }),
    /valid timestamp/u
  );
  assert.throws(
    () => listPortfolioHistory({ portfolioHistoryStore: unsafeStore, limit: 0 }),
    /positive integer/u
  );
});

test("portfolio history controls readiness names production gaps", () => {
  const readiness = summarizePortfolioHistoryControlsReadiness();

  assert.equal(readiness.status, "portfolio-history-controls-ready");
  assert.ok(readiness.supportedOperations.includes("export derived portfolio snapshots"));
  assert.ok(readiness.supportedOperations.includes("compare the latest two snapshots for one goal"));
  assert.ok(readiness.remainingBeforeProduction.includes("add browser controls for portfolio history review and deletion confirmations"));
});
