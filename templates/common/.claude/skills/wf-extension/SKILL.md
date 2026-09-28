---
name: wf-extension
description: "Thin Agent adapter for the native pnpm/Rust wf extension manager."
---

# WF-EXTENSION

Before using the CLI, check `pnpm exec wf --help` in the project. If `wf` is missing, tell the user to install it with `pnpm add --save-dev @zingspark/wf-cli@0.1.0`; wait for explicit approval and verify the CLI again after installation.

Use the native CLI for optional capabilities. The skill is intentionally small:
it does not contain UI, browser, media, ASR, VLM, or platform implementation
details.

Commands:

- pnpm exec wf extension list --json
- pnpm exec wf extension status <id> --json
- pnpm exec wf extension install <id> --apply --json
- pnpm exec wf extension download <id> --json
- pnpm exec wf extension remove <id> --apply --json
- pnpm exec wf extension doctor --json

Only install registered extensions. Require explicit approval for --apply.

