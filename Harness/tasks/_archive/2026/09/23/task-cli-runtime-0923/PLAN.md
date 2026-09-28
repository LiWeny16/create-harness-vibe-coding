# task-cli-runtime-0923 - PLAN

## Mini PRD

- Goal: reduce Harness context weight by moving deterministic runtime work into a Rust CLI and making large UI/media capabilities optional extensions.
- Scope: define the Rust CLI distribution boundary, register `wf-ui` as an optional extension, consolidate research execution behind `wf-search`, and preserve Agent orchestration skills as thin controllers.
- Non-scope: rewriting the complete browser bridge or shipping platform binaries in this change; those remain follow-up release work after the contracts are stable.

## Acceptance Criteria

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | Core Agent skills are explicitly classified as controller, CLI-backed adapter, or optional extension capability. | command/extension registry and documentation checks | pending |
| AC-002 | `wf-ui` is not part of the default runtime and is installable through the extension lifecycle with a verified manifest. | extension registry, lock/install tests | pending |
| AC-003 | Search/video capabilities are represented as optional extensions and the base `wf-search` path does not require loading their skill bodies. | extension manifest and search routing tests | pending |
| AC-004 | Rust CLI distribution has a cross-platform package contract that uses pnpm for installation without requiring Rust on end-user machines. | package contract tests/docs and cargo check | pending |
| AC-005 | Existing root/template command, ownership, version, and mirror surfaces remain consistent after the migration. | validators, mirror checks, targeted tests | pending |

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | Rust is the deterministic runtime; skills remain Agent-facing controllers/adapters. | Keeps orchestration/context semantics in the host while reducing prompt weight. | 2026-09-23 |
| 2 | `wf-ui` is a downloaded optional extension, not a builtin capability. | UI/browser runtime is high-volume and not required by default. | 2026-09-23 |
| 3 | Media, video, ASR, VLM, and platform adapters are optional CLI extensions. | Avoids shipping or loading large toolchains for ordinary search. | 2026-09-23 |
| 4 | pnpm installs a platform-selected prebuilt Rust binary; `pnpm dlx` is bootstrap-only. | Avoids requiring Rust on end-user machines and prevents per-invocation network drift. | 2026-09-23 |

## Scope

- Write set: CLI/runtime contracts, extension registry/manifests, thin adapter docs/commands, targeted tests, root/template mirrors, task evidence.
- Forbidden: unrelated UI changes, destructive cleanup of pre-existing user files, changing user-owned dirty work outside the declared write set.

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Existing dirty work already touches search/UI/extension files. | Inspect before patching and preserve unrelated edits. | active |
| Rust binaries are not available for all targets locally. | Define package matrix and run local cargo checks; defer release builds to CI. | active |
| Extension registry and pnpm package metadata can drift. | Keep one manifest schema and add parity tests. | active |
