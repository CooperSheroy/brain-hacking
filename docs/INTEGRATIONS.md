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

The current repository includes the provider catalog, consent summaries, OAuth PKCE request construction, server-side callback intake, normalized manual activity ingestion, provider activity normalization, and an import adapter contract. The missing production backend pieces are token exchange, encrypted token storage, scheduled imports, and real provider API clients.

## Adapter Contract

Provider imports enter the product through `src/integrations/adapters.js`.

- Manual import is the only adapter that can import activities today. It accepts user-supplied text and emits normalized local activities.
- OAuth providers expose read-only adapter readiness, required scopes, guardrails, and blockers, but their import methods intentionally fail until backend OAuth callback exchange and encrypted server-side token storage exist.
- Adapter guardrails explicitly prohibit password collection, browser token storage, and automated engagement.
- The local server exposes `/api/oauth/authorization?provider=twitter` for backend-generated PKCE state and `/oauth/callback` for verified callback intake. The callback response stores no raw authorization code or token material.

This keeps UI and planner code adapter-oriented without implying that real social API access is available before official OAuth infrastructure is built.

## Normalized Activity Contract

Official API clients should translate platform payloads through `normalizeProviderActivities(providerId, records)` before planner or portfolio code sees them. The normalizer accepts provider-owned identifiers, read-scope provenance, timestamps, URLs, and explicit labels, then emits a constrained internal record:

- `id`, `source`, `type`, `label`, `weight`, and `capturedAt` are always present.
- `externalId`, `url`, and `permissionScope` are retained when supplied.
- Raw platform payloads, access tokens, private message content, and unrecognized signal types are not accepted by the normalized activity boundary.

This keeps future OAuth adapters focused on least-privilege read imports and makes unsupported or sensitive data fail closed.

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

1. Encrypted token vault and backend token exchange using the verified callback intake.
2. Twitter/X read-only API client that maps official payloads through the normalized activity contract behind a feature flag.
3. Local normalized activity store.
4. Scheduled import worker with rate limiting and audit logs.
5. Portfolio map generated from normalized activities.
6. Instagram/Facebook feasibility spikes based on official API limits.
