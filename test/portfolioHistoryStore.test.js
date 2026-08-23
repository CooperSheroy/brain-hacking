import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { normalizeProviderActivities } from "../src/integrations/normalizedActivity.js";
import {
  comparePortfolioSnapshots,
  createFilePortfolioHistoryStore,
  summarizePortfolioHistoryStoreReadiness
} from "../src/portfolioHistoryStore.js";

const noisyActivities = normalizeProviderActivities("twitter", [
  { id: "1", type: "likes", text: "Viral outrage drama", weight: 2 },
  { id: "2", type: "follows", text: "Random viral clips" }
]);

const alignedActivities = normalizeProviderActivities("twitter", [
  { id: "3", type: "bookmarks", text: "Deep work habit systems", weight: 2 },
  { id: "4", type: "posts", text: "Sleep hygiene study routines" },
  { id: "5", type: "follows", text: "Fitness consistency coach" }
]);

test("file portfolio history store persists derived snapshots across instances", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-portfolio-history-"));
  const filePath = join(tempDir, "portfolio-history.json");

  try {
    const store = createFilePortfolioHistoryStore({ filePath });
    const result = store.saveSnapshot({
      activities: alignedActivities,
      goalId: "discipline",
      capturedAt: "2026-08-22T09:00:00.000Z",
      note: "weekly import"
    });

    assert.equal(result.status, "portfolio-snapshot-saved");
    assert.equal(result.inserted, 1);
    assert.equal(result.snapshot.goal.id, "discipline");
    assert.equal(result.snapshot.activitySummary.total, 3);
    assert.ok(result.snapshot.dimensions.some((dimension) => dimension.id === "aspiration_alignment"));

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.snapshots.length, 1);

    const reloaded = createFilePortfolioHistoryStore({ filePath });
    assert.deepEqual(reloaded.listSnapshots(), persisted.snapshots);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file portfolio history store upserts snapshots by goal and captured time", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-portfolio-history-"));
  const filePath = join(tempDir, "portfolio-history.json");

  try {
    const store = createFilePortfolioHistoryStore({ filePath });
    store.saveSnapshot({
      activities: noisyActivities,
      goalId: "discipline",
      capturedAt: "2026-08-21T09:00:00.000Z"
    });
    const result = store.saveSnapshot({
      activities: alignedActivities,
      goalId: "discipline",
      capturedAt: "2026-08-21T09:00:00.000Z"
    });

    assert.equal(result.inserted, 0);
    assert.equal(result.updated, 1);
    assert.equal(store.listSnapshots().length, 1);
    assert.equal(store.listSnapshots()[0].activitySummary.total, 3);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file portfolio history store filters, compares latest snapshots, and deletes by boundary", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-portfolio-history-"));
  const filePath = join(tempDir, "portfolio-history.json");

  try {
    const store = createFilePortfolioHistoryStore({ filePath });
    store.saveSnapshot({
      activities: noisyActivities,
      goalId: "discipline",
      capturedAt: "2026-08-21T09:00:00.000Z"
    });
    store.saveSnapshot({
      activities: alignedActivities,
      goalId: "discipline",
      capturedAt: "2026-08-22T09:00:00.000Z"
    });
    store.saveSnapshot({
      activities: alignedActivities,
      goalId: "founder",
      capturedAt: "2026-08-23T09:00:00.000Z"
    });

    assert.deepEqual(
      store.listSnapshots({ goalId: "discipline" }).map((snapshot) => snapshot.capturedAt),
      ["2026-08-22T09:00:00.000Z", "2026-08-21T09:00:00.000Z"]
    );
    assert.deepEqual(
      store.listSnapshots({ since: "2026-08-22T00:00:00.000Z", limit: 1 }).map((snapshot) => snapshot.goal.id),
      ["founder"]
    );

    const comparison = store.compareLatest("discipline");
    const alignment = comparison.comparison.dimensions.find((dimension) => dimension.id === "aspiration_alignment");
    assert.equal(comparison.status, "portfolio-history-compared");
    assert.equal(comparison.comparison.activityDelta, 1);
    assert.equal(alignment.direction, "up");
    assert.match(comparison.comparison.headline, /increased|decreased|Stable/u);

    const deleted = store.deleteSnapshots({ goalId: "founder" });
    assert.equal(deleted.deleted, 1);
    assert.equal(deleted.total, 2);
    assert.throws(() => store.deleteSnapshots(), /delete requires at least one/u);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file portfolio history store rejects secrets and unsupported persisted formats", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-portfolio-history-"));
  const filePath = join(tempDir, "portfolio-history.json");

  try {
    const store = createFilePortfolioHistoryStore({ filePath });

    assert.throws(
      () => store.saveSnapshot({ activities: [{ ...alignedActivities[0], refreshToken: "secret" }] }),
      /must not include refreshToken/u
    );

    await writeFile(filePath, JSON.stringify({ version: 99, snapshots: [] }), "utf8");
    assert.throws(
      () => createFilePortfolioHistoryStore({ filePath }),
      /unsupported format/u
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("comparePortfolioSnapshots requires matching goals", () => {
  const tempSnapshot = (goalId) => ({
    id: `${goalId}:20260822090000000`,
    capturedAt: "2026-08-22T09:00:00.000Z",
    goal: { id: goalId, label: goalId },
    activitySummary: { total: 1, bySource: { manual: 1 }, byType: { topic: 1 } },
    dimensions: [],
    clusters: [{ label: "deep", weight: 1, goalMatched: true }]
  });

  assert.throws(
    () => comparePortfolioSnapshots(tempSnapshot("discipline"), tempSnapshot("founder")),
    /same goal/u
  );
});

test("portfolio history store readiness keeps retention and credential guardrails explicit", () => {
  const readiness = summarizePortfolioHistoryStoreReadiness();

  assert.equal(readiness.status, "portfolio-history-store-ready");
  assert.ok(readiness.guardrails.some((guardrail) => guardrail.includes("rejects activities containing token")));
  assert.ok(readiness.remainingBeforeProduction.includes("add browser controls for history review, export, and deletion"));
});
