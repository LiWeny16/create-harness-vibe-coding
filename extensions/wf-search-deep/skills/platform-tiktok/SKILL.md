---
name: platform-tiktok
description: Read public TikTok video metadata and download permitted video media through the GitHub-backed API adapter and yt-dlp.
---

# TikTok platform skill

Use this skill only when the research question includes a TikTok URL or
TikTok-specific discovery. It is an extension skill, not part of the built-in
wf-search core.

## Verified route

1. Ensure the global `tiktok-api` and `yt-dlp` adapters are installed and pass
   their doctor checks.
2. Run `run.mjs` with the original TikTok URL. The skill uses
   `@ssut/tiktok-api` to select an H264 media format and delegates the actual
   file download to the shared yt-dlp adapter.
3. Pass only the compact metadata artifact and the downloaded file path to the
   research subagent. Never pass or persist the signed CDN URL.

The public video-to-MP4 route has been live-verified. Account-scoped pages,
comments, CAPTCHA, rate limits, and regional blocks still require BrowserOS
Neo or another user-authorized session and must be recorded as limitations.

## Runtime

```text
node skills/platform-tiktok/run.mjs \
  --url <tiktok-url> \
  --output-dir <run-dir> \
  --runtime-root <global-extension-runtime> \
  --json
```

The runtime is global under `Harness/extensions`; raw cookies and provider
credentials are never accepted by this skill.
