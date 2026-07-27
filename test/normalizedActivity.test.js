import assert from "node:assert/strict";
import test from "node:test";
import { normalizeManualSignals, summarizeActivities } from "../src/integrations/normalizedActivity.js";

test("normalizeManualSignals converts pasted text to local activities", () => {
  const activities = normalizeManualSignals("deep work, recipes\nfitness", "manual");

  assert.equal(activities.length, 3);
  assert.deepEqual(
    activities.map((item) => item.label),
    ["deep work", "recipes", "fitness"]
  );
});

test("summarizeActivities rolls up source and type counts", () => {
  const summary = summarizeActivities(normalizeManualSignals("deep work, recipes", "manual"));

  assert.equal(summary.total, 2);
  assert.equal(summary.bySource.manual, 2);
  assert.equal(summary.byType.topic, 2);
});
