---
name: wf-search
description: "Thin Agent adapter for the native wf search runtime. Optional CLI extensions provide media, video, ASR, VLM, and platform capabilities."
---

# WF-SEARCH

Before using the CLI, check `pnpm exec wf --help` in the project. If `wf` is missing, tell the user to install it with `pnpm add --save-dev @zingspark/wf-cli@0.1.0`; wait for explicit approval and verify the CLI again after installation.

The public research entrypoint is wf-search. Do not load a second research
skill and do not paste media, video, ASR, VLM, or platform implementation
details into the Agent context.

Call the native runtime first:

- pnpm exec wf search --question "<question>" --mode auto --project . --json

The CLI returns a compact plan with required extension ids. If an optional
capability is missing, use the wf-extension adapter to request an explicit
installation, then retry. Never silently download a large runtime.

Base responsibilities:

1. Normalize the user's question and mode.
2. Call the CLI and inspect its JSON result.
3. Install only explicitly approved registered extensions.
4. Return the CLI's evidence/report artifact paths and limitations.

The CLI owns source routing, evidence ledgers, validation, rendering, media
downloads, transcription, visual understanding, and platform adapters. Use
wf-search/result.v1 for the stable result contract. Legacy helper modules may
remain as internal migration code; they are not public commands or skills.
