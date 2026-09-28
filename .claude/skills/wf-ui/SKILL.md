---
name: wf-ui
description: "Thin Agent adapter for the optional wf-ui CLI extension."
---

# WF-UI

Before using the CLI, check `pnpm exec wf --help` in the project. If `wf` is missing, tell the user to install it with `pnpm add --save-dev @zingspark/wf-cli@0.1.0`; wait for explicit approval and verify the CLI again after installation.

wf-ui is not part of the default Harness runtime. It is an optional extension
because the browser control plane, server, frontend assets, screenshots, and
session artifacts are high-volume.

This is a direct command adapter and Codex compatibility shim; it does not
contain the UI implementation.

Use the native CLI:

- pnpm exec wf extension status wf-ui --project . --json
- pnpm exec wf extension install wf-ui --project . --apply --json
- pnpm exec wf ui start --project . --json
- pnpm exec wf ui status --project . --json
- pnpm exec wf ui inspect --project . --json

The skill only interprets user intent, requests explicit installation, and
explains the returned URL/session/artifact references. UI tree, browser bridge,
leases, action protocols, server lifecycle, and evidence storage belong to the
installed extension. Do not load the extension implementation into base
context.
