import assert from "node:assert/strict";
import test from "node:test";
import {
  disconnectOAuthGrant,
  exportOAuthGrantSummaries,
  listOAuthGrantSummaries,
  summarizeOAuthGrantControlReadiness
} from "../src/integrations/oauthGrantControls.js";
import { createInMemoryTokenVault } from "../src/integrations/tokenVault.js";

const now = () => Date.parse("2026-08-19T04:10:00.000Z");

function createVault() {
  const vault = createInMemoryTokenVault({
    encryptionKey: new Uint8Array(32).fill(11),
    now,
    randomBytes: (length) => new Uint8Array(length).fill(4)
  });

  vault.saveGrant({
    providerId: "twitter",
    accountId: "user-123",
    scopes: ["tweet.read", "users.read"],
    tokenSet: {
      accessToken: "server-side-access-token",
      refreshToken: "server-side-refresh-token",
      tokenType: "Bearer",
      expiresAt: "2026-08-19T05:10:00.000Z"
    }
  });

  return vault;
}

test("OAuth grant controls list and export sanitized grant metadata", () => {
  const vault = createVault();
  const listing = listOAuthGrantSummaries({ tokenVault: vault, providerId: "twitter" });
  const exported = exportOAuthGrantSummaries({ tokenVault: vault, now });

  assert.equal(listing.status, "oauth-grant-list-ready");
  assert.equal(listing.grants.length, 1);
  assert.deepEqual(listing.grants[0], {
    providerId: "twitter",
    accountId: "user-123",
    scopes: ["tweet.read", "users.read"],
    consentedAt: "2026-08-19T04:10:00.000Z",
    updatedAt: "2026-08-19T04:10:00.000Z",
    tokenExpiresAt: "2026-08-19T05:10:00.000Z",
    hasRefreshToken: true
  });
  assert.equal(JSON.stringify(exported).includes("server-side-access-token"), false);
  assert.equal(JSON.stringify(exported).includes("server-side-refresh-token"), false);
  assert.equal(exported.retentionNote.includes("metadata only"), true);
});

test("OAuth grant controls disconnect encrypted stored grants", () => {
  const vault = createVault();
  const result = disconnectOAuthGrant({
    tokenVault: vault,
    providerId: "twitter",
    accountId: "user-123",
    now
  });

  assert.equal(result.status, "oauth-grant-disconnected");
  assert.equal(result.deleted, true);
  assert.equal(listOAuthGrantSummaries({ tokenVault: vault }).grants.length, 0);
  assert.throws(
    () => vault.loadGrant({ providerId: "twitter", accountId: "user-123" }),
    /No OAuth grant found/u
  );
});

test("OAuth grant controls reject unsafe summaries and non-OAuth providers", () => {
  assert.throws(
    () =>
      listOAuthGrantSummaries({
        tokenVault: {
          listGrants: () => [
            {
              providerId: "twitter",
              accountId: "user-123",
              scopes: ["tweet.read"],
              tokenSet: { accessToken: "unsafe" }
            }
          ],
          deleteGrant: () => false
        }
      }),
    /unsafe field/u
  );

  assert.throws(
    () =>
      disconnectOAuthGrant({
        tokenVault: createVault(),
        providerId: "manual",
        accountId: "local"
      }),
    /does not use OAuth grants/u
  );
});

test("OAuth grant control readiness keeps official imports gated", () => {
  const readiness = summarizeOAuthGrantControlReadiness();

  assert.equal(readiness.status, "disconnect-delete-export-controls-ready");
  assert.ok(readiness.supportedOperations.includes("disconnect stored grants"));
  assert.ok(readiness.remainingBeforeImports.includes("feature-flagged import worker"));
});
