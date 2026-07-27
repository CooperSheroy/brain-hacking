export function normalizeManualSignals(text, source = "manual") {
  return text
    .split(/[\n,]/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((label, index) => ({
      id: `${source}-${index + 1}`,
      source,
      type: "topic",
      label,
      weight: 1,
      capturedAt: new Date(0).toISOString()
    }));
}

export function summarizeActivities(activities) {
  const bySource = new Map();
  const byType = new Map();

  for (const activity of activities) {
    bySource.set(activity.source, (bySource.get(activity.source) || 0) + 1);
    byType.set(activity.type, (byType.get(activity.type) || 0) + 1);
  }

  return {
    total: activities.length,
    bySource: Object.fromEntries(bySource),
    byType: Object.fromEntries(byType)
  };
}
