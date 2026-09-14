# Project-path documentation repair

Date: 2026-09-09  
Role: bounded docs implementer/verifier (Luna xhigh)

## Contract and RED

The existing implementation contract is intentionally absolute-path-only:
`Harness/scripts/lib/path-scope.mjs:scopedProject()` rejects a missing or
non-absolute root before lexical and real-path containment checks. Both
`task-context.mjs` and `memory-context.mjs` delegate to that guard. This is a
caller/project-boundary safety rule, not a reason to resolve `.` inside either
CLI.

The previously reproduced role-pack command was:

```text
node Harness/scripts/task-context.mjs pack task-upgrade-harness-092 --project . --role controller --budget-bytes 8192 --json
```

It exited `1` with `Project root must be an absolute path`. No task state was
written. The same pack command with the current repository's absolute path
exited `0`; the resulting controller pack reported `budget.limitBytes=8192`,
`budget.usedBytes=7293`, and hash
`sha256:b7f6a3f28fcd4dd179a8072cc14632bff43bdc6070ca9339a2607ac8b3fde265`.

## Minimal documentation repair

Only the bad documentation argument token was changed:

```text
--project .  ->  --project <absolutePath>
```

This applies to the `task-context.mjs` pack/show examples in the canonical
Harness README/specs and their template mirrors, plus the exact wf/wf-max
Claude/OpenCode command and skill mirrors. The same correction was applied to
the `memory-context.mjs` examples in wf-learn command/skill mirrors because
that CLI uses the same absolute `scopedProject` contract. Existing unrelated
dirty bytes in these files were preserved.

Canonical Harness docs and template mirrors changed:

```text
Harness/scripts/README.md
Harness/specs/runtime/subagents.md
Harness/specs/workflows/WF.md
Harness/specs/workflows/WF-MAX.md
Harness/specs/workflows/WF-AUTO.md
Harness/specs/workflows/WF-AUTO-SPARK.md
templates/common/Harness/scripts/README.md
templates/common/Harness/specs/runtime/subagents.md
templates/common/Harness/specs/workflows/WF.md
templates/common/Harness/specs/workflows/WF-MAX.md
templates/common/Harness/specs/workflows/WF-AUTO.md
templates/common/Harness/specs/workflows/WF-AUTO-SPARK.md
```

Skill mirrors changed:

```text
.agents/skills/wf/SKILL.md
.claude/skills/wf/SKILL.md
templates/common/.claude/skills/wf/SKILL.md
.agents/skills/wf-max/SKILL.md
.claude/skills/wf-max/SKILL.md
templates/common/.claude/skills/wf-max/SKILL.md
.agents/skills/wf-learn/SKILL.md
.claude/skills/wf-learn/SKILL.md
templates/common/.claude/skills/wf-learn/SKILL.md
```

Same-command surface mirrors changed only at the matching example line:

```text
.claude/commands/wf.md
.opencode/commands/wf.md
templates/common/.claude/commands/wf.md
templates/common/.opencode/commands/wf.md
.claude/commands/wf-max.md
.opencode/commands/wf-max.md
templates/common/.claude/commands/wf-max.md
templates/common/.opencode/commands/wf-max.md
.claude/commands/wf-learn.md
.opencode/commands/wf-learn.md
templates/common/.claude/commands/wf-learn.md
templates/common/.opencode/commands/wf-learn.md
```

No command classification, registry, implementation, test, STATE, user
configuration, benchmark, version, or Git file was changed by this repair.

## Verification

- Absolute pack command above: exit `0`; bounded pack values and hash match the
  RED-to-GREEN evidence.
- Canonical/template and command/skill scans contain no remaining
  `task-context.mjs` or `memory-context.mjs` example with `--project .`.
- Byte parity: all 18 checked canonical/template and Claude/OpenCode mirror
  pairs were `byteEqual=True` (including wf, wf-max, wf-learn skills and the
  six Harness docs).
- `node --test tests/anti-drift.test.js tests/context-budget.test.js
  tests/research-policy.test.js tests/task-context.test.js
  tests/memory-context.test.js tests/harness-intelligence-policy.test.js
  tests/wf-learn-contract.test.js`: exit `0`, 53/53 pass, 0 fail, 0 skip.
- `node --test tests/harness-intelligence-install.test.js
  tests/verify-context-memory-092.test.js`: exit `0`, 5/5 pass, 0 fail,
  0 skip.
- `node Harness/scripts/context-budget.mjs --json`: exit `0`; thin-startup
  15970/16000, wf-router-prefix 47864/50000, wf-light-prefix 64731/66500,
  cache-diagnostics-route 35702/36000 bytes.
- `git diff --check`: no whitespace errors; it emitted only the pre-existing
  CRLF-normalization warning for unrelated `.agents/skills/wf-update/SKILL.md`.

Remaining `--project .` occurrences are unrelated interfaces that intentionally
accept a relative project (for example `wf-ui-control`, `a2a-terminal`, and
`research-policy`), not task/memory context examples. The known external
mirror mismatch was not queried or changed. Full npm/version/build gates are
left to the release candidate runner.
