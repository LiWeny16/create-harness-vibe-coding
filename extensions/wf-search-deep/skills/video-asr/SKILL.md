---
name: video-asr
description: Convert speech in downloaded media into compact timestamped transcript evidence.
---

# Video ASR

Prefer platform captions when they are complete and attributable. Otherwise
send the media or an extracted audio stream to the configured Whisper Large
backend through the host's backend configuration; do not embed a machine,
IP, port, cookie, or secret in this skill. Return bounded segments with
`startMs`, `endMs`, and text, plus language/model metadata. Mark uncertain or
overlapping speech rather than inventing words.

