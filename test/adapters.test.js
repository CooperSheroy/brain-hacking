import assert from "node:assert/strict";
import test from "node:test";
import { getImportAdapter, listImportAdapters, summarizeAdapterReadiness } from "../src/integrations/adapters.js";

test("listImportAdapters exposes one adapter per provider", () => {
  const adapters = listImportAdapters();

  assert.deepEqual(
    adapters.map((adapter) => adapter.providerId),
    ["twitter", "instagram", "facebook", "manual"]
  );
});

test("manual adapter imports user-provided local text", () => {
  const adapter = getImportAdapter("manual");
  const result = adapter.importActivities({ text: "deep work, calm essays", source: "manual-journal" });

  assert.equal(adapter.canImportNow, true);
  assert.equal(result.activities.length, 2);
  assert.equal(result.activities[0].source, "manual-journal");
  assert.equal(result.summary.byType.topic, 2);
});

test("official OAuth adapters are gated until import workers and provider hardening exist", () => {
  const adapter = getImportAdapter("twitter");
  const readiness = summarizeAdapterReadiness("twitter");

  assert.equal(adapter.canImportNow, false);
  assert.equal(readiness.importMode, "official OAuth read import");
  assert.ok(readiness.guardrails.some((guardrail) => guardrail.includes("least-privilege")));
  assert.throws(() => adapter.importActivities(), /audit logging/u);
});
