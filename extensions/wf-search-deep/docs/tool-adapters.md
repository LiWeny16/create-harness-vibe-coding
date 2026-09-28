# Tool Adapters

Pick the tool after the source types are known, from tools actually
available in the current host. Discover capabilities at runtime.

## Host Tools

| Tool | Use for | Notes |
| --- | --- | --- |
| WebSearch / built-in web search | broad query, source discovery | free fallback; expect less structure, verify more |
| WebFetch / page read | fetching a specific URL's text | counts as a read per URL |
| GitHub CLI (`gh`) / GitHub API | repos, issues, code search, releases | needs auth for rate-heavy use |
| Tavily (optional) | broad web search, source discovery | only when configured; never required |
| TinyFish (optional) | rendered/dynamic pages, structured extraction | only when configured; never required |
| BrowserOS Neo (user-designated) | pages needing interaction or login | use the authenticated browser boundary; never read raw cookies |
| `wf-search-video.mjs` | transcript validation, timestamp search, ASR handoff | local helper; endpoint must be explicitly supplied |

## Availability Rules

- Configuration existing does not mean authenticated and callable. A tool
  counts as available only when a call with it actually succeeds in this
  session; verify before relying on it.
- If a tool requires installation or login that is not already satisfied,
  record the operation as `unavailable` and use a legitimate fallback. Do not
  install or log in automatically from this command.
- No tool is mandatory and no paid tool is required. When Tavily/TinyFish is
  absent, use the built-in fallback and record the limitation.
- BrowserOS Neo is available only after a real connection succeeds in this
  session. It is bounded page interaction, not permission to crawl without
  limits; see `platform-adapters.md`.
- The video helper is a local contract adapter. It does not fetch platform
  pages, bypass access controls, or attach cookies; see `video-research.md`.
- When every usable tool is unavailable, record all operations as
  `unavailable` and report the failure honestly. Never fabricate citations
  for searches that did not run.
There is no workflow-imposed operation-count flag. The Agent
chooses the effort required by the question; tool-specific rate limits and
platform access failures are recorded as limitations rather than converted
into an artificial workflow budget.

## Read the Docs After Choosing

Read a tool's own Skill/documentation only after selecting it for this run,
not upfront for every candidate tool. Record which tool served each
operation in `operations[].tool`.


