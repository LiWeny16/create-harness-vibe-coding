# task-wf-research-deep-pipeline - PLAN

## Goal

Turn wf-research into a glue-layer deep-research pipeline. Reuse mature
research, browser, media, and video-agent projects through installable adapters;
do not vendor their heavy runtimes into the default Harness install.

## Mini PRD

Given a research question, wf-research must plan heterogeneous first-party and
social sources, expose available tool/runtime requirements, preserve compact
evidence, score and discard low-value items, and render a conclusion-oriented
report. Video evidence must support transcript timestamps and a future/optional
visual timeline without placing full media in model context.

## Acceptance Criteria

| ID | Criterion | Evidence |
|----|-----------|----------|
| AC-001 | A dedicated `wf-research` protocol distinguishes collection, understanding, decision/scoring, and output stages and delegates execution to a `wf-search-deep` subagent profile. | skill/command/agent contract tests |
| AC-002 | A curated source catalog routes source tiers by question type and records canonical URLs, access mode, adapter, and evidence strengths; it is not merely a platform list. | catalog validation test |
| AC-003 | Toolchain descriptors declare mature upstream projects, install commands, global runtime paths under `Harness/extensions`, model endpoint configuration, and health checks without bundling dependencies by default. | toolchain/manifest test |
| AC-004 | The pipeline validates normalized evidence with relevance, directness, recency, independence, and confidence scoring, and marks low-value items discarded with reasons. | scorer RED/GREEN tests |
| AC-005 | Video contract covers ASR transcript, timestamped visual segments, comments, and token-saving global-to-local reading; missing capabilities become explicit limitations. | video contract tests |
| AC-006 | A benchmark fixture for “how VLM agents understand temporal video information and save tokens” validates and renders a multi-source report, including source scores and unsupported/insufficient boundaries. | benchmark run artifact and helper output |
| AC-007 | Root/template mirrors, strict validation, full tests, and package smoke checks pass. | command evidence in PROGRESS.md |
| AC-008 | Optional toolchain setup produces a safe global install plan, doctor distinguishes unavailable/configured/session-only tools, and endpoint/model configuration writes no credentials. | setup/doctor/configure CLI tests |

## Scope

Write set:
- `Harness/scripts/wf-research.mjs` and self-contained library
- `templates/common/Harness/scripts/wf-research.mjs` and library mirror
- `extensions/wf-search-deep/*` source catalog, toolchain, workflow, agent profile
- root/template wf-research command and skills
- focused tests and benchmark fixtures
- ownership manifests and task evidence required by validation

Forbidden:
- Do not bundle browser engines, yt-dlp, ffmpeg, Whisper weights, VLM weights,
  or Python research frameworks into the default package.
- Do not persist browser cookies, provider keys, SSH keys, or raw private media
  in extension payloads or research reports.
- Do not claim visual/comment evidence when only transcript or visible text was
  actually obtained.

## External Reuse Decisions

| Project | Decision | Rationale |
|---------|----------|-----------|
| GPT Researcher | adapt | Mature planner/executor/citation workflow and MCP integration; invoke as an optional backend, keep Harness evidence contract at the boundary. |
| STORM / knowledge-storm | adapt | Strong source-grounded knowledge curation and replaceable retrieval modules; optional planning backend, not default runtime. |
| yt-dlp | adopt | Media metadata/audio/video acquisition and comment fields; optional global tool runtime. |
| BrowserOS Neo | adopt existing boundary | User-authorized authenticated browser remains the cookie boundary; no raw-cookie extraction. |
| LongVT / LongVideoAgent | adapt patterns | Their global-to-local temporal grounding and targeted vision-agent ideas inform the video contract; training stacks are too heavy to install as a default adapter. |
| deep-research-agent | adapt contract ideas | Durable state, evidence-only synthesis, replanning, duplicate suppression, and context budget are useful interface patterns; do not vendor a second research engine. |

## Verification Commands

```text
node --test tests/wf-research.test.js
npm test
npm run pack:smoke
node Harness/scripts/validate-harness.mjs --strict
```
