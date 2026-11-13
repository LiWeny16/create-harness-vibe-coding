# @zingspark/wf-extension-search-deep

Deep source-diverse research bundle for the Harness `wf search` runtime.
Optional package extension; never installed by default.

## What it contains

This package is a pure payload bundle — no executable, no postinstall. The
`wf` CLI routes a research question into a plan; the agent controller loads
only the skills it needs, lazily, from this bundle.

| File | Purpose |
|---|---|
| `extension.json` | Extension manifest: id, capabilities, platforms |
| `workflow.json` | collect → understand → decide → output research stages, video policy |
| `agent.json` | Subagent profile and context boundaries |
| `skills/manifest.json` | 14 lazy-loaded skills (platform readers, media download, ASR, VLM, evidence scoring) |
| `toolchain.json` | Optional runtime tools (GPT Researcher, STORM, Whisper) and install roots |
| `search-providers.json` / `source-catalog.json` | Provider routing and source catalog |
| `docs/` | Evidence contract, platform adapters, video research patterns |

## Install

```bash
pnpm exec wf extension install wf-search-deep --project . --apply
# or directly:
pnpm add --save-dev @zingspark/wf-extension-search-deep@0.1.0
```

Requires the native runtime: `pnpm add --save-dev @zingspark/wf-cli@0.1.0`.

Heavy optional tools (yt-dlp, gallery-dl, Whisper backends, VLM endpoints,
browser sessions) are user-provided and described in `toolchain.json` and the
skill manifests — nothing is downloaded at install time.

## Result contract

Stable output contract: `wf-research/result.v1` (see `docs/evidence-contract.md`).
