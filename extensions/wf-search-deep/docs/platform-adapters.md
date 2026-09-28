# Platform Adapters

This reference defines the boundary for reading dynamic or authenticated
platforms. It is an adapter contract, not proof that a connector is available
in the current host. A platform is usable only after its tool succeeds in the
current run and its operation is recorded in the ledger.

## Route selection

| Platform family | First choice | Browser fallback | Typical evidence |
| --- | --- | --- | --- |
| GitHub, Reddit | official API or CLI | user-designated browser | repository/post URL, author, timestamp, issue/comment body |
| YouTube, Bilibili | official/public metadata and captions | BrowserOS Neo for rendered or account-scoped pages | video URL, title, uploader, published time, captions/transcript status |
| X, Instagram, Xiaohongshu | official API when configured | BrowserOS Neo with the user's existing session | post URL, author, visible text, published time, access scope |
| TikTok | `platform-tiktok` skill (`@ssut/tiktok-api` metadata/format discovery, then yt-dlp) | BrowserOS Neo with the user's existing session | video URL, author, metadata, media/transcript status, access scope |

Prefer the route with the strongest source type and the smallest access scope.
Do not turn a browser session into an unbounded crawler. API rate limits,
login walls, regional availability, robots/terms, and platform changes remain
limitations to report.

## BrowserOS Neo contract

When a user-designated BrowserOS Neo connection is actually available:

1. Create or reuse a task-owned tab/session; do not inspect other tabs.
2. Snapshot the visible page, then act, then snapshot again to verify the
   result. Extract only visible, task-relevant fields.
3. Set bounds before scrolling: maximum pages/items, scrolls, elapsed time,
   and retries. Record the bounds in `constraints`.
4. Stop and record a limitation on CAPTCHA, 429, login expiry, region block,
   or an unexpected challenge. Never bypass the challenge.
5. Return URLs and evidence records to the Agent. The Agent receives a tab
   handle or extracted evidence, never raw cookies, `document.cookie`, an
   auth header, or a HAR/network body.

An operation should identify the adapter explicitly, for example
`BrowserOS Neo:xiaohongshu`, and record `success`, `failed`, or `unavailable`.
If BrowserOS Neo is not connected, do not claim that browser extraction ran;
use an official/API or public-page fallback and report the gap.

## Evidence minimum

For every platform item, retain the canonical URL, title or text excerpt,
author/uploader when visible, published time when visible, retrieval time,
account/access scope, and any failure code. Keep raw page dumps and private
session data out of the research report.


