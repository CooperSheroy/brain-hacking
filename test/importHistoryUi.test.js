import assert from "node:assert/strict";
import test from "node:test";
import {
  createImportHistoryDeleteBody,
  createImportHistoryFilters,
  createImportHistoryUrl,
  createProviderOptions,
  isHistoryDeleteEnabled,
  summarizeHistoryResponse
} from "../src/integrations/importHistoryUi.js";

test("import history UI creates bounded route filters", () => {
  assert.deepEqual(
    createImportHistoryFilters({ providerId: "twitter", type: "liked-posts", limit: 250 }),
    { provider: "twitter", type: "liked_posts", limit: 100 }
  );
  assert.deepEqual(
    createImportHistoryFilters({ providerId: "all", type: "", limit: "bad" }),
    { limit: 25 }
  );
});

test("import history UI builds request URLs and guarded delete bodies", () => {
  const filters = createImportHistoryFilters({ providerId: "twitter", type: "like", limit: 10 });

  assert.equal(
    createImportHistoryUrl("/api/oauth/import-history", filters),
    "/api/oauth/import-history?provider=twitter&type=like&limit=10"
  );
  assert.deepEqual(createImportHistoryDeleteBody(filters), { source: "twitter", type: "like" });
  assert.equal(isHistoryDeleteEnabled(filters), true);
  assert.equal(isHistoryDeleteEnabled({ limit: 25 }), false);
  assert.throws(() => createImportHistoryDeleteBody({ limit: 25 }), /requires a provider or type/u);
});

test("import history UI exposes provider options and concise summaries", () => {
  const options = createProviderOptions();
  assert.equal(options[0].value, "all");
  assert.ok(options.some((option) => option.value === "twitter"));
  assert.equal(
    summarizeHistoryResponse({ summary: { total: 3, bySource: { twitter: 2, manual: 1 } } }),
    "3 records (twitter: 2, manual: 1)"
  );
  assert.equal(summarizeHistoryResponse({ activities: [{ id: "one" }] }), "1 records");
});
