import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryTokenVault, summarizeTokenVaultReadiness } from "../src/integrations/tokenVault.js";

const key = new Uint8Array(32).fill(9);
const now = () => Date.parse("2026-08-02T10:00:00.000Z");

test("token vault stores OAuth grants as encrypted envelopes", () => {
  const store = new Map();
  const vault = createInMemoryTokenVault({
    encryptionKey: key,
    store,
    now,
    randomBytes: (length) => new Uint8Array(length).fill(4)
  });

  const summary = vault.saveGrant({
    providerId: "twitter",
    accountId: "user-123",
    scopes: ["users.read", "tweet.read", "offline.access"],
    tokenSet: {
      accessToken: "access-token-secret",
      refreshToken: "refresh-token-secret",
      tokenType: "bearer",
      expiresAt: "2026-08-02T11:00:00.000Z"
    }
  });
  const stored = store.get("twitter:user-123");

  assert.equal(summary.providerId, "twitter");
  assert.deepEqual(summary.scopes, ["offline.access", "tweet.read", "users.read"]);
  assert.equal(summary.hasRefreshToken, true);
  assert.equal(stored.encryptedTokenSet.algorithm, "aes-256-gcm");
  assert.equal(JSON.stringify(stored).includes("access-token-secret"), false);
  assert.equal(JSON.stringify(stored).includes("refresh-token-secret"), false);
});

test("token vault decrypts only through backend vault API", () => {
  const vault = createInMemoryTokenVault({
    encryptionKey: key,
    now,
    randomBytes: (length) => new Uint8Array(length).fill(5)
  });

  vault.saveGrant({
    providerId: "twitter",
    accountId: "user-123",
    scopes: ["tweet.read", "users.read"],
    tokenSet: {
      accessToken: "access-token-secret",
      tokenType: "bearer"
    }
  });

  const grant = vault.loadGrant({ providerId: "twitter", accountId: "user-123" });

  assert.equal(grant.tokenSet.accessToken, "access-token-secret");
  assert.equal(grant.hasRefreshToken, false);
  assert.deepEqual(
    vault.listGrants(),
    [
      {
        providerId: "twitter",
        accountId: "user-123",
        scopes: ["tweet.read", "users.read"],
        consentedAt: "2026-08-02T10:00:00.000Z",
        updatedAt: "2026-08-02T10:00:00.000Z",
        tokenExpiresAt: "",
        hasRefreshToken: false
      }
    ]
  );
});

test("token vault rejects unsupported providers, scopes, and payload fields", () => {
  const vault = createInMemoryTokenVault({ encryptionKey: key, now });

  assert.throws(
    () =>
      vault.saveGrant({
        providerId: "manual",
        accountId: "local",
        scopes: ["local.text"],
        tokenSet: { accessToken: "secret" }
      }),
    /does not use OAuth token grants/u
  );
  assert.throws(
    () =>
      vault.saveGrant({
        providerId: "twitter",
        accountId: "user-123",
        scopes: ["dm.read"],
        tokenSet: { accessToken: "secret" }
      }),
    /Unsupported OAuth scope/u
  );
  assert.throws(
    () =>
      vault.saveGrant({
        providerId: "twitter",
        accountId: "user-123",
        scopes: ["tweet.read"],
        tokenSet: { accessToken: "secret", rawPayload: "{}" }
      }),
    /unsupported fields/u
  );
});

test("token vault readiness documents remaining production wiring", () => {
  const readiness = summarizeTokenVaultReadiness();

  assert.equal(readiness.status, "backend-primitive-ready");
  assert.equal(readiness.storage, "encrypted server-side token envelopes");
  assert.ok(readiness.remainingBeforeImports.includes("disconnect/delete/export API"));
});
