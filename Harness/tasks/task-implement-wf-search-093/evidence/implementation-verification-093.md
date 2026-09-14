# wf-search 0.9.3 implementation verification

Date: 2026-09-13

Candidate SHA: `0b4451266ae0883f523a1786ed52ebce3523f5f5`
Clean checkout: `C:/Users/onion/Documents/Codex/2026-09-13/wf-search-clean-093c`

## Contract and install checks

- `node --test tests/wf-search.test.js tests/wf-search-install.test.js` — **71 passed, 0 failed** (raw run from the clean checkout with an isolated npm cache).
- The suite includes malformed claim type handling, strict ISO-8601 dates, fact/major evidence rules, successful operation linkage, major contradiction handling, CLI error envelopes, hostile Markdown URL encoding, global bridge execution, path traversal protection, and dynamic `wf-remove` preservation of `Harness/research/search/**`.
- `node --test src/wf-ui-server/__tests__/action-registry-loader.test.mjs src/wf-ui-server/__tests__/server.integration.test.mjs` (escalated isolated temp access) — **52 passed, 0 failed**.
- `npm test` — **455 tests, 450 passed, 4 failed, 1 skipped**. The four failures are pre-existing 0.9.2 effort/dispatch fixture tests (`review-cross-contract-092.test.js`, `review-effort-server-092.test.js`) that require the unavailable provider/PTY fixtures; no wf-search test failed. Raw log: `C:/Users/onion/Documents/Codex/2026-09-13/wf-search-clean-093c/npm-test-093c-final.txt`.
- `npm run test:e2e` — **174 passed, 0 failed** (raw log: `C:/Users/onion/Documents/Codex/2026-09-13/wf-search-clean-093c/e2e-093c.txt`).
- `node --test src/wf-ui-server/__tests__/action-registry-loader.test.mjs src/wf-ui-server/__tests__/server.integration.test.mjs` — **52 passed, 0 failed** (raw log: `C:/Users/onion/Documents/Codex/2026-09-13/wf-search-clean-093c/server-focused-093c.txt`).
- `npm --prefix src/ui run build` — passed.
- `npm run pack:smoke` — passed (3/3).
- Clean-candidate `node Harness/scripts/validate-harness.mjs --strict` and `node templates/common/Harness/scripts/validate-harness.mjs --strict` — both passed.
- `npm run build:version -- --check`, `node scripts/check-root-harness-version.mjs`, `node scripts/check-script-mirrors.mjs`, `node Harness/scripts/context-budget.mjs --json`, and `git diff --check` — passed.

## Package smoke

- Built package: `C:/Users/onion/Documents/Codex/2026-09-13/d-myfile-sample-synchronous-github-zingspark-2/outputs/create-harness-vibe-coding-0.9.3.tgz`.
- SHA-256: `D7F3FA684A4E840E2FDFF30CEFCF0C467F346BABD4A1A1B385FD1BBFA533B484` (npm shasum `2bc27c553293366d6bd424825572347d24bbad2c`, integrity `sha512-DBtlV7s/CP1VpP4HHHLIkcNhiAV9e9HPokCXLvgAoWadaI+6sAncpVTr4hJycvwfpJh2Sf0OOIGM6toshZb4mg==`).
- Tarball metadata: 7,899,247 bytes packed, 21,254,175 bytes unpacked, 724 files.
- Fresh isolated `npm install --ignore-scripts --no-audit --no-fund` — exit 0; installed package version `0.9.3`.
- Packaged `templates/common/Harness/scripts/wf-search.mjs validate --json` against the valid compare fixture — `ok: true`, mode `compare`.
- Packaged `bin/create-harness-vibe-coding.js --help` — exit 0; `npm run pack:smoke` — **3 passed, 0 failed**.

## Environment limits

- The current user checkout has seven active outer task capsules, so its local strict validator reports the configured five-capsule cap. This is preserved user task state; final release acceptance must run from a clean candidate checkout.
- Node 18/Linux was not available in this Windows validation host and remains an explicit unverified matrix item.
- Before publication, both configured GitHub mirrors still report no `v0.9.3` tag/release and npm reports `0.8.20`; those remote facts are release gates, not implementation failures.
