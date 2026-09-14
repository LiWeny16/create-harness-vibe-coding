# Skills Market AC-003/AC-004 RED evidence

Date: 2026-09-09  
Role: independent Test Writer (Luna xhigh)

## Contract-derived tests

The task PLAN identifies:

- AC-003: Skills Hub is the single skills surface and the create-node panel
  must not expose a second skills-hub surface.
- AC-004: a composed set of skills can be dragged from the Skills Hub onto the
  node map and becomes a skills-group node attachable to an Agent.

The requested market boundary is exercised as a real HTTP server path in
`tests/review-skills-market-ac-003-004.test.mjs`:

- AC-003 sends `GET /api/workflow/skills-market?scope=project` and requires
  HTTP 200 JSON with `ok: true`, `kind: "skills-market"`, numeric
  `schemaVersion`, and an array `packs` field.
- AC-004 sends `POST /api/workflow/skills-market/install` with an unknown
  `packId`. The route must exist and return a structured client error rather
  than a missing-route 404; this prevents a UI install client/build path from
  silently targeting an absent endpoint.

The test uses `makeHarnessTempRoot`, a local workflow-map fixture, and one
local metadata-only skill. It does not invoke a provider, browser, network
service, or paid inference.

## RED run

Command:

```text
node --test tests/review-skills-market-ac-003-004.test.mjs
```

Result: exit `1`; 2 tests, 0 pass, 2 fail, 0 skipped.

Observed business failures:

```text
GET /api/workflow/skills-market -> HTTP 404
{"error":{"code":"NOT_FOUND","message":"No route matches GET /api/workflow/skills-market"}}

POST /api/workflow/skills-market/install -> HTTP 404
{"error":{"code":"NOT_FOUND","message":"No route matches POST /api/workflow/skills-market/install"}}
```

The first failure is the AC-003 market contract absence. The second is the
AC-004 install-route/client boundary absence. The assertions deliberately do
not accept a 404 or rewrite the expected endpoint to match an existing route.

Cleanup is ownership-checked: every fixture root comes from
`makeHarnessTempRoot` and the test teardown refuses to remove a path outside
`Harness/.temp` before recursive cleanup. No production source, existing test,
task STATE/PLAN, Harness/a2a state, index, benchmark holdout, or user config
was modified.

## Status

This is the required pre-implementation RED only. GREEN, browser-visible drag
evidence, and the broader UI build/e2e matrix remain for the implementation and
independent validation waves.
