# Brain Hacking

Brain Hacking is a local-first prototype for intentional social feed steering.
The product helps a user decide how they want their social algorithm to shape their attention, then generates a practical engagement plan for platforms such as Twitter/X, Instagram, and Facebook.

The long-term direction is a consent-based personality and feed portfolio: a map of what the user's feeds currently reinforce, what the user wants to become, and which interactions are moving the feed in that direction.

## MVP

- Feed steering planner for goals such as discipline, recipes, founder thinking, and calmer feeds.
- Manual signal import for early feed analysis without collecting credentials.
- Personality portfolio estimate from the selected goal and user-provided feed signals.
- Exportable local plan JSON.
- Static browser app with a tiny Node server.
- Provider integration foundation with OAuth/PKCE request construction, server-side callback intake, consent summaries, and normalized activity primitives.

## Run

```bash
npm start
```

Then open:

```text
http://localhost:4175
```

## Validate

```bash
npm test
npm run check
```

## Product Guardrails

Brain Hacking should help users intentionally shape their own information diet. It should not:

- automate fake likes, follows, comments, or other inauthentic engagement;
- bypass social-platform terms, rate limits, or consent boundaries;
- collect social credentials directly;
- infer or expose sensitive traits without explicit user consent and clear controls.

Official platform integrations should use OAuth, least-privilege scopes, clear data retention rules, and user-visible deletion/export controls.

## Integration Status

Real social media account connections are not live yet. The repository now contains the production foundation for integrations:

- provider catalog for Twitter/X, Instagram, Facebook, and manual import;
- OAuth PKCE state and authorization URL construction;
- server-side OAuth callback verification that records only an authorization-code fingerprint;
- per-scope consent and risk summaries;
- normalized activity primitives for imported or manually supplied signals.

See `docs/INTEGRATIONS.md` for the production integration plan.
