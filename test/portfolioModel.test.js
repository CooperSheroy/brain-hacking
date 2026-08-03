import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProviderActivities } from "../src/integrations/normalizedActivity.js";
import { buildPortfolioMap, comparePortfolioMaps } from "../src/portfolioModel.js";

test("buildPortfolioMap scores normalized activities against the selected goal", () => {
  const activities = normalizeProviderActivities("twitter", [
    { id: "1", type: "likes", text: "Deep work systems for study routines", weight: 2 },
    { id: "2", type: "bookmarks", text: "Sleep hygiene checklist" },
    { id: "3", type: "posts", text: "Viral outrage drama" }
  ]);

  const portfolio = buildPortfolioMap(activities, "discipline");

  assert.equal(portfolio.goal.id, "discipline");
  assert.equal(portfolio.summary.total, 3);
  assert.ok(portfolio.dimensions.find((item) => item.id === "aspiration_alignment").value > 0);
  assert.ok(portfolio.dimensions.find((item) => item.id === "noise_exposure").value > 0);
  assert.ok(portfolio.clusters.some((cluster) => cluster.label === "work" && cluster.goalMatched));
});

test("buildPortfolioMap handles empty local state without pretending confidence", () => {
  const portfolio = buildPortfolioMap([], "founder");

  assert.equal(portfolio.summary.total, 0);
  assert.deepEqual(
    portfolio.dimensions.map((item) => item.value),
    [0, 0, 0, 0, 0]
  );
  assert.deepEqual(portfolio.clusters, []);
});

test("buildPortfolioMap rejects non-array inputs", () => {
  assert.throws(() => buildPortfolioMap({}), /must be an array/u);
});

test("comparePortfolioMaps explains movement between normalized snapshots", () => {
  const before = normalizeProviderActivities("twitter", [
    { id: "1", type: "likes", text: "Viral outrage drama", weight: 2 },
    { id: "2", type: "follows", text: "Random viral clips" }
  ]);
  const after = normalizeProviderActivities("twitter", [
    { id: "3", type: "bookmarks", text: "Deep work habit systems", weight: 2 },
    { id: "4", type: "posts", text: "Sleep hygiene study routines" },
    { id: "5", type: "follows", text: "Fitness consistency coach" }
  ]);

  const changeSet = comparePortfolioMaps(before, after, "discipline");
  const alignment = changeSet.dimensions.find((dimension) => dimension.id === "aspiration_alignment");
  const noise = changeSet.dimensions.find((dimension) => dimension.id === "noise_exposure");

  assert.equal(changeSet.goal.id, "discipline");
  assert.equal(changeSet.activityDelta, 1);
  assert.equal(alignment.direction, "up");
  assert.equal(noise.direction, "down");
  assert.ok(changeSet.emergingClusters.some((cluster) => cluster.label === "work" && cluster.goalMatched));
  assert.ok(changeSet.fadingClusters.some((cluster) => cluster.label === "viral"));
  assert.match(changeSet.headline, /increased|decreased/u);
});

test("comparePortfolioMaps returns a stable headline for empty snapshots", () => {
  const changeSet = comparePortfolioMaps([], [], "calm");

  assert.equal(changeSet.activityDelta, 0);
  assert.deepEqual(changeSet.emergingClusters, []);
  assert.deepEqual(changeSet.fadingClusters, []);
  assert.equal(changeSet.headline, "Stable portfolio with no meaningful snapshot movement yet.");
});
