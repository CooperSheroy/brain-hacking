import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSignals, createPlan } from "../src/feedPlanner.js";

test("createPlan builds prompts and timeline for selected horizon", () => {
  const plan = createPlan({ goalId: "discipline", horizonDays: 7, intensity: 3, avoid: "rage bait" });

  assert.equal(plan.goal.id, "discipline");
  assert.equal(plan.prompts.length, 4);
  assert.equal(plan.timeline.length, 7);
  assert.match(plan.timeline[0].check, /rage bait/);
});

test("createPlan clamps prompt count by intensity", () => {
  const low = createPlan({ goalId: "recipes", horizonDays: 14, intensity: 1 });
  const high = createPlan({ goalId: "recipes", horizonDays: 14, intensity: 5 });

  assert.equal(low.prompts.length, 2);
  assert.equal(high.prompts.length, 5);
});

test("analyzeSignals produces top signals and goal alignment", () => {
  const analysis = analyzeSignals("deep work, sleep, deep work, recipes", "discipline");

  assert.equal(analysis.topSignals[0].label, "deep");
  assert.ok(analysis.alignment > 0);
  assert.ok(analysis.traits.some((trait) => trait.label === "Intentionality"));
});
