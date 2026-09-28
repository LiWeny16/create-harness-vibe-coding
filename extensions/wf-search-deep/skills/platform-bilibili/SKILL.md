---
name: platform-bilibili
description: Read Bilibili public video metadata, captions, and media evidence.
---

# Bilibili

Use yt-dlp through `media-download` for public video URLs after a health
probe. Prefer available captions; otherwise hand the downloaded media to
`video-asr`. Preserve BV/AV identity, uploader, title, and timestamped
evidence. Report region, login, or rate-limit failures instead of retrying
without bounds.

