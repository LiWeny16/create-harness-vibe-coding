# Benchmark evaluator preparation (B2 heldout sealed)

Date: 2026-09-09

Status: PREPARED ONLY. No provider turn, benchmark execution, score, install,
source change, scorer change, test change, task-state change, version change,
publish, stage, commit, or push was performed.

## Isolation and sealed artifact

The fresh evaluator root is outside the development repository and has a
private seal area separate from future execution areas:

```text
Root: D:\HarnessBenchmarks\harness-092-20260909-SGWTir
Private seal: D:\HarnessBenchmarks\harness-092-20260909-SGWTir\evaluation-private
Future runs: D:\HarnessBenchmarks\harness-092-20260909-SGWTir\future-executions
```

The B2 holdout is one sealed dataset with two evaluation modes. Its concrete
records and oracle are intentionally absent from this public evidence. The
sealed file is read-only and was validated as JSON:

```text
Path: D:\HarnessBenchmarks\harness-092-20260909-SGWTir\evaluation-private\BENCHMARK-HOLDOUT.json
SHA256: 549BD55D094E010D2E8C74DE34CF64F7167571EB509A7321BBD03F5DA6A11B97
Bytes: 626
SealedAt: 2026-09-09T13:57:06.893+08:00
Source: parent-model-design (pre-registered)
Filesystem: read-only
```

The evaluator must not expose that path or file to either fresh execution arm,
must not copy it into a fixture, and must not put its contents in an execution
prompt, execution log, public task evidence, or public run report. The later
independent reviewer is the sole model role permitted to read the sealed
expected values, through the evaluator's private read-only channel. The
evaluator owns any known-child cleanup under the new root only; the sealed file
is never deleted or rewritten.

`D:\`, `D:\HarnessBenchmarks`, and the fresh root's ancestors were checked for
`AGENTS.md` and `CLAUDE.md`; none were present. This avoids an unintended
project-instruction injection when a future evaluator starts below the new
root. The development repository and its task/A2A state are outside the
future evaluator read set.

## Three-role execution plan

The three roles have separate roots, permissions, rule-loading behavior, and
evidence ownership. All model arms use the same fixed model, effort, provider
route, auth configuration, public fixture, and prompt; only the presence of the
installed Harness is changed for the baseline.

### 1. Harness execution arm

```text
cwd: D:\HarnessBenchmarks\harness-092-20260909-SGWTir\future-executions\<run-id>\harness-arm\project
```

Install the exact candidate into that fresh project and run one completely new
process:

```text
<UTF-8 public B2 business prompt> |
  codex exec --ephemeral \
    --cd <harness-arm-project> \
    --model gpt-5.6-luna \
    -c model_reasoning_effort=xhigh \
    --sandbox workspace-write --json -
```

The arm may read the installed candidate Harness, its installed
`AGENTS.md`/`CLAUDE.md`/skills, and its own fixture. It may write only that
fresh project and its run evidence. It must not read the development
repository, this private seal, the benchmark scorer, or another role's root.
Do not pass `--ignore-rules`: installed Harness instructions must actually
load. Do not pass `--ignore-user-config` by default: preserve the exact
necessary provider/auth/model-routing configuration, with only a redacted
configuration fingerprint recorded. Do not print auth, URL, token, or key
values. Do not use `--oss` or either dangerously-bypassed mode.

### 2. Same-condition no-Harness baseline

```text
cwd: D:\HarnessBenchmarks\harness-092-20260909-SGWTir\future-executions\<run-id>\no-harness-baseline\project
```

Use the same command, public fixture, public prompt, model, effort, provider
route, auth configuration, sandbox, and fresh-process policy as the Harness
arm. The baseline project must contain no Harness installation or Harness
`AGENTS.md`/`CLAUDE.md`/skills. Do not pass `--ignore-rules`; with the clean
root this preserves the same global-rule/config condition without suppressing
anything from the Harness arm. It may read/write only its own fresh project
and evidence, never the private seal, candidate Harness, or development repo.

Both arms pipe the prompt through stdin (prompt argument `-`) and never create
a prompt scratch file. Neither arm uses `resume`, `--continue`, a session ID,
or a different model/effort. The controller must explicitly inventory and
remove only development-repo/task/A2A environment overrides; it must preserve
the same required `CODEX_HOME`/provider authentication and model-routing
configuration for both arms. The inventory and resulting non-sensitive
configuration fingerprint are evidence; secrets are not.

### 3. Read-only evaluator and independent Luna review

```text
cwd: D:\HarnessBenchmarks\harness-092-20260909-SGWTir\future-executions\<run-id>\evaluator
```

This role has two ordered sub-stages. First, a deterministic oracle process
(no model, provider, or auth) reads the sealed holdout and exact
candidate/baseline artifacts, validates the two raw CLI outputs, hashes/counts
the produced files, and writes only an oracle report beneath this evaluator
directory. It must not read the development repository, task/A2A state, user
state, or either execution agent's private prompt/context.

After the deterministic gate, a distinct fresh Luna reviewer process performs
the independent qualitative score. Its isolated review cwd is a child of the
evaluator directory and it may read only the frozen public schema, the oracle
report, the candidate/baseline artifacts, and the sealed expected values. It
must not read development source, benchmark scorer implementation, old chat,
task/A2A/user state, or execution-private prompts. It may write only its review
report; it must not modify business artifacts, fixtures, the oracle, or sealed
expectations. This reviewer is not the prep author and is not the author of
the B3 scorer under review. Its public review report must not copy raw sealed
records or oracle values.

The reviewer uses the same allowed provider/auth/model-routing configuration as
the two execution arms, but a new process and read-only sandbox (read-only
does not mean provider-free):

```text
<review-only prompt from the evaluator's private channel> |
  codex exec --ephemeral \
    --cd <fresh-reviewer-root> \
    --model gpt-5.6-luna \
    -c model_reasoning_effort=xhigh \
    --sandbox read-only --json -
```

Do not pass `--ignore-user-config` unless an equivalent non-sensitive provider
configuration has been independently validated; preserve the same necessary
auth/provider route and record only a redacted configuration fingerprint. The
reviewer may use `--ignore-rules` only because its isolated cwd is a
read-only evaluator boundary and it must not load development/project rules;
this exception does not apply to the Harness execution arm. The reviewer
never exposes the private seal to either execution arm and never runs a
provider turn outside the explicitly approved scoring phase. The deterministic
oracle stage remains provider-free; the independent Luna review is the only
later model-scoring stage.

## CLI and model/config evidence

The installed help for `codex exec` was read locally from `codex-cli 0.153.4`.
It confirms stdin via an omitted prompt or `-`, `--model <MODEL>`,
`--sandbox {read-only,workspace-write,danger-full-access}`, `--json` JSONL,
`--ephemeral`, `--cd`, `--ignore-user-config`, and `--ignore-rules`. There is
no dedicated `--effort` option. The generic `-c <key=value>` surface is the
only effort selector exposed by this help; a no-turn
`--strict-config -c model_reasoning_effort=xhigh --help` probe completed
without a config rejection. Generic `-c` acceptance is not itself proof that
the requested model/effort is available. The reviewer therefore retains the
same real provider/model configuration rather than treating read-only sandbox
as a substitute for provider validation.

Existing task evidence
[`effort-compatibility-design-092.md`](effort-compatibility-design-092.md)
records a local authoritative Codex model/list result for the fixed
`gpt-5.6-luna`/`xhigh` pairing. That is not a provider-inference or launch
proof: before either model arm starts, the controller must perform a no-turn,
read-only validation under the exact preserved auth/provider configuration.
If omitting `--ignore-user-config` changes routing, or the exact launch config
cannot validate the pairing, stop and report `UNVERIFIED`; do not silently
switch provider, model, or effort.

The controller must preserve raw JSONL stdout separately from each agent's
workspace and parse only fields actually emitted. Record terminal status and,
for both fresh Luna execution arms and the independent reviewer when present,
`turn.completed.usage` fields including
`cached_input_tokens`. Missing provider token/cost telemetry is `unknown`; do
not infer provider usage or cost from bytes, wall time, context-pack size, or
CLI events that omit usage.

## Fresh-run controls

Before accepting a result, the evaluator must record the exact candidate SHA
and package hash, fresh install root, sentinel preservation, command and
flags, model/effort/permissions, start/end times, retries/rework/recovery,
produced files, terminal failure state, and raw evidence paths. B2 is one
dataset evaluated in two CLI modes, not two model trials. Keep the no-flag
behavior as the control while exercising the opt-in flag, and do not disclose
the sealed oracle to the executing agent. One run is a smoke result unless the
controller explicitly completes the full benchmark protocol; no single run may
be described as SOTA or world-leading.

The public schema and benchmark README require evidence-based reporting with
separate `estimated` and `providerMeasured` fields, an explicit baseline
status, and mechanical category evidence. This preparation does not create a
run report and makes no benchmark PASS claim.
