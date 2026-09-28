# task-wf-research-deep-pipeline - PROGRESS

## Status

- Phase: Archived
- Memory preflight: done; memory hints: none
- RED: passed first (missing `wf-research` library), then GREEN passed
- Verification: focused, full-suite, package smoke, and non-strict Harness validation passed

## Current Evidence

- Existing wf-search removes artificial operation-depth caps but remains a
  direct evidence pass, not a deep-research subagent.
- Existing wf-search-deep is a declarative extension with platform and ASR
  capability names, not an executable research pipeline.
- External source scan identified mature candidates: GPT Researcher, STORM,
  yt-dlp, BrowserOS boundary, LongVT, LongVideoAgent, and deep-research-agent.
- Added a dedicated `wf-research` command/skill and `wf-search-deep` read-only
  subagent profile with collect/understand/decide/output stages.
- Added a curated 18-source catalog, optional global toolchain descriptors,
  video temporal/ASR/comment result contract, evidence scoring and discard
  reasons, plus a VLM temporal benchmark fixture.
- Focused acceptance result: 12 passed, 0 failed; benchmark keeps 4 strong
  items and discards 2 weak items (`97`, `93.5`, `87`, `70.5` kept; `50`,
  `8.5` discarded).
- Optional runtime bootstrap is executable: `setup` emits a safe global plan
  and only installs allowlisted local packages with explicit `--apply`;
  `doctor` distinguishes `not-installed`, `requires-configuration`,
  `configured-not-checked`, `requires-session`, and ready health states;
  `configure` writes endpoint/model metadata without credentials.
- Live research run: `evidence/live-run-vlm-temporal-2026-09-18.json` passed
  validation. Scoring kept LongVT (97.5), LongVideoAgent (96), frame
  selection (96.5), VideoITG (94), and a low-weight X signal (61); Reddit
  (49.5) and a Bilibili page snippet (48.5) were discarded. The run records
  that no ASR, VLM frame pass, or comment crawl was performed without the
  private runtime/session.
- Verification commands: full `node --test tests/*.test.js` passed 487,
  failed 0, skipped 1; `node --test tests/wf-research.test.js tests/cli-smoke.test.js`
  passed 52, failed 0, skipped 1; `npm run pack:smoke` passed 3/3;
  non-strict `validate-harness --json` passed.
- GitHub decisions are recorded in `REFERENCES.md`; heavyweight research and
  video runtimes remain optional and are not bundled into the default package.

## Next Action

The implementation is complete for the current acceptance criteria. A real
BrowserOS/Whisper/VLM media run remains an environment-gated next validation:
it requires the user's authorized session and healthy private endpoints. Strict
Harness validation is currently blocked only by the pre-existing six outer
task capsules exceeding the repository cap of five; archive when appropriate
with `$wf-task-archive`.
