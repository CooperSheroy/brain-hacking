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

The current repository includes the provider catalog, consent summaries, OAuth PKCE request construction, server-side callback intake, encrypted token vault primitives, normalized manual activity ingestion, provider activity normalization, and an import adapter contract. The missing production backend pieces are token exchange, persistent encrypted storage wiring, scheduled imports, and real provider API clients.

## Adapter Contract

Provider imports enter the product through `src/integrations/adapters.js`.

- Manual import is the only adapter that can import activities today. It accepts user-supplied text and emits normalized local activities.
- OAuth providers expose read-only adapter readiness, required scopes, guardrails, and blockers, but their import methods intentionally fail until backend OAuth token exchange is wired to the encrypted token vault and production controls.
- Adapter guardrails explicitly prohibit password collection, browser token storage, and automated engagement.
- The local server exposes `/api/oauth/authorization?provider=twitter` for backend-generated PKCE state and `/oauth/callback` for verified callback intake. The callback response stores no raw authorization code or token material.
- `src/integrations/tokenVault.js` provides the backend-only encrypted token envelope primitive for future OAuth token exchange wiring. It has no public endpoint, accepts only least-privilege catalog scopes, and keeps raw tokens out of grant summaries and browser code.

This keeps UI and planner code adapter-oriented without implying that real social API access is available before official OAuth token exchange, persistent encrypted storage, disconnect controls, and import workers are built.

## Normalized Activity Contract

Official API clients should translate platform payloads through `normalizeProviderActivities(providerId, records)` before planner or portfolio code sees them. The normalizer accepts provider-owned identifiers, read-scope provenance, timestamps, URLs, and explicit labels, then emits a constrained internal record:

- `id`, `source`, `type`, `label`, `weight`, and `capturedAt` are always present.
- `externalId`, `url`, and `permissionScope` are retained when supplied.
- `permissionScope` must match a scope declared for that provider, and retained URLs must use `http` or `https`.
- Raw platform payloads, access tokens, authorization codes, private message content, and unrecognized signal types are not accepted by the normalized activity boundary.

This keeps future OAuth adapters focused on least-privilege read imports and makes unsupported or sensitive data fail closed.

## Portfolio Model Boundary

`src/portfolioModel.js` consumes only normalized activity records. It returns explainable portfolio dimensions, source/type summaries, and top content clusters without preserving raw provider payloads or token material.

Current dimensions are aspiration alignment, attention focus, novelty, execution bias, and noise exposure. They are deterministic MVP heuristics intended to make scoring transparent while future OAuth adapters and local history storage mature.

The same boundary now supports snapshot comparisons through `comparePortfolioMaps(beforeActivities, afterActivities, goalId)`. It reports dimension deltas, activity-count movement, emerging clusters, fading clusters, and a short headline without storing raw provider payloads. This is the foundation for weekly "what changed" summaries once local history and official read imports exist.

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

1. Backend token exchange using the verified callback intake and encrypted token vault.
2. Persistent encrypted token store plus disconnect/delete/export controls.
3. Twitter/X read-only API client that maps official payloads through the normalized activity contract behind a feature flag.
4. Local normalized activity store.
5. Scheduled import worker with rate limiting and audit logs.
6. Portfolio map generated from normalized activities.
7. Instagram/Facebook feasibility spikes based on official API limits.
