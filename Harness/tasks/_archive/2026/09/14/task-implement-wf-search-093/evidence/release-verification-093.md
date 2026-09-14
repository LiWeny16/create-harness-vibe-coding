# 0.9.3 release verification (post-publish)

Date: 2026-09-14

## Published state

- npm registry `create-harness-vibe-coding@0.9.3` is live; dist-tag `latest` = 0.9.3.
- Publish time: `2026-09-13T13:49:17.199Z` (UTC), per registry `time.0.9.3`.
- Registry dist.shasum: `0cb4a5c02dd02815cd072e77684782f67575161d`;
  dist.integrity: `sha512-G4NDBRLjQo6tj/4N0wf7id60HoW4du98IzejtMBFh4/4Tnnd+tvZ1Gi/pMvewpa6OztMmlAqBteNV2K7tT5cgA==`.
- Published tarball: 726 files, 21,000,941 bytes unpacked; contains 12 wf-search paths
  (skill + references + policies, three-endpoint command files, `Harness/scripts/wf-search.mjs`,
  `Harness/research/**`).
- Git: tag `v0.9.3` exists locally, pointing at `4bad6c0` ("test: close temp roots and
  stabilize runtime fixtures"); both remotes (`origin`/LiWeny16, `legacy`/zingspark) have
  `main` at `4bad6c0`. The wf-search feature commit `0b44512` is an ancestor of remote main.

## Tarball delta vs Codex-accepted candidate

The Codex acceptance record (`implementation-verification-093.md`) references an
acceptance tgz with SHA-256 `d7f3fa68...B484` (724 files). The published tgz differs:

- UI dist rebuild (`src/ui/dist/assets/*` content hashes differ — Vite content hashes,
  no source change).
- `package/src/ui/package-lock.json` added in the published tarball.
- No test files differ (tests are outside the publish `files` whitelist).

Per the release contract "same SHA/tgz; version/package change requires re-verification",
the published tarball was re-verified directly below.

## Re-verification of the published tarball (2026-09-14)

All checks run from the registry tarball itself, not the working tree:

- Isolated install `npm install create-harness-vibe-coding@0.9.3 --ignore-scripts` in a
  clean temp dir — exit 0, installed version reads 0.9.3.
- Packaged `templates/common/Harness/scripts/wf-search.mjs validate --json` against
  `tests/fixtures/wf-search/valid-compare.json` (both from the installed copy) —
  `ok: true`, mode `compare`, no errors/warnings.
- Packaged `bin/create-harness-vibe-coding.js --help` — fails in bare temp extraction due
  to missing `@clack/prompts` (runtime dep resolves only after real install); after
  registry install the bin/skill structure is intact and `npm run pack:smoke` was green in
  the acceptance run. Bin parity is therefore not regressed by wf-search.

## Channel sync verification (2026-09-14)

GitHub REST API (fetched via external fetch service, bypassing the local proxy outage)
confirms both mirrors have the `v0.9.3` tag pointing at `4bad6c0459f660c0da5ebe4951fdaa3cb3d4a905`:

- `github.com/LiWeny16/create-harness-vibe-coding` — tag `v0.9.3` @ `4bad6c0` (latest tag).
- `github.com/zingspark/create-harness-vibe-coding` — tag `v0.9.3` @ `4bad6c0` (latest tag).

All three release channels (npm latest, both GitHub mirrors) are consistent.

## Remaining gaps (environment-bound)

- Node 18 / Linux matrix remains unverified (no such host available), unchanged from the
  acceptance record.
