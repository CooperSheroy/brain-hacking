import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  createFileTokenGrantStore,
  summarizeTokenGrantStoreReadiness
} from "../src/integrations/tokenGrantStore.js";
import { createInMemoryTokenVault } from "../src/integrations/tokenVault.js";

const key = new Uint8Array(32).fill(8);
const now = () => Date.parse("2026-08-17T09:00:00.000Z");

test("file token grant store persists encrypted OAuth grants across vault instances", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-token-store-"));
  const filePath = join(tempDir, "oauth-grants.json");

  try {
    const firstVault = createInMemoryTokenVault({
      encryptionKey: key,
      store: createFileTokenGrantStore({ filePath }),
      now,
      randomBytes: (length) => new Uint8Array(length).fill(3)
    });

    firstVault.saveGrant({
      providerId: "twitter",
      accountId: "user-123",
      scopes: ["tweet.read", "users.read"],
      tokenSet: {
        accessToken: "server-side-access-token",
        refreshToken: "server-side-refresh-token",
        tokenType: "Bearer",
        expiresAt: "2026-08-17T10:00:00.000Z"
      }
    });

    const persisted = await readFile(filePath, "utf8");
    assert.equal(persisted.includes("server-side-access-token"), false);
    assert.equal(persisted.includes("server-side-refresh-token"), false);
    assert.equal(JSON.parse(persisted).grants.length, 1);

    const secondVault = createInMemoryTokenVault({
      encryptionKey: key,
      store: createFileTokenGrantStore({ filePath }),
      now
    });
    const grant = secondVault.loadGrant({ providerId: "twitter", accountId: "user-123" });

    assert.equal(grant.tokenSet.accessToken, "server-side-access-token");
    assert.deepEqual(grant.scopes, ["tweet.read", "users.read"]);

    assert.equal(secondVault.deleteGrant({ providerId: "twitter", accountId: "user-123" }), true);
    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")).grants, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file token grant store rejects unsupported persisted formats", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-token-store-"));
  const filePath = join(tempDir, "oauth-grants.json");

  try {
    await writeFile(filePath, JSON.stringify({ version: 99, grants: [] }), "utf8");

    assert.throws(
      () => createFileTokenGrantStore({ filePath }),
      /unsupported format/u
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file token grant store readiness keeps imports gated behind user controls", () => {
  const readiness = summarizeTokenGrantStoreReadiness();

  assert.equal(readiness.status, "persistent-store-primitive-ready");
  assert.ok(readiness.guardrails.some((guardrail) => guardrail.includes("vault-encrypted")));
  assert.ok(readiness.remainingBeforeImports.includes("production route or scheduler wiring"));
});
