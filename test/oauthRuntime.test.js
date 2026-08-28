import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createServerOAuthRuntime,
  summarizeServerOAuthRuntime
} from "../src/integrations/oauthRuntime.js";

test("server OAuth runtime loads client config and persists encrypted grants through file store", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-runtime-"));
  const filePath = join(tempDir, "oauth-grants.json");
  const portfolioHistoryPath = join(tempDir, "portfolio-history.json");
  const runtime = createServerOAuthRuntime({
    env: {
      BRAIN_HACKING_TOKEN_VAULT_KEY: Buffer.from(new Uint8Array(32).fill(6)).toString("base64url"),
      BRAIN_HACKING_TOKEN_GRANT_STORE: filePath,
      BRAIN_HACKING_PORTFOLIO_HISTORY_STORE: portfolioHistoryPath,
      TWITTER_CLIENT_ID: "client-123"
    },
    now: () => Date.parse("2026-08-18T08:00:00.000Z"),
    randomBytes: (length) => new Uint8Array(length).fill(2)
  });

  try {
    assert.deepEqual(runtime.getClientConfig("twitter"), { clientId: "client-123" });

    const vault = runtime.loadTokenVault();
    vault.saveGrant({
      providerId: "twitter",
      accountId: "user-123",
      scopes: ["tweet.read", "users.read"],
      tokenSet: {
        accessToken: "server-side-access-token",
        tokenType: "Bearer"
      }
    });

    const persisted = await readFile(filePath, "utf8");
    assert.equal(persisted.includes("server-side-access-token"), false);
    assert.equal(JSON.parse(persisted).grants.length, 1);

    const portfolioHistoryStore = runtime.loadPortfolioHistoryStore();
    const saved = portfolioHistoryStore.saveSnapshot({
      activities: [
        {
          id: "twitter-1",
          source: "twitter",
          type: "like",
          label: "Deep work systems",
          weight: 1,
          capturedAt: "2026-08-18T08:00:00.000Z",
          permissionScope: "tweet.read"
        }
      ],
      goalId: "discipline",
      capturedAt: "2026-08-18T08:00:00.000Z"
    });
    const persistedPortfolioHistory = await readFile(portfolioHistoryPath, "utf8");
    assert.equal(saved.status, "portfolio-snapshot-saved");
    assert.equal(JSON.parse(persistedPortfolioHistory).snapshots.length, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("server OAuth runtime reports missing backend configuration without collecting credentials", () => {
  const summary = summarizeServerOAuthRuntime({}, "/tmp/brain-hacking");

  assert.equal(summary.status, "requires-server-configuration");
  assert.ok(summary.requiredEnv.includes("BRAIN_HACKING_TOKEN_VAULT_KEY"));
  assert.ok(summary.optionalEnv.includes("BRAIN_HACKING_PORTFOLIO_HISTORY_STORE"));
  assert.equal(summary.portfolioHistoryStorePath, "/tmp/brain-hacking/.brain-hacking/portfolio-history.json");
  assert.ok(summary.guardrails.some((guardrail) => guardrail.includes("server environment")));

  const runtime = createServerOAuthRuntime({ env: {} });
  assert.throws(() => runtime.loadTokenVault(), /BRAIN_HACKING_TOKEN_VAULT_KEY/u);
  assert.throws(() => runtime.getClientConfig("twitter"), /TWITTER_CLIENT_ID/u);
});
