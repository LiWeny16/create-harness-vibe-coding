# task-route-wf-search-deep-media - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived
- Public `/wf-search` now routes to the `wf-research` controller and read-only `wf-search-deep` subagent.
- Optional media adapters are registered as lazy global skills: yt-dlp is the shared downloader for YouTube/Bilibili and platform skills; gallery-dl is the social fallback for X/Instagram/Reddit; `platform-tiktok` uses GitHub-backed `@ssut/tiktok-api` for metadata/H264 discovery and delegates transfer to yt-dlp; BrowserOS Neo remains the authenticated page/comment route.
- Search-provider catalog distinguishes integrated, configured hosted, and user-hosted/self-hosted adapters without embedding credentials or a backend host.
- Download glue is mirrored at `Harness/scripts/wf-search-download.mjs` and `templates/common/Harness/scripts/wf-search-download.mjs`.

## Verification

- Targeted research/download/extension/pack suite: 55 passed, 0 failed.
- Full `npm test`: 494 passed, 1 skipped, 0 failed.
- Non-strict Harness validation: passed, with the pre-existing six-task-cap warning.
- Extension registry SHA-256 entries will cover the payload JSON and skill bundle files after the final manifest update.
- Project-root probe: system `yt-dlp` is available, `gallery-dl` is not installed, and no project extension lock exists; a separate temporary global extension runtime was installed for live adapter probes below.

## Live adapter probes

- Temporary global extension runtime `wf-search-deep/0.3.0` installed `yt-dlp 2026.08.19` and `gallery-dl 1.32.12` under `Harness/extensions`.
- YouTube public video: downloaded and merged MP4 through `wf-search-download.mjs`.
- Bilibili public video: downloaded and merged MP4 through the same yt-dlp adapter.
- X public video: downloaded MP4 through gallery-dl guest-token flow without cookies.
- TikTok public webpage: the original direct yt-dlp route returned an unexpected platform response, but the new `platform-tiktok` route was live-verified earlier with `@ssut/tiktok-api@1.5.2` selecting H264 and yt-dlp downloading a 3,288,875-byte MP4. A later repeat hit TikTok HTTP 429, so rate limiting remains an external boundary.
- User-owned VLM/ASR endpoint: switched the host to the vision profile, verified authenticated `/health` and multimodal `/v1/models`, ran a global frame pass plus local timestamp pass against a 158-second Bilibili robot video, and received grounded observations about SwingBot, wooden bars, safety net, 1 kg payload, and pulling disturbance. Switched to Whisper Large-v3 and received 7 English timestamped ASR segments, then restored the vision profile.
- GPT Researcher: PyPI 0.16.0 installed successfully into a short-path global runtime, but its import fails on an upstream `NameError` for missing `Any`/`List` imports; it is not marked usable or promoted into the success-derived skill contract.
- Search-provider router now validates and plans Tavily/Brave/Serper/SerpAPI/Exa/DuckDuckGo/SearXNG/Firecrawl/GitHub without exposing credentials; current local plan reports hosted credentials and self-hosted endpoints as unconfigured.

## Remaining boundary

- A real authenticated BrowserOS Neo run and live downloads from each target platform were not executed in this environment because the BrowserOS connector/session is unavailable here.
- TikTok now has a verified public skill route, but it must report HTTP 429/rate-limit failures and fall back to BrowserOS only when a connected user session exists. Authenticated comments and CAPTCHA handling were not proven here.
- The VLM switch path needs an operational fix: `ai switch vision` did not stop the active Minimax process, causing repeated CUDA OOM restarts; `ai minimax off && ai switch vision` produced a healthy vision service. This remote control-script issue is not embedded into wf-search.
- Whisper/VLM/research endpoints remain user-configured through `Harness/extensions/config.json`; no fixed machine/IP was added to wf-search.
- `npm run check:mirrors` and strict validation are not release-green because the remote legacy mirror is stale/404 and the repository already has six outer task capsules. These are unrelated to the media route implementation.
