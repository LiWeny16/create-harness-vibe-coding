---
name: video-vlm
description: Inspect selected video frames and return compact timestamped visual evidence.
---

# Video VLM

Use ffmpeg to sample only the intervals needed to answer the question, then
call the configured OpenAI-compatible VLM endpoint through host configuration.
The bundled `run.mjs` performs a global uniform pass followed by a bounded
local pass; it uses `localPassSeconds` from the first response when valid and
falls back to middle timestamps. Describe visible facts, on-screen text, and
uncertainty with timestamps; do not infer unseen frames. Return compact visual
segments rather than sending the full video or a long frame dump to the
research agent.

The endpoint and model come from `--endpoint`/`--model` or
`Harness/extensions/config.json`; the API key stays in
`WF_SEARCH_VLM_API_KEY`/`OPENAI_API_KEY`. No host, port, cookie, or key is
embedded in the skill. Example:

```text
node skills/video-vlm/run.mjs --input <video> --endpoint <base-or-chat-completions-url> --model <model> --question "Where does the key action happen?"
```
