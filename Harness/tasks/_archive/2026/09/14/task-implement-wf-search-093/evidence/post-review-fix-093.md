# Post-release fix: Codex cross-review findings (0.9.3 → fix candidate)

Date: 2026-09-14
Base: released 0.9.3 (tag v0.9.3 @ `4bad6c0`)

## Codex independent cross-review verdict (2026-09-14)

`CROSS-REVIEW: FAIL` — dimension 1 (requirement fit) PASS, dimension 3 (install/surface
parity) PASS, but dimension 2 (correctness) FAIL with three defects and dimension 4
(evidence integrity) FAIL on the candidate/published SHA mismatch.

## Defects found and fixes applied

All fixes in `templates/common/Harness/scripts/lib/wf-search.mjs`, mirrored to
`Harness/scripts/lib/wf-search.mjs`:

1. **Escaped-bracket Markdown link injection survived `plain()`/`escape()`**
   (`[x\]](https://evil.example)` rendered as `[x]](https://evil.example)`).
   Fix: `escape()` now HTML-escapes `[`/`]` in ALL text output (`&#91;`/`&#93;`), so no
   residual bracket pair can be re-formed into a link by a Markdown renderer.
   `escapeMarkdownLabel` collapses into the same path. Evidence: new test
   "render neutralizes escaped-bracket markdown link injection in text fields" — RED
   before, GREEN after.

2. **Dangling symlink/junction of `Harness/research` bypassed save-path validation**
   (`existsSync` skips dangling links; the nearest-existing-parent branch treated the
   link as a plain name). Fix: `scopedPath` now detects link segments with
   `lstatSync().isSymbolicLink()` regardless of target existence and realpath-resolves
   them; dangling links fail realpath and are rejected.
   Evidence: new test "AC-004 resolve-save-target rejects a dangling link of
   Harness/research" in `tests/wf-search-install.test.js` — RED before (via stale root
   mirror), GREEN after mirror sync.

3. **`--input -` buffered all of stdin before applying the 1 MiB limit.**
   Fix: replaced `fs.readFileSync(0)` with `readStdinBounded()` — 64 KiB chunks via
   `fs.readSync(0, ...)`, aborting with `input exceeds 1 MiB` the moment the cap is
   crossed. Evidence: new test "stdin larger than 1 MiB exits 1 ... without buffering
   past the limit".

## Verification after fix

- `node --test tests/wf-search.test.js tests/wf-search-install.test.js` — **75 passed,
  0 failed** (was 71; +3 render/stdin tests, +1 dangling-link test).
- `npm test` — **458 passed, 0 failed, 1 skipped** (no pre-existing failures; the four
  0.9.2-era fixture failures recorded during acceptance are green in this tree).
- `node scripts/check-script-mirrors.mjs` — 5/5 pairs identical.
- `node scripts/check-root-harness-version.mjs` — root checksums match after
  `npm run build:version` refresh (220 files).
- `node Harness/scripts/validate-harness.mjs --strict` — passed (from the working tree
  with 7 outer capsules the strict validator's capsule cap applies; acceptance was run
  from a clean checkout, unchanged).
- Root-mirror end-to-end probes: escaped-bracket render neutralized; dangling junction
  rejected; oversized stdin exits 1 with the size error.

## Evidence-integrity finding (dimension 4)

Accepted, and already documented in `evidence/release-verification-093.md`: the
published 0.9.3 tarball (726 files) differs from the Codex-accepted candidate tgz (724
files) by UI dist content hashes and an added `src/ui/package-lock.json`; no test or
source file differs (tests are outside the publish whitelist). Per the "same SHA/tgz;
package change requires re-verification" rule, the published tarball was re-verified
directly (isolated registry install + packaged-helper validate). The reviewer is right
that the full adversarial wf-search matrix was not re-run against the published tgz;
that full matrix re-run is folded into the 0.9.4 republish below instead of 0.9.3.

## Release decision

The fixes change the packaged library, so they cannot ride on the published 0.9.3.
Release chronology discovered during closeout:

- `origin/main` had already advanced past 4bad6c0 to `a5a3eff` ("Release 0.9.4",
  tag `v0.9.4`, a clean manifest-only maintenance release published 2026-09-14
  12:03 +0800) — that release does NOT contain the three fixes.
- The fix commit was therefore rebased onto `a5a3eff` and released as **0.9.5**
  (commit `b26e5ed`, tag `v0.9.5`), with CHANGELOG 0.9.5 entry and all version
  manifests bumped to 0.9.5.
- Full verification on the rebased candidate: `npm test` 458/458, e2e 174/174,
  server 52/52, mirror parity 5/5, root checksums match, `pack:smoke` green.
- Final tarball built from `b26e5ed`:
  `create-harness-vibe-coding-0.9.5.tgz`, SHA-256
  `76c07446452e07687cf9ff7a4b492adaaec1f5979f5a19d5c528a6347f2d6142`, 12 wf-search
  paths, packaged-helper probes all green: escaped-bracket render neutralized,
  dangling junction rejected, file and stdin 1 MiB both enforced with
  `input exceeds 1 MiB`, `valid-compare` validate `ok: true`.

## Remaining gaps (unchanged, environment-bound)

- Node 18 / Linux matrix remains unverified on this Windows host.
- Live-provider agent scenarios were not exercised during 0.9.3 acceptance (deterministic
  ledger probes only); unchanged limitation, to be noted in the 0.9.4 record.
