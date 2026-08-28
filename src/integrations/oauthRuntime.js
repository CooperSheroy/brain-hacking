import { join, resolve } from "node:path";
import { createFilePortfolioHistoryStore } from "../portfolioHistoryStore.js";
import { createFileNormalizedActivityStore } from "./activityStore.js";
import { createFileOAuthAuditLog } from "./oauthAuditLog.js";
import { getProvider } from "./providers.js";
import { createFileTokenGrantStore } from "./tokenGrantStore.js";
import { createInMemoryTokenVault } from "./tokenVault.js";

const vaultKeyEnv = "BRAIN_HACKING_TOKEN_VAULT_KEY";
const grantStorePathEnv = "BRAIN_HACKING_TOKEN_GRANT_STORE";
const auditLogPathEnv = "BRAIN_HACKING_OAUTH_AUDIT_LOG";
const activityStorePathEnv = "BRAIN_HACKING_ACTIVITY_STORE";
const portfolioHistoryStorePathEnv = "BRAIN_HACKING_PORTFOLIO_HISTORY_STORE";
const officialImportsEnabledEnv = "BRAIN_HACKING_OFFICIAL_IMPORTS_ENABLED";

export function createServerOAuthRuntime({
  env = process.env,
  rootDir = process.cwd(),
  fetchImpl = globalThis.fetch,
  now = Date.now,
  tokenVault,
  auditLog,
  activityStore,
  portfolioHistoryStore,
  randomBytes
} = {}) {
  let cachedVault = tokenVault || null;
  let cachedAuditLog = auditLog || null;
  let cachedActivityStore = activityStore || null;
  let cachedPortfolioHistoryStore = portfolioHistoryStore || null;

  return {
    fetchImpl,
    now,
    officialImportsEnabled: readBooleanEnv(env, officialImportsEnabledEnv),

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

    loadActivityStore() {
      if (cachedActivityStore) {
        return cachedActivityStore;
      }

      cachedActivityStore = createFileNormalizedActivityStore({
        filePath: resolveActivityStorePath(env, rootDir)
      });
      return cachedActivityStore;
    },

    loadPortfolioHistoryStore() {
      if (cachedPortfolioHistoryStore) {
        return cachedPortfolioHistoryStore;
      }

      cachedPortfolioHistoryStore = createFilePortfolioHistoryStore({
        filePath: resolvePortfolioHistoryStorePath(env, rootDir)
      });
      return cachedPortfolioHistoryStore;
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
    optionalEnv: [
      grantStorePathEnv,
      auditLogPathEnv,
      activityStorePathEnv,
      portfolioHistoryStorePathEnv,
      officialImportsEnabledEnv
    ],
    officialImportsEnabled: readBooleanEnv(env, officialImportsEnabledEnv),
    grantStorePath: resolveGrantStorePath(env, rootDir),
    auditLogPath: resolveAuditLogPath(env, rootDir),
    activityStorePath: resolveActivityStorePath(env, rootDir),
    portfolioHistoryStorePath: resolvePortfolioHistoryStorePath(env, rootDir),
    guardrails: [
      "load OAuth client configuration only from server environment variables",
      "persist token grants as encrypted server-side envelopes",
      "record sanitized OAuth audit events without token material",
      "store derived portfolio snapshots separately from normalized activity history and OAuth grants",
      "keep official imports disabled unless the backend feature flag is explicitly enabled",
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

function resolveActivityStorePath(env, rootDir) {
  const configured = String(env?.[activityStorePathEnv] || "").trim();
  return configured ? resolve(configured) : join(rootDir, ".brain-hacking", "activities.json");
}

function resolvePortfolioHistoryStorePath(env, rootDir) {
  const configured = String(env?.[portfolioHistoryStorePathEnv] || "").trim();
  return configured ? resolve(configured) : join(rootDir, ".brain-hacking", "portfolio-history.json");
}

function readBooleanEnv(env, name) {
  return ["1", "true", "yes"].includes(String(env?.[name] || "").trim().toLowerCase());
}
