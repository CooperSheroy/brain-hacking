# Brain Hacking Architecture

## Product Thesis

Social feeds already train attention. Brain Hacking gives users a control surface for that process: choose a desired identity or content direction, translate it into safe feed interactions, and measure whether the feed starts reflecting that intention.

## System Shape

The first implementation is intentionally local-first.

```text
Browser UI
  -> Feed planner
  -> Signal analyzer
  -> Personality portfolio estimator
  -> Exported local plan
```

Future official integrations should be added through provider adapters:

```text
Provider OAuth
  -> Consent and scope registry
  -> Feed/activity import jobs
  -> Normalized interaction store
  -> Recommendation steering model
  -> Portfolio map and feedback loop
```

## Modules

- `src/feedPlanner.js`: deterministic goal catalog, prompt plan generation, signal analysis, and first portfolio scoring.
- `src/portfolioModel.js`: explainable portfolio dimensions, content clusters, and snapshot deltas derived from normalized activity records.
- `src/integrations/providers.js`: provider catalog, scope metadata, readiness status, and supported signal types.
- `src/integrations/adapters.js`: import adapter contract that allows local manual ingestion now and gates official OAuth imports behind backend token infrastructure.
- `src/integrations/oauth.js`: OAuth PKCE state, consent summaries, and authorization request construction.
- `src/integrations/oauthCallback.js`: server-side OAuth callback verification and no-token audit result shaping.
- `src/integrations/oauthTokenExchange.js`: server-only authorization-code exchange boundary that requires verified PKCE state and stores token material only through a token vault.
- `src/integrations/oauthRuntime.js`: server runtime wiring for OAuth client configuration, encrypted file-backed grant storage, and no-secret readiness summaries.
- `src/integrations/oauthAuditLog.js`: append-only server-side audit log for sanitized OAuth consent, callback, exchange, grant-control, and official-read attempt events.
- `src/integrations/oauthGrantControls.js`: server-side list/export/disconnect controls over sanitized OAuth grant summaries.
- `src/integrations/tokenVault.js`: backend-only encrypted token grant envelopes for future persistent OAuth grant storage.
- `src/integrations/tokenGrantStore.js`: file-backed persistence for encrypted OAuth grant envelopes, designed to sit behind the backend token vault.
- `src/integrations/normalizedActivity.js`: normalized activity primitives for manual imports and sanitized official provider records.
- `src/app.js`: browser state management, view switching, rendering, and export.
- `server.js`: no-framework local static server for development.

## Data Boundaries

The MVP only processes text the user manually provides in the browser. No remote API calls are made. Manual text is first converted into normalized local activity records, then the portfolio model reads those records through the same boundary planned for official integrations.

The integration foundation can construct OAuth authorization requests, verify callback state on the local Node server, exchange authorization codes in a server-only route, encrypt token grant envelopes for backend storage, persist those encrypted envelopes in a server-side file store, record sanitized audit events, and expose sanitized grant list/export/disconnect controls. It does not collect production credentials in the browser or call provider APIs from the static UI. Token exchange, storage, and audit wiring live in the backend service.

For the long-term version, every platform connector needs:

- OAuth-based authentication;
- explicit read/write scope review;
- encrypted token storage;
- per-platform rate limiting;
- user-controlled data deletion;
- audit logs for any action that changes a platform account.

## Risk Notes

- Social-platform APIs are constrained and may not expose enough feed data for full algorithm steering.
- The product must avoid manipulative framing. It should present itself as user agency and attention hygiene, not covert algorithm exploitation.
- Personality mapping can become sensitive. The default should be private, explainable, editable, and deletable.
- Automated engagement is high-risk legally and reputationally. The first public product should keep actions as user-visible recommendations unless platform terms clearly permit automation.

## First Public Milestone

- Working local browser MVP.
- Public README with ethical boundaries.
- Manual import and export.
- No credential collection.
- Issue backlog for official OAuth integrations.
