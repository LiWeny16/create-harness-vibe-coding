---
name: harness-research
description: Use for market, product, stack, dependency, API, pricing, legal, security, or open-source research before PRD or architecture decisions.
---

# Harness Research

Load:

- `Harness/research/README.md`
- `Harness/research/research-results.md`
- `Harness/PROGRESS.md`
- `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md` when available

Define:

- research question
- decision needed
- source boundaries
- tool choice: local / GitHub / Tavily / TinyFish / built-in web search / user-provided sources
- fallback when the preferred tool is unavailable
- return format

Return:

- queries and tools used
- sources with links and source type
- adopted / rejected / watch decisions
- risks and unknowns
- patch-ready `Harness/research/research-results.md` update
