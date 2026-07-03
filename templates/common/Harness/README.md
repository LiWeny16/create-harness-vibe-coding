# create-harness-vibe-coding - Harness Router

Purpose: route humans and agents to the smallest useful context. `Harness/README.md` is the primary router.

Default load: `CLAUDE.md`, `Harness/MEMORY.md`, this file, and `Harness/PROGRESS.md` when work is active. Do not read the whole `Harness/` tree.

## 0-1 Flow

```text
Idea -> Research -> Mini PRD -> Acceptance Criteria -> Contracts -> Tests -> Build -> Independent Validation -> Debug -> Memory
```

For the full phase contract, load [lifecycle.md](lifecycle.md).

## Development Contract

- This file is a router, not a full spec.
- If the task does not clearly match a row below, search by keywords before loading more docs.
- project files are the only durable communication channel; chat/subagent transcript state is non-authoritative.
- Important assumptions, decisions, blockers, evidence, and handoffs must be written to the current task's `tasks/<id>/PROGRESS.md` and `tasks/<id>/PLAN.md`, the current feature doc, `Harness/MEMORY.md`, or `Harness/memory/*` as appropriate.
- Task records are compact by default: PLAN holds goal, decisions, scope, risks; PROGRESS holds status/next, changes, verification. Do not paste command logs, full transcripts, or broad PRDs when a link or one-line evidence entry is enough.
- Build commands, git conventions, and release notes belong in root `README.md`, not `CLAUDE.md`.
- README rewrites are optional project-doc work. Use `wf-readme` and preserve existing public docs unless the user approves a broader restructure.
- Code architecture belongs in [architecture.md](architecture.md) or the current feature doc, not `CLAUDE.md`.
- Core rules live in `CLAUDE.md` and `.claude/rules/ecc/common.md`.
- WF mode rules live in [WF.md](WF.md).
- Phase rules live in [lifecycle.md](lifecycle.md).
- Build, review, test, and subagent rules live in [agent-workflow.md](agent-workflow.md); AC-linked TDD rules live in [TDD-GUIDE.md](TDD-GUIDE.md).
- Acceptance-driven gates live in [ACCEPTANCE_PROTOCOL.md](ACCEPTANCE_PROTOCOL.md). PRD-derived Acceptance Criteria are the source of truth for implementation, tests, review, validation, debug, and memory.
- Role/context isolation rules live in [AGENT_ISOLATION.md](AGENT_ISOLATION.md).
- Frontend-backend test harness and CDP/network evidence rules live in [HARNESS_BRIDGE.md](HARNESS_BRIDGE.md).
- Parallel dispatch rules live in [dispatch.md](dispatch.md).
- Subagent orchestration methodology lives in [subagents.md](subagents.md).
- Extension rules live in [extension.md](extension.md).
- Context-loading rules live in [context-loading.md](context-loading.md).
- Progress lives in `Harness/PROGRESS.md`, `Harness/tasks/<task-id>/PROGRESS.md`, `Harness/tasks/<task-id>/PLAN.md`, and the current feature doc.

## Keyword Routing

Use this only when the task is ambiguous or the matching row is unclear.

1. Extract 2-5 concrete keywords from the user request.
2. Search the project docs first:

```bash
rg -n "keyword1|keyword2|keyword3" CLAUDE.md README.md Harness
```

3. Load only the top matching doc or the smallest matching doc pair.
4. If keyword search conflicts with the table below, follow the table and record the assumption in `Harness/tasks/<task-id>/PROGRESS.md`.

Keywords are retrieval hints, not project facts.

## Load By Task

Load the matching row only. Add adjacent docs only when the loaded doc directly names them.

Routing priority: if a request explicitly says `/wf <task>`, `$wf`, `wf mode`, `workflow mode`, or `wk mode`, or is long, difficult, uncertain, repeated-failure, migration, architecture-heavy, browser-visible, or broad multi-agent implementation work, choose the WF row first. Load `Harness/WF.md` directly, then delegate subagent coordination to `subagent-orchestrator`. If the request says `/wf-auto`, `$wf-auto`, `wf auto`, or `auto mode`, choose the WF-AUTO row and load `Harness/WF-AUTO.md`.

| When to Read | Keywords | Load | Output |
| --- | --- | --- | --- |
| Raw idea or vague product request | idea, vague, clarify, goal, non-goal, lifecycle | [lifecycle.md](lifecycle.md), [research/PRD.md](research/PRD.md) | clarified goal, non-goals, first questions |
| Need market/tech direction | research, market, competitor, stack, library, pricing, policy | [research/README.md](research/README.md), [research/research-results.md](research/research-results.md) | research protocol, adopted/rejected choices |
| Need MVP/spec | PRD, MVP, scope, requirement, acceptance, non-goal | [research/PRD.md](research/PRD.md), [ACCEPTANCE_PROTOCOL.md](ACCEPTANCE_PROTOCOL.md) | Mini PRD with AC IDs and verifiable acceptance criteria |
| Need architecture or boundaries | architecture, boundary, layer, port, adapter, dependency | [architecture.md](architecture.md) | layer map, ports, constraints |
| Need WF command help | /wf-help, wf help, command list, list wf commands | `.claude/commands/wf-help.md` | direct command table; no skill invocation |
| Need WF mode | wf, /wf, $wf, wf mode, workflow mode, wk mode, long task, difficult, stuck, repeated failure | [WF.md](WF.md), [PROGRESS.md](PROGRESS.md), the current task `tasks/<id>/PROGRESS.md` and `tasks/<id>/PLAN.md` | complete role chain, heartbeat, recovery loop; explicit WF/WK loads subagent docs immediately |
| Need perpetual auto-optimization | /wf-auto, $wf-auto, wf auto, auto mode, never stop, self-improve, continuous optimize | [WF-AUTO.md](WF-AUTO.md), [subagents.md](subagents.md), [dispatch.md](dispatch.md) | perpetual loop, bounded ticks, optional wf-auto-only hook exception, 8-angle scan, spark search, intent checkpoint, evidence ledger; CEO never writes code |
| Need perpetual inspiration mode | /wf-auto-spark, $wf-auto-spark, wf auto spark, spark mode, external inspiration, discover mode, never stop | [WF-AUTO-SPARK.md](WF-AUTO-SPARK.md), [WF-AUTO.md](WF-AUTO.md), [subagents.md](subagents.md), [dispatch.md](dispatch.md) | roadmap-anchored: North Star + milestones; external spark search; <=50% deviation guard; never auto-stops |
| Need WF-MAX mode | /wf-max, $wf-max, wf max, maximum parallelism, CEO, Manager, Worker, fan-out | [WF-MAX.md](WF-MAX.md), [subagents.md](subagents.md), [dispatch.md](dispatch.md) | WF strict superset: complete role chain plus maximum fan-out, current runtime subagents first, cross-CLI overflow when available |
| Need peer review | /wf-review, $wf-review, peer review, second opinion, cross-check, stuck | `.claude/skills/wf-review/SKILL.md`, `.agents/skills/wf-review/SKILL.md`, `Harness/README.md` | cross-model multi-dimension review with severity classification |
| Adding harness to existing project | existing project, onboarding, migrate, bootstrap, preserve, conflict | [extension.md](extension.md), [PROGRESS.md](PROGRESS.md), root `README.md` and package/CI files | discovered project facts, preserved config, manual registration plan |
| README optimization | README, docs, quickstart, install docs, architecture diagram, command table, documentation polish | root `README.md`, `.claude/skills/wf-readme/SKILL.md`, [PROGRESS.md](PROGRESS.md), [architecture.md](architecture.md) as needed | approved README mode, preserved sections, proposed diff plan |
| Need implementation plan | plan, task, write set, verify, milestone, progress | [PROGRESS.md](PROGRESS.md), the current task `tasks/<id>/PROGRESS.md` and `tasks/<id>/PLAN.md`, [agent-workflow.md](agent-workflow.md), [ACCEPTANCE_PROTOCOL.md](ACCEPTANCE_PROTOCOL.md) | tasks, AC IDs, write set, verification commands |
| Optional workflow installed | workflow, optional, ui-ux-review, github-pr-review, python-backend, ts-react-frontend | matching `workflows/*.md` (if installed), [extension.md](extension.md) | workflow-specific evidence, commands, fallback path |
| Need durable memory or reflection | memory, remember, preference, correction, tool failure, lesson, reflection, scenario memory | [MEMORY.md](MEMORY.md), [MEMORY_PROTOCOL.md](MEMORY_PROTOCOL.md), `Harness/memory/tool-usage-reflections.md`, `Harness/memory/user-corrections-preferences.md`, `Harness/memory/agent-lessons-patterns.md` | concise newest-first memory entry, scenario memory hint, or no-op rationale |
| Need subagents | subagent, role pack, context, inject, return format, orchestrator, isolation | [subagents.md](subagents.md), [context-loading.md](context-loading.md), [dispatch.md](dispatch.md), [AGENT_ISOLATION.md](AGENT_ISOLATION.md) | controller plan, role-specific context pack, isolation-aware dispatch pack |
| Need feature work | feature, implementation, TDD, test, review, closeout | [tasks/_template/PLAN.md](tasks/_template/PLAN.md), [agent-workflow.md](agent-workflow.md), [TDD-GUIDE.md](TDD-GUIDE.md), [ACCEPTANCE_PROTOCOL.md](ACCEPTANCE_PROTOCOL.md) | task plan, AC-linked RED tests, implementation loop |
| Review or release check | review, release, finding, risk, evidence, verification | [agent-workflow.md](agent-workflow.md), current feature doc | findings, verification evidence |
| Harness readiness check | validate, readiness, placeholder, missing file, release gate | `Harness/scripts/validate-harness.mjs`, `Harness/scripts/validate-harness.mjs --strict` | structural install check; strict bootstrap/release placeholder check |
| Need harness update | /wf-update, $wf-update, update, check for updates, harness version | `.claude/skills/wf-update/SKILL.md`, `.agents/skills/wf-update/SKILL.md`, `Harness/.harness-version`, `Harness/scripts/wf-update-check.mjs` | script-driven comparison, SAFE/CONFLICT/PRESERVE classification, user decides conflicts |
| Need harness removal | /wf-remove, $wf-remove, wf remove, remove harness, uninstall harness | `.claude/skills/wf-remove/SKILL.md`, `.agents/skills/wf-remove/SKILL.md`, `Harness/scripts/wf-remove.mjs` | safe removal plan: auto-remove SAFE, confirm MODIFIED, never touch USER DATA |

## Gates

- Move phases in order unless the user asks for a fast lane.
- Use `/wf <task>` in Claude Code, `$wf` in Codex, `/wf-max [task]` or `$wf-max`, `wf mode`, `workflow mode`, or `wk mode` when a task is long, difficult, uncertain, multi-file, or repeatedly failing.
- Use `/wf-auto` for perpetual self-directed optimization that never stops until 8-angle exhaustion.
- **WF-MAX Role Contract**: Three-layer architecture: global mode (`wf-max`), agent role (`ceo|manager|worker|verifier|reviewer|reflector`), dispatch permission (`writeSet`, `forbidden`, `verification`). CEO never writes source code. Workers edit only dispatch.writeSet. Compliance is checked through dispatch packets, independent review, validation evidence, and task capsules. See `CLAUDE.md#1a`.
- **WF-REVIEW Anti-Self-Review**: Must invoke the OTHER CLI (Codex -> Claude, or Claude -> Codex). Same-model simulation is forbidden.
- WF-MAX has no runtime hook state. The durable state is the task capsule, dispatch table, review findings, and validation evidence. The only runtime hook exception in Harness is the optional `/wf-auto` bounded tick hook described in `WF-AUTO.md`.
- Do not code before PRD-GATE, AC-GATE, CONTRACT-GATE, and TEST-GATE are satisfied or explicitly compressed into a documented fast lane.
- PRD-derived Acceptance Criteria are the source of truth. Code, tests, reviews, validation, debug, and memory must trace to AC IDs.
- No acceptance criteria, no tests. No acceptance criteria, no code.
- No `data-testid` or stable accessible selector, no UI acceptance. No API contract, no backend integration acceptance.
- Unsure whether to open a task? Read [agent-workflow.md](agent-workflow.md) Section 1.
- Do not spawn a subagent without a role, read boundary, write boundary, and return contract.
- Do not run writing agents in parallel unless write sets are disjoint.
- Before coordinating multiple agents, fill `Harness/tasks/<task-id>/PLAN.md#Subagent Dispatch` and follow `subagents.md` plus `dispatch.md`; if the work also matches WF triggers, enter WF mode first.
- In WF mode, update `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` before long commands, after failures, and at closeout.
- In WF Max mode, never dispatch two implementers with overlapping file claims. Verify disjointness before each wave.
- In WF Max mode, D-GATE (Dispatch Table + Self-Audit Checklist) is mandatory before W2 implementation dispatch.
- Do not add stack-specific agents or skills without following `extension.md`.
- Do not close work without tests or recorded manual verification.
- Do not mark work `Verified` until evidence is recorded, cross-review has passed, and reflector verdict is PASS.
- Run `node Harness/scripts/validate-harness.mjs` for install-complete scaffold structure; run `node Harness/scripts/validate-harness.mjs --strict` only after bootstrap resolves project-fact placeholders and before release.
- If a doc still has `{{...}}`, treat that section as a template, not project fact.

## Doc Map

| Category | Files |
|----------|-------|
| **Router + Index** | `README.md`, `MEMORY.md`, `PROGRESS.md` |
| **Task Capsule** | `tasks/<id>/PROGRESS.md`, `tasks/<id>/PLAN.md`, `tasks/_template/` |
| **Workflows** | `WF.md`, `WF-MAX.md`, `WF-AUTO.md`, `WF-AUTO-SPARK.md` |
| **Protocols** | `ACCEPTANCE_PROTOCOL.md`, `AGENT_ISOLATION.md`, `HARNESS_BRIDGE.md`, `DEBUG_PROTOCOL.md`, `MEMORY_PROTOCOL.md` |
| **Guides** | `ECC-GUIDE.md`, `TDD-GUIDE.md`, `lifecycle.md`, `architecture.md` |
| **Orchestration** | `subagents.md`, `context-loading.md`, `dispatch.md`, `agent-workflow.md`, `extension.md` |
| **Research** | `research/README.md`, `research/PRD.md`, `research/research-results.md` |
| **Acceptance Templates** | `templates/PRD.template.md`, `templates/ACCEPTANCE.template.md`, `templates/UI_CONTRACT.template.md`, `templates/API_CONTRACT.template.md`, `templates/TEST_PLAN.template.md`, `templates/PLAYWRIGHT_SPEC.template.ts`, `templates/VALIDATION_REPORT.template.md` |
| **Memory** | `memory/tool-usage-reflections.md`, `memory/user-corrections-preferences.md`, `memory/agent-lessons-patterns.md` |
| **Scripts** | `scripts/validate-harness.mjs`, `scripts/wf-update-check.mjs`, `scripts/wf-remove.mjs` |
| **Runtime** | `.harness-version` |
| **Agents + Skills** | `.claude/agents/*`, `.claude/skills/*`, `.agents/skills/*` |
| **Direct Commands** | `.claude/commands/wf-help.md` |

## Direct Commands

| Command | Purpose |
|---|---|
| `/wf-help` | Directly returns a table of all Harness WF commands, usage, and purpose. It does not invoke a skill or start a workflow. |

## Skill Commands

| Claude Code | Codex | Purpose |
|---|---|---|
| `/wf <task>` | `$wf <task>` | Complete role chain: plan, research/docs, architecture, test, implement, validation, cross-review, reflector, acceptance |
| `/wf-max [task]` | `$wf-max [task]` | WF strict superset with maximum parallelism: CEO -> Manager -> Worker, cross-CLI overflow |
| `/wf-auto` | `$wf-auto` | Perpetual auto-optimization: never stops until 8-angle exhaustion |
| `/wf-auto-spark` | `$wf-auto-spark` | Perpetual inspiration: spark search, roadmap-anchored, <=50% deviation guard, never auto-stops |
| `/wf-review [focus]` | `$wf-review [focus]` | Cross-model peer review via Codex <-> Claude |
| `/wf-learn` | `$wf-learn` | Force learning cycle: context-master -> memory-master |
| `/wf-readme [task]` | `$wf-readme [task]` | README preservation, merge, and documentation improvement workflow |
| `/wf-update` | `$wf-update` | Script-driven harness update: fetch + compare + apply |
| `/wf-remove` | `$wf-remove` | Safe harness removal: auto-delete SAFE, confirm MODIFIED, preserve USER DATA |
