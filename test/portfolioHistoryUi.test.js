import assert from "node:assert/strict";
import test from "node:test";
import {
  createPortfolioGoalOptions,
  createPortfolioHistoryDeleteBody,
  createPortfolioHistoryFilters,
  createPortfolioHistoryUrl,
  isPortfolioHistoryDeleteEnabled,
  summarizePortfolioComparison,
  summarizePortfolioHistoryResponse
} from "../src/portfolioHistoryUi.js";

test("portfolio history UI creates bounded route filters", () => {
  assert.deepEqual(
    createPortfolioHistoryFilters({
      goalId: "discipline",
      since: "2026-08-01",
      until: "2026-08-29",
      limit: 250
    }),
    {
      goal: "discipline",
      since: "2026-08-01T00:00:00.000Z",
      until: "2026-08-29T00:00:00.000Z",
      limit: 100
    }
  );
  assert.deepEqual(createPortfolioHistoryFilters({ goalId: "all", since: "bad", limit: "bad" }), { limit: 20 });
});

test("portfolio history UI builds request URLs and guarded delete bodies", () => {
  const filters = createPortfolioHistoryFilters({ goalId: "founder", limit: 10 });

  assert.equal(createPortfolioHistoryUrl("/api/portfolio/history", filters), "/api/portfolio/history?goal=founder&limit=10");
  assert.deepEqual(createPortfolioHistoryDeleteBody(filters), { goalId: "founder" });
  assert.equal(isPortfolioHistoryDeleteEnabled(filters), true);
  assert.equal(isPortfolioHistoryDeleteEnabled({ limit: 20 }), false);
  assert.throws(() => createPortfolioHistoryDeleteBody({ limit: 20 }), /requires a goal or time filter/u);
});

test("portfolio history UI exposes goal options and concise summaries", () => {
  const options = createPortfolioGoalOptions();

  assert.equal(options[0].value, "all");
  assert.ok(options.some((option) => option.value === "discipline"));
  assert.equal(
    summarizePortfolioHistoryResponse({ summary: { total: 3, byGoal: { discipline: 2, founder: 1 } } }),
    "3 snapshots (discipline: 2, founder: 1)"
  );
  assert.equal(summarizePortfolioHistoryResponse({ snapshots: [{ id: "one" }] }), "1 snapshots");
});

test("portfolio history UI summarizes compare outcomes", () => {
  assert.equal(
    summarizePortfolioComparison({
      status: "portfolio-history-compared",
      comparison: { headline: "Aspiration alignment increased by 10 points." }
    }),
    "Aspiration alignment increased by 10 points."
  );
  assert.equal(
    summarizePortfolioComparison({
      status: "portfolio-history-insufficient-snapshots",
      available: 1,
      required: 2
    }),
    "1/2 snapshots available"
  );
});
