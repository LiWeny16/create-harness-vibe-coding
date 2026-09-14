# B1 fresh-execution preparation (read-only)

Date: 2026-09-09 (Asia/Shanghai)

## Agent / probe contract

Agent: Luna release-prep worker
Probe: package bin, candidate CLI help, README install policy, and source argument parsing
Mode: read-only preparation; no project creation, provider start, install, or global-config mutation
Files examined: package.json; bin/create-harness-vibe-coding.js; src/index.js; README.md; .agents/skills/wf-agents-docs/SKILL.md
Verdict: PASS (preparation only; not a business benchmark result)

## Observed package and help

`package.json` declares name `create-harness-vibe-coding`, version `0.9.2`,
Node engine `>=18`, and the sole bin target
`bin/create-harness-vibe-coding.js`. That bin is a thin node launcher importing
`src/index.js`.

`node bin/create-harness-vibe-coding.js --help` exited 0. The real help shows:

    npx create-harness-vibe-coding@latest [project-name] [target-dir] [flags]
    create-harness-vibe-coding init [target-dir] [flags]
    -y, --yes
    --dry-run
    --on-conflict <policy>
    --install-scope <scope>      project or global
    --global-dir <dir>
    --host-global-dir <dir>
    --json

The machine has no `node_modules/.bin/create-harness-vibe-coding` and no
`create-harness-vibe-coding` on PATH. Neither a global command nor a provider
was invoked.

## Project-scope install contract

For a new or existing project, the source-backed non-interactive command is:

    npx create-harness-vibe-coding@latest <project-name> <target-dir> -y --install-scope project --on-conflict skip --json

`--install-scope project` explicitly wins over the documented default scope.
`-y/--yes` disables prompts and `--json` selects machine output. The target is
the second positional; there is no `--target` flag in help or parser. `skip`
preserves existing fixture-owned files, subject to inspecting the JSON result.

For an exact packed candidate, record (do not run in this prep):

    npm pack --pack-destination <pack-dir>
    npm install --prefix <isolated-cli-dir> <pack-dir>\create-harness-vibe-coding-0.9.2.tgz
    & <isolated-cli-dir>\node_modules\.bin\create-harness-vibe-coding.cmd <project-name> <target-dir> -y --install-scope project --on-conflict skip --json

`npm pack --dry-run --json` was the only pack inspection run. It exited 0 and
reported candidate id `create-harness-vibe-coding@0.9.2`, filename
`create-harness-vibe-coding-0.9.2.tgz`, and 714 payload files; no tarball was
created. Future pack/install directories must be outside the repo and global
Harness locations.

## `init` boundary

`init` is not the fresh scaffold command; it binds an existing project to the
global runtime. Source parsing at `src/index.js:771-801` accepts a target
positional, `--scope project|global`, `--dry-run`, `--json`, `--on-conflict`,
and global-dir options. Top-level help does not document `init --scope`; the
source-verified form is:

    <installed-cli> init <target-dir> --scope project --dry-run --json

No init command was executed, even in dry-run, because the development root is
dirty and is not a fresh business fixture.

## Later fresh-run boundary

Allowed future execution parent:

    D:\HarnessBenchmarks\harness-092-20260909-SGWTir\future-executions

The evaluator must build/pack from the exact approved SHA, install into a new
child there, set an explicit cwd, and load the installed project's
`AGENTS.md`, `CLAUDE.md`, and skills. Do not use `--ignore-rules`, the current
development conversation, or the current global Harness as a fresh substitute.
Remove inherited `HARNESS_*` control-plane/session/node identity variables
without printing credentials or inventing identity. Do not blindly use
`--ignore-user-config` if it removes the verified provider/model route; retain
only explicitly approved non-secret provider configuration.

Short stdin handoff (described only; no prompt file created):

    Work only inside this newly created project. Read and follow the installed AGENTS.md and CLAUDE.md and project Harness rules. Complete the bounded task, keep writes inside project scope, run requested checks, and report exact changed paths and exit codes. Do not disable rules, resume another session, or claim success without observable verification.

## Commands / exits

    node bin/create-harness-vibe-coding.js --help  exit 0
    npm pack --dry-run --json                      exit 0
    Get-Command create-harness-vibe-coding        not found (not invoked)
    Test-Path node_modules/.bin/create-harness-vibe-coding  False

Findings: none blocking preparation. Next: await ownership/candidate approval,
then use an exact-SHA pack in isolation before installing or executing a fresh
Luna process.

## Fresh Codex invocation boundary (help/config only)

The installed local Codex is `codex-cli 0.153.4`. Its real help was read with
no model turn. `codex exec --help` confirms `--model`, `--config/-c`,
`--sandbox {read-only,workspace-write,danger-full-access}`, `--cd`,
`--skip-git-repo-check`, `--ephemeral`, `--json`, and `--ignore-user-config`.
The top-level help confirms `-a/--ask-for-approval` with values `on-request` or
`never`, and top-level `--search` for native web search.

Argument placement was checked without starting a provider:

```text
codex -a never exec --help                         exit 0
codex exec -a never --help                         exit 2 (unexpected argument)
codex --search exec --help                         exit 0
codex exec --search --help                         exit 2 (unexpected argument)
codex exec --strict-config -c 'approval_policy="never"' --help  exit 0
codex exec --strict-config -c model_reasoning_effort=xhigh --help exit 0
```

Therefore the explicit no-approval shape for a fresh execution is
`codex -a never exec ...`; do not append `-a` after `exec`, and do not use
`--approve-for-me` or `--dangerously-bypass-approvals-and-sandbox`. The
config-override form is also parser-accepted, but the top-level `-a never`
form is the directly observed approval switch. `--sandbox workspace-write`
is the Harness execution permission; the independent reviewer uses
`--sandbox read-only`.

Because a fresh project may have no Git repository, use the supported
`--skip-git-repo-check` exec flag in both comparable arms (or initialize Git
identically in both; do not mix the choices). `--ephemeral` only controls
session persistence and does not authorize dropping provider configuration.
Keep the same verified `CODEX_HOME`/provider/model route and non-secret config
fingerprint in both arms; do not add `--ignore-user-config` if it would lose
that route. Remove only inherited development `HARNESS_*` identity/control
variables and never print credentials.

The B5 official-source scenario may enable the native web tool with
`codex --search exec ...`; this flag is not accepted after `exec`. Give both
comparison arms the same model, effort, provider route, auth configuration,
sandbox, and search/tool setting for that scenario. Do not enable search for
simple arithmetic/B2 unless the frozen protocol explicitly requires it.

The later fresh Harness-arm command shape is thus (recorded only; not run):

```text
<public prompt> | codex -a never exec --ephemeral --skip-git-repo-check --cd <harness-arm-project> --model gpt-5.6-luna -c model_reasoning_effort=xhigh --sandbox workspace-write --json -
```

The no-Harness arm uses the identical shape, model, effort, route, auth,
sandbox, and prompt from its own project cwd. A read-only reviewer changes only
the cwd and `--sandbox read-only`; it remains a new `codex -a never exec`
process. These are startup-preparation facts, not benchmark results.
