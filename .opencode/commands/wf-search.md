---
description: Run research through the native wf CLI with optional capability extensions
---

# /wf-search

## Native CLI setup

Before invoking the commands below, check `pnpm exec wf --help` in the project. If `wf` is missing, tell the user to install it with `pnpm add --save-dev @zingspark/wf-cli@0.1.0`. Wait for explicit approval; do not install it automatically. After installation, rerun the check before continuing.

Run research through the native runtime:

- pnpm exec wf search --question "<question>" --mode auto --project . --json

This is a direct command. Do not invoke a skill, enter WF mode, or load Harness/MEMORY.md.
If the JSON result lists missing capabilities, report the corresponding
wf-extension install command and wait for explicit installation approval.

The only public research entrypoint is /wf-search. Video download, video
understanding, ASR, VLM, and platform adapters are optional CLI extensions.
