import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFileOAuthAuditLog,
  createMemoryOAuthAuditLog,
  summarizeOAuthAuditLogReadiness
} from "../src/integrations/oauthAuditLog.js";

const now = () => Date.parse("2026-08-20T04:30:00.000Z");

test("OAuth audit log appends sanitized control events to disk", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-audit-log-"));
  const filePath = join(tempDir, "oauth-audit-log.json");

  try {
    const log = createFileOAuthAuditLog({ filePath, now });
    const event = log.append({
      id: "event-1",
      action: "grant-exported",
      providerId: "twitter",
      accountId: "user-123",
      status: "oauth-grant-export-ready",
      metadata: {
        grantCount: 1,
        scopes: ["tweet.read", "users.read"]
      }
    });

    assert.equal(event.createdAt, "2026-08-20T04:30:00.000Z");
    assert.deepEqual(log.list({ providerId: "twitter" }), [event]);

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.events.length, 1);
    assert.equal(JSON.stringify(persisted).includes("server-side-access-token"), false);

    const reloaded = createFileOAuthAuditLog({ filePath, now });
    assert.deepEqual(reloaded.list({ action: "grant-exported" }), [event]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("OAuth audit log rejects token-like fields and unsupported persisted formats", async () => {
  const log = createMemoryOAuthAuditLog({ now });

  assert.throws(
    () =>
      log.append({
        action: "token-exchange-completed",
        providerId: "twitter",
        accountId: "user-123",
        status: "token-grant-saved",
        metadata: {
          accessToken: "server-side-access-token"
        }
      }),
    /token-like field/u
  );

  const tempDir = await mkdtemp(join(tmpdir(), "brain-hacking-audit-log-"));
  const filePath = join(tempDir, "oauth-audit-log.json");

  try {
    await writeFile(filePath, JSON.stringify({ version: 99, events: [] }), "utf8");
    assert.throws(
      () => createFileOAuthAuditLog({ filePath, now }),
      /unsupported format/u
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("OAuth audit log readiness closes audit gap without enabling imports", () => {
  const readiness = summarizeOAuthAuditLogReadiness();

  assert.equal(readiness.status, "oauth-audit-log-ready");
  assert.ok(readiness.events.includes("token-exchange-completed"));
  assert.ok(readiness.guardrails.some((guardrail) => guardrail.includes("token-like fields")));
  assert.ok(readiness.remainingBeforeImports.includes("feature-flagged import worker"));
});
