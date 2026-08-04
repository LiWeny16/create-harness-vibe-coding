# Browser Control Patterns

Use this reference when comparing `wf-browser` against external browser-agent
patterns or refining the skill itself.

## External Signals

- Playwright MCP favors structured accessibility snapshots with stable element
  refs, which is better for agents than raw screenshot or DOM scraping. Harness
  should keep `observe.uiTree` similarly structured, but add first-party
  capability ids when source is editable.
- Stagehand separates `observe`, `act`, `extract`, and `agent`. Harness should
  keep the same primitive boundary style while preferring deterministic
  capability actions over natural-language target resolution for owned apps.
- Agent Browser Protocol frames browsing as one settled step at a time, with
  input, screenshot, event log, and cursor evidence per step. Harness should
  emulate that at the frontend/backend debug layer without requiring a custom
  Chromium build.
- CDP is powerful for browser facts such as network, DOM snapshots, tracing,
  permissions, and screenshots, but it is too low-level and unstable to be the
  primary agent UI contract.
- Agent skill guidance favors concise `SKILL.md` files plus references/scripts.
  Keep architecture rationale here and keep the main skill focused on the
  workflow and contracts an agent must follow.

## Harness Design Takeaways

- First-party app control: add route/component capability ids, stable
  `data-testid` values, accessible names, serializable state, and explicit
  `observe.*`/`act.*` support before writing browser scripts.
- Third-party fallback: build temporary semantic trees from accessibility,
  visible text, bounds, and editable state; normalize Playwright/CDP/MCP output
  into the same run/window artifacts.
- Multi-agent testing: allocate one run with many window/lease assignments,
  open visible isolated browser profiles per window when needed, record/list
  launch state, wait for each frontend WebSocket registration, then dispatch
  bounded work by feature, route, fixture, and control permission; close browser
  profiles during release/cleanup.
- Debuggability: every command result should have before/after observations,
  settlement evidence, logs/network deltas, virtual cursor trace, and artifact
  paths.
- Stability: selectors are implementation details; capability ids, durable
  domain ids, and explicit state contracts are the real agent API.
