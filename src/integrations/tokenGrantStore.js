import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const storeVersion = 1;

export function createFileTokenGrantStore({ filePath } = {}) {
  const normalizedPath = normalizeFilePath(filePath);
  const records = new Map(readRecordsFromDisk(normalizedPath).map((record) => [recordKey(record), record]));

  return {
    get(key) {
      return records.get(key);
    },

    set(key, record) {
      const prepared = normalizeRecord(record);
      if (key !== recordKey(prepared)) {
        throw new Error("Token grant store key must match provider and account id.");
      }
      records.set(key, prepared);
      writeRecordsToDisk(normalizedPath, records.values());
      return this;
    },

    delete(key) {
      const deleted = records.delete(key);
      if (deleted) {
        writeRecordsToDisk(normalizedPath, records.values());
      }
      return deleted;
    },

    values() {
      return records.values();
    }
  };
}

export function summarizeTokenGrantStoreReadiness() {
  return {
    status: "persistent-store-primitive-ready",
    storage: "local JSON file containing encrypted OAuth token envelopes",
    guardrails: [
      "stores only vault-encrypted token records",
      "keeps token decryption inside the backend token vault",
      "uses atomic file replacement for grant updates"
    ],
    remainingBeforeImports: [
      "disconnect/delete/export API",
      "audit-log wiring",
      "feature-flagged import worker",
      "rate-limit handling"
    ]
  };
}

function normalizeFilePath(filePath) {
  const normalized = String(filePath || "").trim();
  if (!normalized) {
    throw new Error("Token grant store requires a file path.");
  }
  return normalized;
}

function readRecordsFromDisk(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw);
  if (parsed.version !== storeVersion || !Array.isArray(parsed.grants)) {
    throw new Error("Token grant store file has an unsupported format.");
  }
  return parsed.grants.map(normalizeRecord);
}

function writeRecordsToDisk(filePath, records) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  const payload = {
    version: storeVersion,
    grants: [...records].sort((a, b) => recordKey(a).localeCompare(recordKey(b)))
  };
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, filePath);
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Token grant store records must be objects.");
  }

  const providerId = normalizeId(record.providerId, "provider id");
  const accountId = normalizeId(record.accountId, "account id");
  const scopes = normalizeScopes(record.scopes);
  const encryptedTokenSet = normalizeEnvelope(record.encryptedTokenSet);

  return {
    providerId,
    accountId,
    scopes,
    consentedAt: normalizeTimestampField(record.consentedAt, "consentedAt"),
    updatedAt: normalizeTimestampField(record.updatedAt, "updatedAt"),
    tokenExpiresAt: normalizeTimestampField(record.tokenExpiresAt, "tokenExpiresAt"),
    hasRefreshToken: Boolean(record.hasRefreshToken),
    encryptedTokenSet
  };
}

function normalizeId(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9:._@-]{1,120}$/u.test(normalized)) {
    throw new Error(`Token grant store record has an invalid ${label}.`);
  }
  return normalized;
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("Token grant store records must include scopes.");
  }
  return scopes.map((scope) => normalizeScope(scope));
}

function normalizeScope(scope) {
  const normalized = String(scope || "").trim();
  if (!/^[a-zA-Z0-9:._-]+$/u.test(normalized)) {
    throw new Error("Token grant store record has an invalid scope.");
  }
  return normalized;
}

function normalizeEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("Token grant store records must include encrypted token envelopes.");
  }
  return {
    algorithm: normalizeEnvelopeField(envelope.algorithm, "algorithm"),
    iv: normalizeEnvelopeField(envelope.iv, "iv"),
    ciphertext: normalizeEnvelopeField(envelope.ciphertext, "ciphertext"),
    tag: normalizeEnvelopeField(envelope.tag, "tag")
  };
}

function normalizeEnvelopeField(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized || !/^[a-zA-Z0-9_-]+$/u.test(normalized)) {
    throw new Error(`Token grant store envelope has an invalid ${field}.`);
  }
  return normalized;
}

function normalizeTimestampField(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Token grant store record has an invalid ${field}.`);
  }
  return timestamp.toISOString();
}

function recordKey(record) {
  return `${record.providerId}:${record.accountId}`;
}
