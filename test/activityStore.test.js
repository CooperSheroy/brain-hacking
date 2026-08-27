import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  createFileNormalizedActivityStore,
  summarizeNormalizedActivityStoreReadiness
} from "../src/integrations/activityStore.js";

const firstActivity = {
  id: "twitter-liked-123",
  source: "twitter",
  type: "like",
  label: "Deep work systems",
  weight: 1,
  capturedAt: "2026-08-20T09:00:00.000Z",
  externalId: "liked-123",
  url: "https://twitter.com/example/status/123",
  permissionScope: "tweet.read"
};

const secondActivity = {
  id: "manual-1",
  source: "manual",
  type: "topic",
  label: "Evidence-based fitness",
  weight: 2,
  capturedAt: "2026-08-21T09:00:00.000Z"
};

test("file normalized activity store persists sanitized records across instances", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-activity-store-"));
  const filePath = join(tempDir, "activities.json");

  try {
    const store = createFileNormalizedActivityStore({ filePath });
    const result = store.saveActivities([secondActivity, firstActivity]);

    assert.equal(result.status, "normalized-activities-saved");
    assert.equal(result.inserted, 2);
    assert.equal(result.updated, 0);
    assert.equal(result.summary.bySource.twitter, 1);

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(persisted.version, 1);
    assert.deepEqual(
      persisted.activities.map((activity) => activity.id),
      ["twitter-liked-123", "manual-1"]
    );

    const reloaded = createFileNormalizedActivityStore({ filePath });
    assert.deepEqual(reloaded.listActivities(), persisted.activities);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file normalized activity store upserts by source and id for retry-safe imports", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-activity-store-"));
  const filePath = join(tempDir, "activities.json");

  try {
    const store = createFileNormalizedActivityStore({ filePath });
    store.saveActivities([firstActivity]);
    const result = store.saveActivities([
      {
        ...firstActivity,
        label: "Deep work systems and planning",
        weight: 3
      }
    ]);
    const activities = store.listActivities();

    assert.equal(result.inserted, 0);
    assert.equal(result.updated, 1);
    assert.equal(result.total, 1);
    assert.equal(activities[0].label, "Deep work systems and planning");
    assert.equal(activities[0].weight, 3);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file normalized activity store filters and deletes by normalized boundaries", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-activity-store-"));
  const filePath = join(tempDir, "activities.json");

  try {
    const store = createFileNormalizedActivityStore({ filePath });
    store.saveActivities([firstActivity, secondActivity]);

    assert.deepEqual(
      store.listActivities({ source: "twitter" }).map((activity) => activity.id),
      ["twitter-liked-123"]
    );
    assert.deepEqual(
      store.listActivities({ since: "2026-08-21T00:00:00.000Z", limit: 1 }).map((activity) => activity.id),
      ["manual-1"]
    );

    const deleted = store.deleteActivities({ source: "twitter" });
    assert.equal(deleted.deleted, 1);
    assert.equal(deleted.total, 1);
    assert.deepEqual(
      store.listActivities().map((activity) => activity.id),
      ["manual-1"]
    );
    assert.throws(
      () => store.deleteActivities(),
      /delete requires at least one/u
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file normalized activity store rejects secrets and unsupported stored shapes", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-activity-store-"));
  const filePath = join(tempDir, "activities.json");

  try {
    const store = createFileNormalizedActivityStore({ filePath });

    assert.throws(
      () => store.saveActivities([{ ...firstActivity, accessToken: "server-side-access-token" }]),
      /must not include accessToken/u
    );
    assert.throws(
      () => store.saveActivities([{ ...firstActivity, url: "javascript:alert(1)" }]),
      /Unsupported normalized activity URL protocol/u
    );
    assert.throws(
      () => store.saveActivities([{ ...firstActivity, permissionScope: "dm.read" }]),
      /Unsupported normalized activity permission scope/u
    );
    assert.throws(
      () => store.saveActivities([{ ...firstActivity, source: "unknown" }]),
      /Unknown provider/u
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file normalized activity store rejects unsupported persisted formats", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-activity-store-"));
  const filePath = join(tempDir, "activities.json");

  try {
    await writeFile(filePath, JSON.stringify({ version: 99, activities: [] }), "utf8");

    assert.throws(
      () => createFileNormalizedActivityStore({ filePath }),
      /unsupported format/u
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file normalized activity store readiness keeps official imports gated", () => {
  const readiness = summarizeNormalizedActivityStoreReadiness();

  assert.equal(readiness.status, "normalized-activity-store-ready");
  assert.ok(readiness.guardrails.some((guardrail) => guardrail.includes("normalized activity records only")));
  assert.ok(readiness.remainingBeforeImports.includes("harden browser history retention UX"));
});
