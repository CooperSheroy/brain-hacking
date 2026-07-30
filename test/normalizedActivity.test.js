import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeManualSignals,
  normalizeProviderActivities,
  summarizeActivities
} from "../src/integrations/normalizedActivity.js";

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

test("normalizeProviderActivities maps official API records into sanitized activities", () => {
  const activities = normalizeProviderActivities("twitter", [
    {
      id: "liked-123",
      type: "likes",
      text: "A thread about deep work systems",
      createdAt: "2026-07-29T12:10:00.000Z",
      url: "https://twitter.com/example/status/123",
      permissionScope: "tweet.read"
    },
    {
      externalId: "creator-42",
      signalType: "follows",
      name: "Evidence-based fitness coach",
      weight: 2,
      timestamp: 1785336000000,
      scope: "users.read"
    }
  ]);

  assert.deepEqual(activities, [
    {
      id: "twitter-liked-123",
      source: "twitter",
      type: "like",
      label: "A thread about deep work systems",
      weight: 1,
      capturedAt: "2026-07-29T12:10:00.000Z",
      externalId: "liked-123",
      url: "https://twitter.com/example/status/123",
      permissionScope: "tweet.read"
    },
    {
      id: "twitter-creator-42",
      source: "twitter",
      type: "follow",
      label: "Evidence-based fitness coach",
      weight: 2,
      capturedAt: "2026-07-29T14:40:00.000Z",
      externalId: "creator-42",
      permissionScope: "users.read"
    }
  ]);
});

test("normalizeProviderActivities rejects unsupported provider record shapes", () => {
  assert.throws(() => normalizeProviderActivities("twitter", {}), /must be an array/u);
  assert.throws(() => normalizeProviderActivities("twitter", [{ type: "direct_messages", text: "private" }]), /Unsupported/u);
  assert.throws(() => normalizeProviderActivities("twitter", [{ type: "likes" }]), /requires a label/u);
});
