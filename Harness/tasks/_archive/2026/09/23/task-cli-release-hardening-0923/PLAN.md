# task-cli-release-hardening-0923 - PLAN

## Goal

当前 CLI 改造已完成核心架构迁移，但尚未达到可发布状态。需要补齐 Rust CLI 的跨平台预编译包与 pnpm 发布链路，接通 wf-ui 可选扩展的真实运行时，迁移仍依赖旧 wf-research、wf-search references 和旧 wf-ui 启动器的测试契约，处理 strict validator 的 Stop hook 与任务状态门禁，并最终通过完整 npm test、严格校验和打包验证。所有中文文档必须保持 UTF-8。

## Mini PRD

Bring the migrated Rust CLI and optional wf-ui extension to a verifiable release-ready state. Complete cross-platform prebuilt Rust packages and pnpm publishing integration, wire wf-ui to its real runtime, migrate stale tests for wf-research/wf-search references and the old wf-ui launcher, resolve strict-validator Stop-hook/task-state gates, then run the full test, strict-validation, and packaging checks. Preserve UTF-8 for all Chinese documentation.

Non-scope: publishing or pushing a release; broad unrelated refactors.

## Scope

Write set: package/release workflows and scripts, Rust CLI/package and wf-ui extension runtime integration, related tests/docs, only as required by acceptance criteria.

Forbidden: publish/deploy/push; modify task capsule files from the implementation agent; weaken/delete tests or strict gates merely to obtain green checks; rewrite unrelated Chinese documentation or change its encoding.

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | Use Qwen 3.8 27B as the only implementation model; cap execution at one Qwen-local agent at a time to avoid local provider stalls; queue other work until the active agent exits. Controller retains architecture, coordination, review, and final validation. | User explicitly assigned implementation to Qwen, later requested two additional Qwen workers, and asked to reduce controller polling. | 2026-09-23 |
| 2 | Do not publish or push; validate locally with repository-defined release checks. | User asks for release-chain hardening and packaging validation, not an actual release. | 2026-09-23 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | Rust CLI has cross-platform prebuilt package/release integration and pnpm package scripts/configuration consistent with repository-supported platforms. | `node scripts/wf-cli-release.mjs verify`; release contract 11/11; native release build; Windows-target `cargo check`; `npm pack --dry-run --json`. Six actual target builds remain a GitHub Actions release gate. | pass (structural integration verified) |
| AC-002 | Optional wf-ui extension invokes the real runtime; stale tests are migrated to current wf-research/wf-search references and launcher contracts without relaxing assertions. | Runtime/contract tests 6/6; wf-search install 27/27; media 7/7; research 15/15; full `npm test` 563 passed / 0 failed / 1 skipped. | pass |
| AC-003 | Strict validator's Stop-hook and task-state gates are correctly satisfied; full npm test, strict validator, and package dry-run succeed, and Chinese docs remain UTF-8. | Task-state strict and Harness strict pass; `npm pack --dry-run` reports 733 files; build-version check and `git diff --check` pass; UTF-8 scan checked 492 existing changed/untracked text files with no invalid UTF-8. | pass |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Actual six-platform CI builds were not executed locally; external workflow results are still required before release sign-off. | Matrix/configuration and local packaging verified; do not publish or claim release-ready until GitHub Actions produces the six target artifacts. | Open — external release gate |
| Broad package migration may uncover existing failures unrelated to this task. | Preserve failing evidence and make only scoped fixes. | Open |

## Subagent Dispatch

| Role | Objective | Mode | Read set | Write set | Forbidden | Dependencies | Evidence/return |
|------|-----------|------|----------|-----------|-----------|--------------|-----------------|
| Implementers (Qwen 3.8 27B; max one active local agent) | Implement disjoint AC-001..003 slices, run focused checks, and report exact changes/results. | Write, parallel only for disjoint write sets | Each worker receives its explicit read/write set and relevant AC | Only files listed for that work item | Task state/PLAN/PROGRESS; publish/push/deploy; another worker's files; unrelated files; weakening checks; Chinese doc encoding changes | Disjoint file ownership; controller integrates after completion | File list, root-cause summary, exact commands/results, package artifact evidence, blockers, remaining risks |
