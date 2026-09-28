# task-route-wf-search-deep-media - REFERENCES

## Logs

| Description | File / Command | Date |
|-------------|---------------|------|
| Targeted research, download, extension, and pack tests | `node --test tests/wf-research.test.js tests/wf-search-download.test.js tests/wf-search-install.test.js tests/extensions.test.js tests/pack-smoke.test.js` | 2026-09-18 |
| Full regression suite | `npm test` | 2026-09-18 |
| Harness validation | `node Harness/scripts/validate-harness.mjs` | 2026-09-18 |

## Evidence

| What | Pointer | Verified |
|------|---------|----------|
| Public route and deep subagent contract | `.claude/commands/wf-search.md`, `.claude/skills/wf-research/SKILL.md`, `extensions/wf-search-deep/agent.json` | yes |
| GitHub-backed media adapters and provider catalog | `extensions/wf-search-deep/toolchain.json`, `extensions/wf-search-deep/adapters.json`, `extensions/wf-search-deep/search-providers.json` | yes |
| Root/template downloader mirror | `Harness/scripts/wf-search-download.mjs`, `templates/common/Harness/scripts/wf-search-download.mjs` | yes |
| Optional global extension contract | `Harness/extensions/registry.json`, `extensions/wf-search-deep/extension.json` | yes |
| Runtime probe | system yt-dlp available; gallery-dl unavailable; no `Harness/extensions/lock.json` | yes |
| Live YouTube adapter | temporary global runtime + `wf-search-download.mjs` downloaded/merged a public NASA video | yes |
| Live Bilibili adapter | temporary global runtime + yt-dlp downloaded/merged a public BV video | yes |
| Live X adapter | temporary global runtime + gallery-dl downloaded a public X video using guest token | yes |
| TikTok platform skill | `extensions/wf-search-deep/skills/platform-tiktok/`: `@ssut/tiktok-api@1.5.2` selected H264 metadata/format and yt-dlp downloaded a 3,288,875-byte MP4; repeat probe later received HTTP 429 | yes |
| TikTok fallback boundary | direct yt-dlp returned platform unexpected-response; BrowserOS session not available in this environment; authenticated comments/CAPTCHA were not proven | yes |
| GPT Researcher boundary | short-path global install succeeded for PyPI 0.16.0, but import failed on upstream missing `Any`/`List` imports; kept optional and unhealthy | yes |
| Search provider routing | `validateSearchProviderCatalog` and `buildSearchProviderPlan` report credential/self-hosted boundaries without secret values | yes |
| Live VLM global/local pass | Qwen multimodal endpoint on the user-owned backend; 158-second Bilibili robot video; global 0/79/158s sampling plus local 80s pass returned grounded SwingBot/bar/safety-net/test observations through `video-vlm/run.mjs` | yes |
| Live Whisper ASR pass | Whisper Large-v3 endpoint returned English, 158.336875s duration, 7 timestamped segments for the same video | yes |
| Agentic video framework research | GitHub review of LongVideoAgent, VideoSEAL, Video-RAG, VideoITG, AgentVidBench, and a low-activity LangGraph Video-RAG project | yes |

## Links

| Description | URL / Path |
|-------------|------------|

## Notes

-
