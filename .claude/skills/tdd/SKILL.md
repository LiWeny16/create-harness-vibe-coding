---
name: tdd
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.
---

# TDD Adapter

Thin tool adapter. Authoritative guide: `Harness/TDD-GUIDE.md`.

## Invocation

- Claude Code: use `/tdd` or select the `tdd` skill.
- Codex CLI or IDE: use `$tdd` or `/skills` then choose `tdd`.

## Load

1. `Harness/ACCEPTANCE_PROTOCOL.md`
2. `Harness/HARNESS_BRIDGE.md`
3. `Harness/AGENT_ISOLATION.md`
4. `Harness/TDD-GUIDE.md`
5. ECC stack-specific testing rules (for example `typescript/testing.md`, `python/testing.md`)
6. Current task `PLAN.md`

## Rules

1. **AC first**: Tests are derived from PRD acceptance criteria and must reference AC IDs.
2. **RED first**: Write failing tests before ANY implementation code.
3. **UI means real user path**: Browser-visible behavior requires Playwright/CDP or documented real-browser clicks, typing, navigation, and visible assertions.
4. **No syntax-only acceptance**: Typecheck, lint, build, import tests, shallow renders, and snapshots cannot satisfy browser-visible ACs by themselves.
5. **Network-aware**: Frontend-backend ACs require URL, method, payload, response, and duplicate-request assertions when applicable.
6. **GREEN minimal**: Write only enough implementation to pass the AC-linked tests.
7. **REFACTOR safe**: Improve code while keeping all tests green.
8. **Coverage gate**: Meet the configured project coverage threshold before marking task complete.
9. **AAA structure**: Arrange -> Act -> Assert.
10. **Role isolation**: Test Writer must not reverse-engineer tests from implementation code. Implementer must not modify PRD, AC, UI contract, or API contract except through Change Request.
11. **Evidence required**: Record RED, GREEN, full-check output, and for UI flows screenshot/trace/video/log evidence plus an AC-by-AC result matrix.
12. **WF-MAX**: Acceptance/Test Writer wave completes before any Implementer wave starts.
