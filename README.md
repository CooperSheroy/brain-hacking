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
- Provider integration foundation with OAuth/PKCE request construction, server-side callback intake, backend token exchange route, encrypted token vault primitives, file-backed encrypted grant storage, server-side grant list/export/disconnect controls, server-side and browser import history list/export/delete controls, consent summaries, normalized activity boundaries, and a disabled-by-default official import worker.

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
- backend-only token exchange route that saves grants through the encrypted vault without returning raw codes or tokens;
- backend-only encrypted token envelopes and a file-backed grant store for future official token exchange wiring;
- server-side grant controls for listing/exporting sanitized metadata and disconnecting stored grants without exposing token material;
- disabled-by-default official import worker that reads only consented endpoints, stops on rate limits, and returns normalized activity summaries without token material;
- server-side and browser import history controls for listing, exporting, and deleting sanitized normalized activities without touching OAuth grants;
- per-scope consent and risk summaries;
- normalized activity boundaries for imported or manually supplied signals.

See `docs/INTEGRATIONS.md` for the production integration plan.
