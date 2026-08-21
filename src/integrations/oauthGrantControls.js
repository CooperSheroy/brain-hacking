import { getProvider } from "./providers.js";

const guardrails = [
  "return sanitized OAuth grant summaries only",
  "never expose access tokens, refresh tokens, authorization codes, or client secrets",
  "disconnect by deleting the encrypted server-side grant"
];

export function listOAuthGrantSummaries({ tokenVault, providerId, auditLog } = {}) {
  const vault = assertTokenVault(tokenVault);
  const provider = providerId ? assertOAuthProvider(providerId) : null;
  const grants = vault.listGrants(provider?.id).map(sanitizeGrantSummary);
  appendAuditEvent(auditLog, {
    action: "grant-listed",
    providerId: provider?.id,
    status: "oauth-grant-list-ready",
    metadata: {
      grantCount: grants.length
    }
  });

  return {
    status: "oauth-grant-list-ready",
    providerId: provider?.id || null,
    grants,
    guardrails: [...guardrails]
  };
}

export function exportOAuthGrantSummaries({ tokenVault, providerId, auditLog, now = Date.now } = {}) {
  const listing = listOAuthGrantSummaries({ tokenVault, providerId });
  appendAuditEvent(auditLog, {
    action: "grant-exported",
    providerId: listing.providerId,
    status: "oauth-grant-export-ready",
    metadata: {
      grantCount: listing.grants.length
    }
  });

  return {
    status: "oauth-grant-export-ready",
    exportedAt: new Date(now()).toISOString(),
    providerId: listing.providerId,
    grants: listing.grants,
    retentionNote: "Export contains consent and grant metadata only; token material remains encrypted server-side.",
    guardrails: [...guardrails]
  };
}

export function disconnectOAuthGrant({ tokenVault, providerId, accountId, auditLog, now = Date.now } = {}) {
  const vault = assertTokenVault(tokenVault);
  const provider = assertOAuthProvider(providerId);
  const account = normalizeAccountId(accountId);
  const deleted = vault.deleteGrant({ providerId: provider.id, accountId: account });
  appendAuditEvent(auditLog, {
    action: "grant-disconnected",
    providerId: provider.id,
    accountId: account,
    status: deleted ? "oauth-grant-disconnected" : "oauth-grant-not-found",
    metadata: {
      deleted
    }
  });

  return {
    status: deleted ? "oauth-grant-disconnected" : "oauth-grant-not-found",
    providerId: provider.id,
    accountId: account,
    disconnectedAt: new Date(now()).toISOString(),
    deleted,
    guardrails: [...guardrails]
  };
}

export function summarizeOAuthGrantControlReadiness() {
  return {
    status: "disconnect-delete-export-controls-ready",
    supportedOperations: ["list sanitized grants", "export sanitized grant metadata", "disconnect stored grants"],
    remainingBeforeImports: [
      "provider-specific production permission review"
    ],
    guardrails: [...guardrails]
  };
}

function assertTokenVault(tokenVault) {
  if (!tokenVault?.listGrants || !tokenVault?.deleteGrant) {
    throw new TypeError("OAuth grant controls require a server-side token vault.");
  }
  return tokenVault;
}

function appendAuditEvent(auditLog, event) {
  if (!auditLog) {
    return;
  }
  if (typeof auditLog.append !== "function") {
    throw new TypeError("OAuth grant controls require an audit log with append().");
  }
  auditLog.append(event);
}

function assertOAuthProvider(providerId) {
  const provider = getProvider(providerId);
  if (provider.mode !== "oauth-pkce") {
    throw new Error(`${provider.label} does not use OAuth grants.`);
  }
  return provider;
}

function sanitizeGrantSummary(grant) {
  const safe = {
    providerId: normalizeId(grant.providerId, "provider id"),
    accountId: normalizeAccountId(grant.accountId),
    scopes: normalizeScopes(grant.scopes),
    consentedAt: normalizeTimestamp(grant.consentedAt),
    updatedAt: normalizeTimestamp(grant.updatedAt),
    tokenExpiresAt: normalizeTimestamp(grant.tokenExpiresAt),
    hasRefreshToken: Boolean(grant.hasRefreshToken)
  };

  const unsafeFields = ["tokenSet", "accessToken", "refreshToken", "authorizationCode", "clientSecret"];
  for (const field of unsafeFields) {
    if (field in grant) {
      throw new Error(`OAuth grant summary contains unsafe field: ${field}`);
    }
  }
  return safe;
}

function normalizeId(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9:._@-]{1,120}$/u.test(normalized)) {
    throw new Error(`OAuth grant control received an invalid ${label}.`);
  }
  return normalized;
}

function normalizeAccountId(accountId) {
  return normalizeId(accountId, "account id");
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("OAuth grant summary must include scopes.");
  }
  return scopes.map((scope) => normalizeScope(scope));
}

function normalizeScope(scope) {
  const normalized = String(scope || "").trim();
  if (!/^[a-zA-Z0-9:._-]+$/u.test(normalized)) {
    throw new Error("OAuth grant summary contains an invalid scope.");
  }
  return normalized;
}

function normalizeTimestamp(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`OAuth grant summary contains an invalid timestamp: ${value}`);
  }
  return timestamp.toISOString();
}
