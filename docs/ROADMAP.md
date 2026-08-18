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

- Add backend OAuth callback handling and encrypted token vault wiring. A server-only token exchange route now validates PKCE state, loads server-side app configuration, calls official token endpoints through injected fetch, and stores token material only through the encrypted vault with file-backed persistence. The remaining work is disconnect/delete/export controls, audit logs, and production import workers.
- Extend the read-only OAuth adapter contract into platform API clients after token storage exists. The official read client boundary now enforces server-side vault access, least-privilege scopes, and read-only request handling for future production wiring.
- Normalize imported follows, saves, likes, topics, and muted content.
- Add clear permission controls and deletion/export.
- Keep automation disabled unless allowed by platform terms.

## Milestone 4: Portfolio Map

- Build a longitudinal personality/feed map.
- Show attention allocation, aspiration alignment, novelty, discipline, emotional load, and content clusters.
- Add "what changed this week" summaries. The model now has a normalized snapshot comparison primitive; the remaining work is local history storage and UI presentation.

## Milestone 5: Agentic Coach

- Recommend weekly feed-shaping plans.
- Explain why each recommendation exists.
- Offer user-approved actions only.
- Add safety checks for compulsive use, sensitive inference, and manipulation risk.
