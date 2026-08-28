# Social Integration Plan

Brain Hacking should integrate with social platforms through official APIs only. The product should start with read-oriented imports and user-approved recommendations before considering any account-changing action.

## Architecture

```text
Provider catalog
  -> OAuth consent request
  -> PKCE authorization URL
  -> Backend callback exchange
  -> Encrypted token store
  -> Provider import adapter
  -> Normalized activity model
  -> Feed/personality analysis
```

The current repository includes the provider catalog, consent summaries, OAuth PKCE request construction, server-side callback intake, a backend token exchange route, server-side runtime configuration, encrypted token vault primitives, file-backed encrypted grant persistence, sanitized OAuth audit logging, server-side grant list/export/disconnect controls, normalized manual activity ingestion, provider activity normalization, a file-backed normalized activity store primitive, server-side import history list/export/delete controls, a browser import history surface for filtered list/export/delete, server-side portfolio history list/export/delete/compare controls, an official read API client boundary, a disabled-by-default official import route with worker-to-store persistence, and an import adapter contract. The missing production backend pieces are scheduler policy, history UX hardening, and provider-specific production hardening.

## Adapter Contract

Provider imports enter the product through `src/integrations/adapters.js`.

- Manual import is the only adapter that can import activities today. It accepts user-supplied text and emits normalized local activities.
- OAuth providers expose read-only adapter readiness, required scopes, guardrails, and blockers, but their browser-facing import methods intentionally fail until retention UX hardening and provider review are complete.
- Adapter guardrails explicitly prohibit password collection, browser token storage, and automated engagement.
- The local server exposes `/api/oauth/authorization?provider=twitter` for backend-generated PKCE state, `/oauth/callback` for verified callback intake, `/api/oauth/token-exchange` for server-side authorization-code exchange, `/api/oauth/import` for disabled-by-default official read imports with normalized activity persistence, `/api/oauth/import-history` plus `/api/oauth/import-history/export` for normalized history controls, `/api/portfolio/history`, `/api/portfolio/history/export`, and `/api/portfolio/history/compare` for derived portfolio snapshot controls, and `/api/oauth/runtime` for sanitized backend readiness. The browser history panel calls import history controls with explicit provider/type filters for deletion. The callback and import responses store no raw authorization code, raw provider payload, or token material.
- `src/integrations/tokenVault.js` provides the backend-only encrypted token envelope primitive for future OAuth token exchange wiring. It has no public endpoint, accepts only least-privilege catalog scopes, and keeps raw tokens out of grant summaries and browser code.
- `src/integrations/tokenGrantStore.js` provides a file-backed persistence adapter for those encrypted envelopes. It stores only vault records, validates the store format on load, and updates the file through atomic replacement.
- `src/integrations/oauthAuditLog.js` provides an append-only server-side audit event log for OAuth consent, callback, token exchange, grant export/disconnect/list, import history controls, portfolio history controls, and official read attempts. It rejects token-like fields before persistence.
- `src/integrations/oauthGrantControls.js` provides server-side grant controls for listing sanitized grants, exporting metadata-only grant summaries, and disconnecting accounts by deleting encrypted stored grants.
- `src/integrations/oauthTokenExchange.js` defines the server-only authorization-code exchange boundary. It requires verified PKCE state, injected server-side client configuration, an encrypted token vault, and an injected `fetch`; it returns only a grant summary and never raw authorization codes, client secrets, or tokens.
- `src/integrations/oauthRuntime.js` wires that boundary to server environment variables, a file-backed encrypted grant store, a normalized activity store, an explicit official-import feature flag, and no-secret readiness summaries.
- `src/integrations/officialImportWorker.js` orchestrates backend-only stored-grant reads behind an explicit feature flag. It imports only consented endpoints, skips endpoints outside the grant scopes, stops on provider rate limits, and returns normalized activity summaries without token material.
- `src/integrations/activityStore.js` provides a file-backed normalized activity store primitive for import history. It accepts only sanitized normalized records, rejects token/code/password/private-message/raw payload fields, uses idempotent source/id upserts for import retries, and supports source, type, and time-bounded reads/deletes.
- `src/integrations/activityHistoryControls.js` provides the server-side user-control boundary for normalized import history. `GET /api/oauth/import-history` lists bounded sanitized records, `GET /api/oauth/import-history/export` exports matching normalized history, and `DELETE /api/oauth/import-history` deletes records only through explicit source, type, or time filters. These controls never touch OAuth grants or token material.

This keeps UI and planner code adapter-oriented without implying that real social API access is user-facing before provider review and durable history controls are complete.

## Normalized Activity Contract

Official API clients should translate platform payloads through `normalizeProviderActivities(providerId, records)` before planner or portfolio code sees them. The normalizer accepts provider-owned identifiers, read-scope provenance, timestamps, URLs, and explicit labels, then emits a constrained internal record:

- `id`, `source`, `type`, `label`, `weight`, and `capturedAt` are always present.
- `externalId`, `url`, and `permissionScope` are retained when supplied.
- `permissionScope` must match a scope declared for that provider, and retained URLs must use `http` or `https`.
- Raw platform payloads, access tokens, authorization codes, private message content, and unrecognized signal types are not accepted by the normalized activity boundary.

This keeps future OAuth adapters focused on least-privilege read imports and makes unsupported or sensitive data fail closed.

## Official Read Client Boundary

`src/integrations/officialApiClient.js` defines the first backend-only API client seam for official social reads. It is intentionally small and test-injected:

- It loads access tokens only through the server-side token vault.
- It exposes declared read endpoints and their required scopes without leaking endpoint templates to the UI.
- It refuses to fetch when the encrypted grant is expired or missing the endpoint's least-privilege scope.
- It sends only `GET` requests, maps successful provider records through `normalizeProviderActivities`, and returns no token material.
- It returns adapter-ready import metadata, required-scope provenance, normalized activity summaries, and activities in the same shape that portfolio snapshots consume.
- It surfaces provider rate limits and errors as import failures instead of retrying or working around platform controls.

This advances the OAuth/API roadmap while keeping real credential collection, scraping, and engagement automation out of scope.

## Official Import Worker

`src/integrations/officialImportWorker.js` is the first bounded import orchestration layer for stored OAuth grants:

- It is disabled by default and returns an inert status unless the backend explicitly enables it.
- It reads grant summaries from the server-side vault to select only endpoints covered by consented scopes.
- It delegates provider requests to the official read client, so access tokens stay inside backend-only code.
- It imports endpoints sequentially and stops on `429` responses, returning `retryAfterSeconds` when the provider supplies a `Retry-After` header.
- It returns normalized activities plus source/type summaries that the portfolio map can consume.

This is still not a user-facing live import feature. The next step is provider production review, scheduler policy, and history retention UX hardening.

## Normalized Activity Store

`src/integrations/activityStore.js` is the durable storage primitive for normalized activity history:

- It persists only the constrained normalized activity shape consumed by the portfolio model.
- It rejects raw platform payloads, access tokens, refresh tokens, authorization codes, client secrets, passwords, and private message content.
- It validates source IDs against the provider catalog and validates provider permission scopes before saving.
- It upserts by `source` and `id`, making repeated official import attempts idempotent.
- It supports source, type, and time-bounded reads/deletes so future user controls can export or remove imported history without touching OAuth grant storage.

The store is connected to the disabled-by-default backend import route for successful official read results, plus server-side and browser controls for list/export/delete. Official reads still require explicit backend feature-flag enablement, provider review, and retention policy hardening before production use.

## Import History Controls

`src/integrations/activityHistoryControls.js` defines the first user-control boundary over persisted normalized activities:

- `GET /api/oauth/import-history` returns sanitized normalized records, optionally filtered by `provider`, `source`, `type`, `since`, `until`, and bounded by `limit`.
- `GET /api/oauth/import-history/export` returns matching normalized history plus a retention note for user export flows.
- `DELETE /api/oauth/import-history` removes stored activities only when the request includes at least one source, type, or time boundary enforced by the activity store.
- All operations append sanitized audit events and reject token-like fields before returning records.
- `src/integrations/importHistoryUi.js` keeps browser-side route construction, bounded limits, provider options, and guarded delete payloads separate from rendering.

These controls advance retention/export/delete readiness without enabling live imports, collecting social credentials, or exposing raw provider payloads.

## Portfolio History Controls

`src/portfolioHistoryControls.js` defines the server-side user-control boundary over derived portfolio snapshots:

- `GET /api/portfolio/history` returns bounded derived snapshots, optionally filtered by `goal`, `goalId`, `since`, and `until`.
- `GET /api/portfolio/history/export` returns matching snapshots plus a retention note for user export flows.
- `GET /api/portfolio/history/compare` compares the latest two snapshots for one goal without reading raw activities.
- `DELETE /api/portfolio/history` removes snapshots only through an explicit goal or time boundary enforced by the portfolio history store.
- Responses contain derived dimensions, clusters, and summaries only; OAuth grants, tokens, authorization codes, private messages, and raw provider payloads remain outside this boundary.

These controls advance the personality/feed portfolio model while keeping official imports disabled by default and keeping sensitive inference history reviewable, exportable, and deletable.

## OAuth Token Exchange Boundary

`src/integrations/oauthTokenExchange.js` is the first production-shaped seam between verified OAuth callbacks and encrypted token storage:

- It posts authorization-code exchanges only to the provider's official token endpoint.
- It requires the original PKCE code verifier and redirect URI from verified pending state.
- It rejects placeholder client IDs/secrets so sample environment names cannot accidentally become credentials.
- It persists token material only by calling the backend token vault and returns sanitized grant summaries.
- It fails closed when providers return unsupported scopes, token errors, or malformed token payloads.

This module is now exposed through `/api/oauth/token-exchange` behind server-side runtime configuration. The route consumes verified PKCE state, loads OAuth client IDs/secrets from environment variables, persists grants through the encrypted vault and file store, records sanitized audit events, and returns only sanitized summaries. The next production step is to add user-visible controls and scheduler policy around the feature-flagged import route.

## OAuth Grant Controls

`src/integrations/oauthGrantControls.js` defines the user-control boundary for persisted OAuth grants:

- `GET /api/oauth/grants` returns sanitized grant summaries, optionally filtered by `provider`.
- `GET /api/oauth/grants/export` returns a metadata-only export payload for user-visible account records.
- `DELETE /api/oauth/grants` disconnects a provider account by deleting its encrypted server-side grant.
- Responses never include access tokens, refresh tokens, authorization codes, or client secrets.

These controls close the first disconnect/delete/export gap without enabling user-facing live social imports. Imports still require explicit backend feature-flag enablement, user-visible history controls, and provider production review.

## Portfolio Model Boundary

`src/portfolioModel.js` consumes only normalized activity records. It returns explainable portfolio dimensions, source/type summaries, and top content clusters without preserving raw provider payloads or token material.

Current dimensions are aspiration alignment, attention focus, novelty, execution bias, and noise exposure. They are deterministic MVP heuristics intended to make scoring transparent while future OAuth adapters and local history storage mature.

The same boundary now supports snapshot comparisons through `comparePortfolioMaps(beforeActivities, afterActivities, goalId)`. It reports dimension deltas, activity-count movement, emerging clusters, fading clusters, and a short headline without storing raw provider payloads. A file-backed portfolio history store plus server-side controls can now list, export, delete, and compare derived snapshots. The remaining work is browser presentation and user-approved snapshot creation from saved import batches.

## Provider Readiness

### Twitter/X

- Current status: OAuth PKCE foundation ready.
- First target signals: follows, liked/saved content where available, recent posts, muted topic notes supplied by the user.
- Risk: API access and pricing may constrain useful imports.

### Instagram

- Current status: provider planned.
- First target signals: profile, owned media captions, creator clusters where API permissions allow them.
- Risk: personal feed visibility is limited by platform APIs.

### Facebook

- Current status: provider planned.
- First target signals: public profile and explicitly granted interest/page signals.
- Risk: permission review is likely needed for anything beyond minimal profile access.

### Manual Import

- Current status: ready through the local manual adapter.
- First target signals: pasted topics, export notes, self-audits, feed observations.
- Risk: lower automation, but strongest privacy posture for the MVP.

## Security Requirements

- Never collect account passwords.
- Use OAuth with PKCE for public clients.
- Store tokens server-side only, encrypted at rest.
- Request the smallest viable scope set for each import.
- Separate read scopes from any future write/action scopes.
- Make every account-changing action user-approved and auditable.
- Provide user-visible disconnect, delete, and export controls.
- Keep provider API errors and rate limits observable.

## Production Milestones

1. Scheduled imports with provider-specific rate-limit policy.
2. Portfolio map generated from persisted normalized activities.
3. History UX hardening for retention windows, confirmations, and empty states.
4. Instagram/Facebook feasibility spikes based on official API limits.
