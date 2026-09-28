# task-wf-research-deep-pipeline - REFERENCES

## Logs

| Description | File / Command | Date |
|-------------|---------------|------|

## Evidence

| What | Pointer | Verified |
|------|---------|----------|

## Links

| Description | URL / Path |
|-------------|------------|

## Notes

-

## deep-research-agent
- URL: https://github.com/Xrrr1111/deep-research-agent
- Source type: official
- Version: main@2026-09-18
- License: MIT
- Decision: adapt
- Reason: Adapt its planner/search/fetch/evidence-extractor interfaces, persistent research state, gap-triggered replanning, and citation validation ideas into the wf-research result contract.
- AC IDs: AC-001, AC-004, AC-006
- Checked at: 2026-09-18T00:00:00Z
- Recheck trigger: Upstream state schema or license changes

## GPT Researcher
- URL: https://github.com/assafelovic/gpt-researcher
- Source type: official
- Version: main@2026-09-18
- License: Apache-2.0
- Decision: adapt
- Reason: Reuse its planner/executor/source-tracking pattern as an optional research-engine adapter; keep Harness ownership of the result schema and evidence scoring.
- AC IDs: AC-001, AC-003, AC-004
- Checked at: 2026-09-18T00:00:00Z
- Recheck trigger: Upstream API, install method, or license changes

## LongVideoAgent
- URL: https://github.com/longvideoagent/LongVideoAgent
- Source type: official
- Version: main@2026-09-18
- License: repository license checked before installation
- Decision: adapt
- Reason: Adapt its master/grounding/vision-agent decomposition as the dedicated wf-search-deep subagent workflow, while keeping media and model services external.
- AC IDs: AC-001, AC-005
- Checked at: 2026-09-18T00:00:00Z
- Recheck trigger: Upstream agent protocol or license changes

## LongVT
- URL: https://github.com/EvolvingLMMs-Lab/LongVT
- Source type: official
- Version: main@2026-09-18
- License: Apache-2.0
- Decision: adapt
- Reason: Adapt the global-to-local crop_video and timestamp-targeted inspection strategy for the VLM video contract; do not install its heavyweight multi-GPU stack by default.
- AC IDs: AC-005, AC-006
- Checked at: 2026-09-18T00:00:00Z
- Counterexample: Its published runtime assumptions are too heavy for a default Harness extension.
- Recheck trigger: A lighter compatible temporal VLM runtime becomes available

## STORM
- URL: https://github.com/stanford-oval/storm
- Source type: official
- Version: main@2026-09-18
- License: repository license checked before installation
- Decision: adapt
- Reason: Reuse its retrieval-provider routing and source-grounded knowledge-curation pattern without bundling the Python runtime in the default Harness package.
- AC IDs: AC-002, AC-003
- Checked at: 2026-09-18T00:00:00Z
- Recheck trigger: Upstream dependency, provider, or license changes

## yt-dlp
- URL: https://github.com/yt-dlp/yt-dlp
- Source type: official
- Version: latest release reviewed@2026-09-18
- License: Unlicense
- Decision: adopt
- Reason: Adopt as an optional media acquisition adapter for metadata, captions, audio/video, and available comments; install only into the global extension runtime.
- AC IDs: AC-003, AC-005
- Checked at: 2026-09-18T00:00:00Z
- Recheck trigger: Extractor breakage, platform policy, or release changes
