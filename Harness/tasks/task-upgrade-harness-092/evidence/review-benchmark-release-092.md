# Independent benchmark and pre-release review (2026-09-09)

Reviewer: Luna xhigh, independent of the benchmark runner/author. Scope is
scorer fairness, provenance/evidence strength, and a read-only release-path
check. No real post-release benchmark was executed and no release, install,
publish, branch, task-state, or production-source mutation was performed.

## Verdict

The benchmark remains blocked. The independent review produced three RED/HIGH
findings in the mechanical oracle. The B2 public fixture is fair (GREEN). The
existing author-side `7/7` test result and `--self-check` are preparation only;
they are not fresh-agent benchmark evidence.

The RED review command was:

```text
node --test tests/harness-intelligence-bench-review.test.js
```

Observed result: 4 tests, 1 pass (B2 prompt/baseline check), 3 failures
(B3/B4/B6). The failures are deliberate acceptance assertions showing that the
current oracle accepts or rejects the wrong evidence shape.

## Findings

### HIGH-1 — B3 does not bind the retry ACK/RESULT to the current attempt

`checkB3` only checks that some event has `replyTo` matching any request and
that there are terminal events (`scripts/harness-intelligence-bench.mjs:324-342`).
It does not join request, ACK, failure, retry, and RESULT by the current
`requestId`/attempt. The RED fixture has request/ACK/cancel for attempt 1, then
a retry request for attempt 2 whose failed and successful RESULT both reply to
the cancelled attempt 1; the oracle still returns `B3: pass`.

This violates the frozen B3 requirement for request/ACK/RESULT correlation,
explicit cancellation/failure/retry, and current-attempt binding. It can turn a
stale or forged terminal result into a successful category. Runtime identity
(Codex -> Claude) remains a separate manual-review question as the benchmark
README correctly states; a log containing the words `codex` and `claude` is not
proof of an actual cross-runtime execution.

Minimal repair claim (not applied in this reviewer write set): validate an
attempt/request graph. Each ACK, failure, cancellation, and RESULT must carry
the same dispatch identity and current request/attempt identity; the retry must
have its own ACK and terminal RESULT, and no terminal RESULT may bind to a
cancelled prior request. Preserve manual review for actual runtime identity.

### HIGH-2 — B4 whole-document byte equality conflicts with append-only audit

`checkB4` requires the entire before/restored evidence files to have identical
SHA-256 bytes (`scripts/harness-intelligence-bench.mjs:390`). A valid restore can
restore the effective rule projection (same rule id/scope/status) while
appending counterexample, supersede/disable, restore, and feedback audit events.
The RED fixture proves this state is semantically restored and the audit is
preserved, but the oracle returns `RESTORE_MISMATCH`.

This creates pressure to delete the very history the task contract says must be
recoverable. The benchmark README calls the check “state bytes” but the
non-destructive requirement needs effective-rule-state recovery plus retained
raw history, not destructive rollback of the whole memory document.

Minimal repair claim (not applied): compare a documented canonical projection
of the taught rule's effective state, and independently require that raw audit
logs remain present and append-only. Do not ask a script to prove semantic
learning quality; retain that as an explicit manual-review responsibility.

### HIGH-3 — B6 accepts a signature-only fake screenshot

`checkB6` checks only that the screenshot path has a PNG/JPEG/WebP extension and
is non-empty (`scripts/harness-intelligence-bench.mjs:435-460`). A four-byte PNG
signature with no decodable image passes the category. The RED fixture supplies
exactly that fake header while also supplying hand-authored backend/UI/state
JSON, and the oracle returns `B6: pass`.

The B6 requirement is a real UI observation after CLI-only backend start; a
header and hand-filled state cannot establish that a browser rendered or
observed the canonical task. Minimal repair claim (not applied): reject
undecodable image bytes at the mechanical layer and require a real-browser
screenshot/trace or documented manual browser check in the independent review.
Do not treat a stronger file parser as proof of UI semantics; the browser path
and reviewer inspection remain mandatory.

## Category-by-category evidence boundary

- B1: Mechanical checks hash the installed artifact, sentinel, package archive,
  receipt, and raw install log. There is no run yet. A package hash plus a
  claimed source SHA is not by itself provenance that every installed byte came
  from that SHA; an independent reviewer must inspect the clean-build receipt,
  archive listing, and install log.
- B2: GREEN for fixture fairness. `b2/data.json` contains records only and the
  public oracle is implemented by executing the candidate twice
  (`scripts/harness-intelligence-bench.mjs:233-258`). Stage 1, stage 2, and the
  baseline handoff contain no literal `1350`/`1800`; stage 2 and baseline carry
  the flag and the baseline states same-model/runtime/effort and preserves the
  same fixture. No sealed holdout is present in the public fixture. The public
  oracle is intentionally public; it must not be presented as a hidden-agent
  answer or as a model-ability comparison.
- B3: RED/HIGH-1. Real Codex -> Claude execution, cancellation/failure, retry,
  and one side effect still require fresh raw logs and manual runtime review.
- B4: RED/HIGH-2. Whole-category skip is correctly rejected (`B4_REQUIRED`),
  but the restore comparison must not force audit deletion.
- B5: No mechanical authenticity claim is accepted. URL allowlisting, a
  non-empty captured source, and regexes do not prove official provenance,
  license validity, version truth, or actual reuse. A fresh CSV-shaped task,
  raw lookup, source capture, license/version decision, and recheck trigger
  require independent human inspection as the README says.
- B6: RED/HIGH-3. The canonical project/task/path/hash and CLI-only lock fields
  are useful mechanical checks, but no fake or hand-authored screenshot may
  satisfy the visual/UI part.

The schema/output shape does distinguish mechanical evidence from independent
review: category evidence carries `mechanical`/`reviewRequired`, and
`independentReview: pending` blocks overall pass (`README.md:93-97`,
`scripts/harness-intelligence-bench.mjs:490-505`). A real run must leave review
pending until a distinct reviewer inspects every category. A single smoke run
is `n=1` and cannot support SOTA/world-leading or causal Harness/model claims.

The frozen contract refers to existing typed APIs and A2A/peer-capsule
`REQUEST/STATE/events/RESULT` envelopes (`Harness/tasks/task-upgrade-harness-092/CONTRACTS.md:110-113`); it does not
claim full standards-level A2A interoperability. No broader AgentCard/protocol
compatibility claim was found in the benchmark/README surfaces reviewed. Do not
upgrade a local cross-CLI trace into a standards-compatibility claim.

## Read-only pre-release path and risks

Observed current facts:

- Branch: `agent/wf-ui-state-checkpoint-20260804`.
- Initial/current HEAD observed: `0212e161079aa554b2a3b070d0503fa6260b7fd0`.
- HEAD `package.json` is `0.8.21`; the dirty working tree's package/version
  files are `0.9.1`. Neither is a pushed 0.9.2 candidate.
- `package.json:9-25` includes `src/` and templates, excludes UI source,
  e2e/debug artifacts/maps, and intentionally keeps generated UI `dist` when
  it exists. `src/wf-ui-server/server.mjs:253-261` serves `src/ui/dist` in a
  development checkout or `dist/wf-ui` in an installed package.
- `git ls-tree -r HEAD -- src/ui/dist` returned zero paths; no lockfile is
  tracked at HEAD (`src/ui/pnpm-lock.yaml`, `package-lock.json`, and
  `yarn.lock` all returned zero paths). `src/ui/package.json` has its own
  `build` script, but root `package.json` has no UI build script.
- `scripts/build-version.mjs:211-248,266-321` derives and writes ownership and
  version artifacts; generation includes timestamps. `--check` is read-only but
  exits before root sync, while `scripts/pre-push-check.mjs:15-24` separately
  checks root drift and then runs the long tests/e2e/pack gates.

The safe sequence below is the required release recipe, shown for review only;
the commands were not run here:

```powershell
$remote = 'https://github.com/LiWeny16/create-harness-vibe-coding.git'
$sha = '<exact-40-hex-pushed-candidate-sha>'
$buildRoot = Join-Path ([IO.Path]::GetTempPath()) ('harness-092-build-' + [guid]::NewGuid())
$artifactRoot = Join-Path ([IO.Path]::GetTempPath()) ('harness-092-artifacts-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $artifactRoot | Out-Null
git clone --no-checkout $remote $buildRoot
git -C $buildRoot fetch --depth=1 origin $sha
git -C $buildRoot checkout --detach $sha
if ((git -C $buildRoot status --porcelain --untracked-files=all)) { throw 'build checkout is dirty' }
if ((git -C $buildRoot rev-parse HEAD) -ne $sha) { throw 'HEAD is not the requested candidate SHA' }
git -C $buildRoot cat-file -e "${sha}^{commit}"

# Candidate metadata/manifests, in the isolated checkout only.
node (Join-Path $buildRoot 'scripts/build-version.mjs') --check
# If stale, run the write mode only in this disposable checkout; record the
# exact generated-file diff and reject any source/user-file changes.

# Build ignored UI output before packing; clean HEAD has no src/ui/dist.
npm install --ignore-scripts --prefix $buildRoot
npm install --ignore-scripts --prefix (Join-Path $buildRoot 'src/ui')
npm run build --prefix (Join-Path $buildRoot 'src/ui')

$packJson = Join-Path $artifactRoot 'pack.json'
npm pack --dry-run --json --prefix $buildRoot | Tee-Object $packJson
npm run pack:smoke --prefix $buildRoot
npm pack --ignore-scripts --json --pack-destination $artifactRoot --prefix $buildRoot
$archive = Get-ChildItem $artifactRoot -Filter '*.tgz' | Select-Object -First 1
Get-FileHash $archive.FullName -Algorithm SHA256
tar -tf $archive.FullName

# Fresh install must consume only the preserved archive, never the checkout.
$installRoot = Join-Path ([IO.Path]::GetTempPath()) ('harness-092-install-' + [guid]::NewGuid())
npm install --ignore-scripts --prefix $installRoot $archive.FullName
```

After the install, capture the archive hash, package/version receipt, complete
package file list, raw npm install log, installed artifact hashes, and the
sentinel hash. Run B1-B6 only from `$installRoot` plus a fresh fixture/evidence
root. Do not use `npm link`, `npx` against the development directory, or a dirty
checkout path.

Release risks to resolve or explicitly accept:

1. A clean exact SHA lacks tracked `src/ui/dist` and a reproducible lockfile;
   without the isolated UI build, the package smoke expectations and installed
   wf-ui static route cannot be proven. Unpinned UI ranges plus no committed
   lockfile make repeated builds potentially differ.
2. `build-version.mjs` writes timestamped generated metadata, so preserve the
   one archive and hash used for the benchmark; do not imply byte-reproducible
   rebuilds from SHA alone. Record the generated-file allowlist and diff.
3. `npm pack` allowlisting is tested by regexes/size and package `files`, not a
   cryptographic source-to-archive manifest. Inspect the actual tar listing and
   reject benchmark/scorer/task/debug files or unexpected source additions.
4. Current dirty-tree artifacts (`src/ui/dist`, node_modules, root Harness
   tasks/A2A state, and unrelated user edits) must never be the pack source.

## Validator warning classification

Read-only validator output was “Harness validation passed” with two warnings:

- Missing path: `Harness/tasks/task-make-wf-lifecycle-0908/STATE.json`.
- `Harness/tasks/` has 6 outer task capsules (cap 5).

`git ls-files -- Harness/tasks/task-make-wf-lifecycle-0908` and
`git ls-tree -r HEAD -- Harness/tasks/task-make-wf-lifecycle-0908` returned no
entries; the directory currently contains untracked `PLAN.md`, `PROBLEM.md`,
`PROGRESS.md`, and `REFERENCES.md`, with no `STATE.json`. Thus this is a
dogfood/user task-state warning, not a product release artifact or npm package
gate. The validator exits 0, and the pre-push strict step treats it as a
warning. Do not reconcile, archive, delete, or close that task to make a
release green. A clean remote release checkout will not contain this untracked
state; if a policy later makes warnings blocking, track it as a separate
dogfood-state issue.

## Acceptance status

No AC is accepted by this review. B2 fixture fairness is GREEN; B3/B4/B6 have
RED/HIGH scorer findings; B1/B5 remain unrun/pending manual provenance review;
all six categories require a future distinct reviewer record after a genuine
fresh-install agent run. Holdout remains sealed and untouched.
