---
description: Use the optional wf-ui runtime through the native wf CLI
---

# /wf-ui

## Native CLI setup

Before invoking the commands below, check `pnpm exec wf --help` in the project. If `wf` is missing, tell the user to install it with `pnpm add --save-dev @zingspark/wf-cli@0.1.0`. Wait for explicit approval; do not install it automatically. After installation, rerun the check before continuing.

This remains a direct command adapter. Do not invoke a skill for this command.

wf-ui is an optional CLI extension and is not installed by default.

Use:

- pnpm exec wf extension status wf-ui --project . --json
- pnpm exec wf extension install wf-ui --project . --apply --json
- pnpm exec wf ui start --project . --json

Do not enter WF mode from this adapter. Require explicit installation before
starting the UI runtime and return only compact JSON/session references.
