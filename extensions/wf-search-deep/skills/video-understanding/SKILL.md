---
name: video-understanding
description: Convert permitted video into timestamped transcript, visual, and comment evidence for wf-research.
---

# Video understanding skill

Use native captions first, then the configured user-owned Whisper Large
endpoint for timestamped ASR, then inspect bounded frame intervals with the
configured VLM. Return compact timestamped artifacts; never put the full media
blob into the research context. A claim without a valid timestamped artifact
is insufficient evidence.
