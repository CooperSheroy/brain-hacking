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
- `src/integrations/providers.js`: provider catalog, scope metadata, readiness status, and supported signal types.
- `src/integrations/adapters.js`: import adapter contract that allows local manual ingestion now and gates official OAuth imports behind backend token infrastructure.
- `src/integrations/oauth.js`: OAuth PKCE state, consent summaries, and authorization request construction.
- `src/integrations/oauthCallback.js`: server-side OAuth callback verification and no-token audit result shaping.
- `src/integrations/normalizedActivity.js`: normalized activity primitives for manual and future provider imports.
- `src/app.js`: browser state management, view switching, rendering, and export.
- `server.js`: no-framework local static server for development.

## Data Boundaries

The MVP only processes text the user manually provides in the browser. No remote API calls are made.

The integration foundation can construct OAuth authorization requests and verify callback state on the local Node server, but it does not exchange tokens or call provider APIs. Token exchange and storage must live in a backend service, not in the static browser UI.

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
