# Brain Hacking Roadmap

## Milestone 1: Public Seed

- Build working local interface.
- Document thesis, guardrails, and architecture.
- Add deterministic tests for the planning engine.
- Prepare for public repository creation after explicit approval.

## Milestone 2: Manual Feed Journal

- Persist local plans and feed observations.
- Add before/after feed snapshots entered by the user.
- Track steering effectiveness across goals.
- Improve personality portfolio scoring with transparent dimensions.
- Use normalized activity records as the internal source model.

## Milestone 3: Official Integrations

- Add backend OAuth callback handling and encrypted token vault wiring. A server-only token exchange route now validates PKCE state, loads server-side app configuration, calls official token endpoints through injected fetch, and stores token material only through the encrypted vault with file-backed persistence. Server-side grant controls can list/export sanitized metadata and disconnect stored grants, with sanitized OAuth audit events for consent, callback, exchange, export, disconnect, import history, portfolio snapshot creation, and official read attempts. A disabled-by-default import route can run official reads through stored grants, skip unconsented endpoints, stop on provider rate limits, and persist normalized activities only when explicitly enabled by the backend. A file-backed normalized activity store primitive now supports sanitized, idempotent import history with server-side list/export/delete controls, and the browser can list/export/delete filtered normalized history. The remaining work is scheduler policy, history UX hardening, and provider review.
- Extend the read-only OAuth adapter contract into platform API clients after token storage exists. The official read client boundary now enforces server-side vault access, least-privilege scopes, read-only request handling, sanitized pagination cursors, and rate-limit surfacing for future production wiring.
- Normalize imported follows, saves, likes, topics, and muted content.
- Add clear permission controls and deletion/export.
- Keep automation disabled unless allowed by platform terms.

## Milestone 4: Portfolio Map

- Build a longitudinal personality/feed map.
- Show attention allocation, aspiration alignment, novelty, discipline, emotional load, and content clusters.
- Add "what changed this week" summaries. The model now has normalized snapshot comparison plus a file-backed portfolio history store and server controls to create derived goal-scoped snapshots from saved normalized import history, then list/export/delete/compare them without raw activity payloads; the remaining work is browser snapshot creation controls and retention policy hardening.

## Milestone 5: Agentic Coach

- Recommend weekly feed-shaping plans.
- Explain why each recommendation exists.
- Offer user-approved actions only.
- Add safety checks for compulsive use, sensitive inference, and manipulation risk.
