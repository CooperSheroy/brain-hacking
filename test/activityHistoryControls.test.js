import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteImportHistory,
  exportImportHistory,
  listImportHistory,
  summarizeImportHistoryControlsReadiness
} from "../src/integrations/activityHistoryControls.js";
import { createMemoryOAuthAuditLog } from "../src/integrations/oauthAuditLog.js";

const activities = [
  {
    id: "twitter-liked-123",
    source: "twitter",
    type: "like",
    label: "Deep work systems",
    weight: 1,
    capturedAt: "2026-08-20T09:00:00.000Z",
    externalId: "liked-123",
    permissionScope: "tweet.read"
  },
  {
    id: "manual-1",
    source: "manual",
    type: "topic",
    label: "Evidence-based fitness",
    weight: 2,
    capturedAt: "2026-08-21T09:00:00.000Z"
  }
];

test("import history controls list sanitized normalized records with bounded filters", () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-25T07:00:00.000Z")
  });
  const store = {
    listActivities(filters) {
      assert.deepEqual(filters, {
        source: "twitter",
        since: "2026-08-20T00:00:00.000Z",
        limit: 2
      });
      return [activities[0]];
    }
  };

  const result = listImportHistory({
    activityStore: store,
    auditLog,
    providerId: "twitter",
    since: "2026-08-20",
    limit: 2,
    now: () => Date.parse("2026-08-25T07:00:00.000Z")
  });

  assert.equal(result.status, "import-history-list-ready");
  assert.equal(result.activities.length, 1);
  assert.equal(result.summary.bySource.twitter, 1);
  assert.equal(result.guardrails.some((guardrail) => guardrail.includes("never expose OAuth tokens")), true);
  assert.deepEqual(
    auditLog.list().map((event) => event.action),
    ["import-history-listed"]
  );
});

test("import history controls export normalized activity history", () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-25T07:10:00.000Z")
  });
  const store = {
    listActivities(filters) {
      assert.deepEqual(filters, { type: "topic" });
      return [activities[1]];
    }
  };

  const result = exportImportHistory({
    activityStore: store,
    auditLog,
    type: "topic",
    now: () => Date.parse("2026-08-25T07:10:00.000Z")
  });

  assert.equal(result.status, "import-history-export-ready");
  assert.equal(result.exportedAt, "2026-08-25T07:10:00.000Z");
  assert.equal(result.activities[0].id, "manual-1");
  assert.equal(JSON.stringify(result).includes("accessToken"), false);
  assert.deepEqual(
    auditLog.list().map((event) => event.action),
    ["import-history-exported"]
  );
});

test("import history controls delete only through explicit activity boundaries", () => {
  const auditLog = createMemoryOAuthAuditLog({
    now: () => Date.parse("2026-08-25T07:20:00.000Z")
  });
  const store = {
    deleteActivities(filters) {
      assert.deepEqual(filters, { source: "twitter", until: "2026-08-25T00:00:00.000Z" });
      return {
        status: "normalized-activities-deleted",
        deleted: 3,
        total: 4,
        summary: { total: 4, bySource: { twitter: 4 }, byType: { like: 4 } }
      };
    }
  };

  const result = deleteImportHistory({
    activityStore: store,
    auditLog,
    source: "twitter",
    until: "2026-08-25",
    now: () => Date.parse("2026-08-25T07:20:00.000Z")
  });

  assert.equal(result.status, "import-history-delete-complete");
  assert.equal(result.deleted, 3);
  assert.deepEqual(
    auditLog.list().map((event) => event.action),
    ["import-history-deleted"]
  );
});

test("import history controls reject unsafe records and invalid filters", () => {
  const unsafeStore = {
    listActivities() {
      return [{ ...activities[0], accessToken: "server-side-access-token" }];
    }
  };

  assert.throws(
    () => listImportHistory({ activityStore: unsafeStore }),
    /unsafe field: accessToken/u
  );
  assert.throws(
    () => listImportHistory({ activityStore: unsafeStore, providerId: "unknown" }),
    /Unknown provider/u
  );
  assert.throws(
    () => listImportHistory({ activityStore: unsafeStore, since: "not-a-date" }),
    /valid timestamp/u
  );
});

test("import history readiness describes remaining production work", () => {
  const readiness = summarizeImportHistoryControlsReadiness();

  assert.equal(readiness.status, "import-history-controls-ready");
  assert.ok(readiness.supportedOperations.includes("export normalized import history"));
  assert.ok(readiness.remainingBeforeProduction.includes("harden browser history retention UX"));
});
