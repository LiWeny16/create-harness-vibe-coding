# Source Routing

Pick source types per question before picking tools. This mirrors the local
research protocol's tool order (local first, optional external tools, free
fallback, no paid-tool requirement).

## Source Types

`official`, `source-code`, `issue`, `paper`, `community`, `news`, `other`.

## Routing by Question Type

| Question type | Preferred sources | Notes |
| --- | --- | --- |
| Version/date/capability fact | official, source-code | changelogs, release notes, specs, in-repo code |
| Behavior/API correctness | source-code, official, issue | source outranks summaries; maintainer answers in issues are official-ish |
| Contested claim | official + independent community/news | deliberately seek counter-evidence, not only confirmation |
| Option comparison | official, source-code, issue, community | same-condition grid; popularity signals stay community-observation |
| Error diagnosis | issue, source-code, community | match versions/platform; official bug trackers first |
| Ecosystem/news/practice | news, community, official | check dates; news syndication needs originGroup |

## Local First

Before external sources, check the local repo: existing docs, lockfiles,
vendored code, tests, package metadata, and prior recorded research
(`Harness/research/research-results.md`). Local evidence can answer or
sharpen the question; it does not replace a user-requested current external
verification.

## Independence Rules

- Different domains do not automatically mean independent sources — press
  releases and news coverage are frequently copies of one origin.
- Syndicated/mirrored/republished coverage of one origin must carry the same
  explicit `originGroup` value so it is not counted as independent
  corroboration.
- When independence is unknown, leave it unknown; `unknown` never counts as
  proven independent support.
- Do not merge URLs across origins; normalization removes only known
  tracking parameters (see `evidence-contract.md`).

