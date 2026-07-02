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

1. `Harness/TDD-GUIDE.md`
2. ECC stack-specific testing rules (e.g., `typescript/testing.md`, `python/testing.md`)
3. Current task `PLAN.md`

## Rules

1. **RED first**: Write failing test before ANY implementation code.
2. **GREEN minimal**: Write only enough code to pass the test.
3. **REFACTOR safe**: Improve code while keeping all tests green.
4. **Coverage gate**: ≥80% before marking task complete.
5. **Test names**: Describe behavior — `test('returns X when Y')`.
6. **AAA structure**: Arrange → Act → Assert.
7. **Error paths**: Test failure cases, not just happy path.
8. **WF-MAX**: Test Writer agent dispatched BEFORE Implementer in every wave.
