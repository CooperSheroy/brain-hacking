import { join, resolve } from "node:path";
import { createFileOAuthAuditLog } from "./oauthAuditLog.js";
import { getProvider } from "./providers.js";
import { createFileTokenGrantStore } from "./tokenGrantStore.js";
import { createInMemoryTokenVault } from "./tokenVault.js";

const vaultKeyEnv = "BRAIN_HACKING_TOKEN_VAULT_KEY";
const grantStorePathEnv = "BRAIN_HACKING_TOKEN_GRANT_STORE";
const auditLogPathEnv = "BRAIN_HACKING_OAUTH_AUDIT_LOG";

export function createServerOAuthRuntime({
  env = process.env,
  rootDir = process.cwd(),
  fetchImpl = globalThis.fetch,
  now = Date.now,
  tokenVault,
  auditLog,
  randomBytes
} = {}) {
  let cachedVault = tokenVault || null;
  let cachedAuditLog = auditLog || null;

  return {
    fetchImpl,
    now,

    loadTokenVault() {
      if (cachedVault) {
        return cachedVault;
      }

      const encryptionKey = readRequiredEnv(env, vaultKeyEnv);
      cachedVault = createInMemoryTokenVault({
        encryptionKey,
        store: createFileTokenGrantStore({ filePath: resolveGrantStorePath(env, rootDir) }),
        now,
        ...(randomBytes ? { randomBytes } : {})
      });
      return cachedVault;
    },

    loadAuditLog() {
      if (cachedAuditLog) {
        return cachedAuditLog;
      }

      cachedAuditLog = createFileOAuthAuditLog({
        filePath: resolveAuditLogPath(env, rootDir),
        now
      });
      return cachedAuditLog;
    },

    getClientConfig(providerId) {
      const provider = getProvider(providerId);
      if (provider.mode !== "oauth-pkce") {
        throw new Error(`${provider.label} does not use OAuth token exchange.`);
      }

      const config = {
        clientId: readRequiredEnv(env, provider.oauth.clientIdPlaceholder)
      };
      if (provider.oauth.clientSecretPlaceholder) {
        config.clientSecret = readRequiredEnv(env, provider.oauth.clientSecretPlaceholder);
      }
      return config;
    }
  };
}

export function summarizeServerOAuthRuntime(env = process.env, rootDir = process.cwd()) {
  return {
    status: env[vaultKeyEnv] ? "configured" : "requires-server-configuration",
    requiredEnv: [vaultKeyEnv],
    optionalEnv: [grantStorePathEnv, auditLogPathEnv],
    grantStorePath: resolveGrantStorePath(env, rootDir),
    auditLogPath: resolveAuditLogPath(env, rootDir),
    guardrails: [
      "load OAuth client configuration only from server environment variables",
      "persist token grants as encrypted server-side envelopes",
      "record sanitized OAuth audit events without token material",
      "do not expose authorization codes, client secrets, or tokens in route responses"
    ]
  };
}

function readRequiredEnv(env, name) {
  const value = String(env?.[name] || "").trim();
  if (!value) {
    throw new Error(`OAuth token exchange route requires server environment variable ${name}.`);
  }
  return value;
}

function resolveGrantStorePath(env, rootDir) {
  const configured = String(env?.[grantStorePathEnv] || "").trim();
  return configured ? resolve(configured) : join(rootDir, ".brain-hacking", "oauth-grants.json");
}

function resolveAuditLogPath(env, rootDir) {
  const configured = String(env?.[auditLogPathEnv] || "").trim();
  return configured ? resolve(configured) : join(rootDir, ".brain-hacking", "oauth-audit-log.json");
}
