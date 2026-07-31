import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProviderActivities } from "../src/integrations/normalizedActivity.js";
import { buildPortfolioMap } from "../src/portfolioModel.js";

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
