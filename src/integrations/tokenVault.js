import { createCipheriv, createDecipheriv, randomBytes as nodeRandomBytes } from "node:crypto";
import { getProvider } from "./providers.js";

const algorithm = "aes-256-gcm";
const keyLengthBytes = 32;
const ivLengthBytes = 12;
const allowedTokenFields = new Set([
  "accessToken",
  "refreshToken",
  "tokenType",
  "expiresAt",
  "issuedAt",
  "scope"
]);

export function createInMemoryTokenVault({ encryptionKey, store = new Map(), now = Date.now, randomBytes = nodeRandomBytes } = {}) {
  const key = normalizeEncryptionKey(encryptionKey);

  return {
    saveGrant(grant) {
      const prepared = prepareGrant(grant, now);
      const aad = buildAdditionalData(prepared);
      const encryptedTokenSet = encryptTokenSet(prepared.tokenSet, key, aad, randomBytes);
      const record = {
        providerId: prepared.providerId,
        accountId: prepared.accountId,
        scopes: prepared.scopes,
        consentedAt: prepared.consentedAt,
        updatedAt: prepared.updatedAt,
        tokenExpiresAt: prepared.tokenExpiresAt,
        hasRefreshToken: Boolean(prepared.tokenSet.refreshToken),
        encryptedTokenSet
      };

      store.set(recordKey(record.providerId, record.accountId), record);
      return summarizeGrant(record);
    },

    loadGrant({ providerId, accountId }) {
      const record = getRecord(store, providerId, accountId);
      const tokenSet = decryptTokenSet(record.encryptedTokenSet, key, buildAdditionalData(record));
      return {
        ...summarizeGrant(record),
        tokenSet
      };
    },

    listGrants(providerId) {
      return [...store.values()]
        .filter((record) => !providerId || record.providerId === providerId)
        .map(summarizeGrant)
        .sort((a, b) => a.providerId.localeCompare(b.providerId) || a.accountId.localeCompare(b.accountId));
    },

    deleteGrant({ providerId, accountId }) {
      const provider = getProvider(providerId);
      return store.delete(recordKey(provider.id, normalizeAccountId(accountId)));
    }
  };
}

export function summarizeTokenVaultReadiness() {
  return {
    status: "backend-primitive-ready",
    storage: "encrypted server-side token envelopes",
    algorithm,
    requiredRuntime: "Node.js backend with a 32-byte key outside browser storage",
    remainingBeforeImports: [
      "disconnect/delete/export API",
      "audit-log wiring",
      "feature-flagged import worker",
      "rate-limit handling"
    ]
  };
}

function prepareGrant({ providerId, accountId, scopes, tokenSet, consentedAt, nowValue } = {}, now) {
  const provider = getProvider(providerId);
  if (provider.mode !== "oauth-pkce") {
    throw new Error(`${provider.label} does not use OAuth token grants.`);
  }

  const normalizedScopes = normalizeScopes(provider, scopes);
  const normalizedTokenSet = normalizeTokenSet(tokenSet);
  const updatedAt = new Date(nowValue || now()).toISOString();
  return {
    providerId: provider.id,
    accountId: normalizeAccountId(accountId),
    scopes: normalizedScopes,
    tokenSet: normalizedTokenSet,
    consentedAt: normalizeOptionalTimestamp(consentedAt) || updatedAt,
    updatedAt,
    tokenExpiresAt: normalizeOptionalTimestamp(normalizedTokenSet.expiresAt)
  };
}

function normalizeScopes(provider, scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("At least one consented OAuth scope is required.");
  }

  const allowedScopes = new Set(provider.scopes.map((scope) => scope.id));
  const normalized = scopes.map((scope) => String(scope || "").trim()).filter(Boolean);
  if (normalized.length !== scopes.length) {
    throw new Error("OAuth scopes must be non-empty strings.");
  }
  for (const scope of normalized) {
    if (!allowedScopes.has(scope)) {
      throw new Error(`Unsupported OAuth scope for ${provider.id}: ${scope}`);
    }
  }
  return [...new Set(normalized)].sort();
}

function normalizeTokenSet(tokenSet) {
  if (!tokenSet || typeof tokenSet !== "object" || Array.isArray(tokenSet)) {
    throw new TypeError("OAuth token set must be an object.");
  }
  const unknownFields = Object.keys(tokenSet).filter((field) => !allowedTokenFields.has(field));
  if (unknownFields.length) {
    throw new Error(`OAuth token set contains unsupported fields: ${unknownFields.join(", ")}`);
  }

  const accessToken = String(tokenSet.accessToken || "").trim();
  if (!accessToken) {
    throw new Error("OAuth token set requires an access token.");
  }

  return Object.fromEntries(
    Object.entries(tokenSet)
      .map(([key, value]) => [key, String(value ?? "").trim()])
      .filter(([, value]) => value)
  );
}

function encryptTokenSet(tokenSet, key, additionalData, randomBytes) {
  const iv = randomBytes(ivLengthBytes);
  if (!(iv instanceof Uint8Array) || iv.length !== ivLengthBytes) {
    throw new Error("Token vault random byte source returned an invalid IV.");
  }

  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(additionalData);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokenSet), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    algorithm,
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(ciphertext),
    tag: encodeBase64Url(tag)
  };
}

function decryptTokenSet(envelope, key, additionalData) {
  if (envelope?.algorithm !== algorithm) {
    throw new Error("Unsupported token envelope algorithm.");
  }

  const decipher = createDecipheriv(algorithm, key, decodeBase64Url(envelope.iv));
  decipher.setAAD(additionalData);
  decipher.setAuthTag(decodeBase64Url(envelope.tag));
  const plaintext = Buffer.concat([
    decipher.update(decodeBase64Url(envelope.ciphertext)),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(plaintext);
}

function getRecord(store, providerId, accountId) {
  const provider = getProvider(providerId);
  const record = store.get(recordKey(provider.id, normalizeAccountId(accountId)));
  if (!record) {
    throw new Error(`No OAuth grant found for ${provider.id}.`);
  }
  return record;
}

function summarizeGrant(record) {
  return {
    providerId: record.providerId,
    accountId: record.accountId,
    scopes: [...record.scopes],
    consentedAt: record.consentedAt,
    updatedAt: record.updatedAt,
    tokenExpiresAt: record.tokenExpiresAt,
    hasRefreshToken: Boolean(record.hasRefreshToken)
  };
}

function buildAdditionalData(record) {
  return Buffer.from(
    JSON.stringify({
      providerId: record.providerId,
      accountId: record.accountId,
      scopes: record.scopes
    }),
    "utf8"
  );
}

function normalizeEncryptionKey(encryptionKey) {
  if (typeof encryptionKey === "string") {
    const key = decodeBase64Url(encryptionKey);
    if (key.length === keyLengthBytes) {
      return key;
    }
  }
  if (encryptionKey instanceof Uint8Array && encryptionKey.length === keyLengthBytes) {
    return Buffer.from(encryptionKey);
  }
  throw new Error("Token vault encryption key must be 32 bytes.");
}

function normalizeAccountId(accountId) {
  const normalized = String(accountId || "").trim();
  if (!/^[a-zA-Z0-9:._@-]{1,120}$/u.test(normalized)) {
    throw new Error("OAuth account id must be a stable non-secret identifier.");
  }
  return normalized;
}

function normalizeOptionalTimestamp(value) {
  if (!value) {
    return "";
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid OAuth grant timestamp: ${value}`);
  }
  return timestamp.toISOString();
}

function recordKey(providerId, accountId) {
  return `${providerId}:${accountId}`;
}

function encodeBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || ""), "base64url");
}
