# @zingspark/wf-cli

The user-facing wf runtime is a small Rust binary distributed through
platform-selected pnpm optional dependencies. Agents invoke it through
pnpm exec wf; users do not need to type the underlying binary command.

The base binary contains deterministic runtime operations only. UI control,
media download, ASR, VLM, and platform adapters are installed as separate
extensions through wf extension install.

