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

The current repository includes the provider catalog, consent summaries, OAuth PKCE request construction, and normalized manual activity ingestion. The missing production backend pieces are callback handling, token exchange, encrypted token storage, scheduled imports, and real provider API clients.

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

- Current status: ready.
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

1. Backend callback service and encrypted token vault.
2. Twitter/X read-only import adapter behind feature flag.
3. Local normalized activity store.
4. Scheduled import worker with rate limiting and audit logs.
5. Portfolio map generated from normalized activities.
6. Instagram/Facebook feasibility spikes based on official API limits.
