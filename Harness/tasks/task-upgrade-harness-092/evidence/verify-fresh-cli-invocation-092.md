# Fresh CLI invocation and project-path verification

Date: 2026-09-09  
Role: bounded read-only CLI verifier (Luna xhigh)

## Context-pack boundary

The requested command was run exactly from the development repository:

```text
node Harness/scripts/task-context.mjs pack task-upgrade-harness-092 --project . --role controller --budget-bytes 8192 --json
```

It exited `1` with the structured error `Project root must be an absolute
path`; no task state or other file was written. The same command with the
current absolute repository path exited `0`, producing the fresh controller
pack with `budget.limitBytes=8192`, `budget.usedBytes=7293`, and hash
`sha256:b7f6a3f28fcd4dd179a8072cc14632bff43bdc6070ca9339a2607ac8b3fde265`.
The pack was consumed only for this bounded verification; its body is not
copied into this report.

## Interpretation and minimal repair

This is an intentional safety contract at the implementation boundary, not a
path traversal bug. `Harness/scripts/lib/path-scope.mjs:scopedProject()`
rejects every non-absolute value before resolving it, then anchors lexical and
real-path containment checks; `task-context.mjs:projectInfo()` delegates to
that guard and its usage text explicitly says `<absolutePath>`. Requiring an
explicit project root prevents a caller's changing `cwd` from silently
selecting a different task store.

The compatibility defect is documentation/skill drift: several workflow
examples still show `--project .`, which fails against the intentional guard.
The release-safe minimal repair is to update those examples to
`--project <absolute-project-path>` (or an explicit caller-side absolute-path
resolution) while leaving `scopedProject()` and `task-context.mjs` security
behavior unchanged. The exact source/documentation targets found are:

```text
.agents/skills/wf/SKILL.md
.agents/skills/wf-max/SKILL.md
Harness/scripts/README.md
templates/common/Harness/scripts/README.md
Harness/specs/runtime/subagents.md
templates/common/Harness/specs/runtime/subagents.md
Harness/specs/workflows/WF.md
templates/common/Harness/specs/workflows/WF.md
Harness/specs/workflows/WF-AUTO.md
templates/common/Harness/specs/workflows/WF-AUTO.md
Harness/specs/workflows/WF-AUTO-SPARK.md
templates/common/Harness/specs/workflows/WF-AUTO-SPARK.md
Harness/specs/workflows/WF-MAX.md
templates/common/Harness/specs/workflows/WF-MAX.md
```

No implementation or documentation edit was made in this verifier task. An
alternative code change that resolves relative input inside `task-context.mjs`
would be a separate product decision because it weakens the explicit-path
boundary; it is not recommended as an unreviewed compatibility fix.

## Fresh Codex execution boundary

The existing read-only preparation evidence
[`benchmark-execution-prep-092.md`](benchmark-execution-prep-092.md) records
the installed `codex-cli 0.153.4` help/config checks without a model turn. The
supported fresh invocation shape is:

```text
<public prompt> | codex -a never exec --ephemeral --skip-git-repo-check --cd <project> --model gpt-5.6-luna -c model_reasoning_effort=xhigh --sandbox workspace-write --json -
```

The approval switch is top-level: `codex -a never exec ...`; putting `-a`
after `exec` is rejected. `--skip-git-repo-check`, `--ephemeral`, `--cd`,
`--model`, `-c`, `--sandbox`, and `--json` are exec options. The Harness arm
uses `--sandbox workspace-write`; an independent scoring/review process uses a
new `codex -a never exec ... --sandbox read-only` process over only frozen
artifacts and expected data. Both execution arms use the same model, effort,
provider route, auth/non-secret config fingerprint, prompt, and
`--skip-git-repo-check` policy. Do not add `--ignore-user-config` if it would
discard the verified provider/model route, and do not use approval/sandbox
bypass flags.

## B5 fairness boundary

For the B5 official-source scenario, place native web search before `exec`:

```text
<public prompt> | codex -a never --search exec --ephemeral --skip-git-repo-check --cd <project> --model gpt-5.6-luna -c model_reasoning_effort=xhigh --sandbox workspace-write --json -
```

Use the same `--search` setting, model/effort, provider/auth route, sandbox
permission, prompt, and Git-check policy for the Harness and no-Harness arms.
`codex exec --search ...` is not accepted. Keep `--search` off for B2/simple
arithmetic because the frozen protocol does not require network access. Record
the official source URL/title/version/license/date and adopt/adapt/reject
decision for B5; network lookup behavior and implementation success remain
separate measurements. The independent reviewer may use a read-only sandbox
and a fresh process, but must retain the same allowed provider/auth/model
identity when it evaluates the resulting artifacts.

## Status

Relative `--project .` is a deterministic documentation/entry mismatch against
an intentional absolute-path safety rule. Fresh role-pack consumption with an
absolute project path is GREEN. No model turn, network lookup, provider call,
source/test/config/STATE edit, Git mutation, or sealed-holdout read occurred.
