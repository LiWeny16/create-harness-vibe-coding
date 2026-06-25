# /wf-browser [task]

AI-driven browser automation via Browser Use (89.1% WebVoyager benchmark). Dual mode: CLI (~50ms per call, no LLM needed) + Python Agent API (multi-step AI reasoning).

## Required

- Load `wf-browser` skill.
- Load `Harness/workflows/browser-e2e.md` for evidence contract and fallback paths.
- Real-browser evidence required for every browser/UI claim (screenshot, state snapshot, or console output).

## Modes

**CLI (fast iteration):** `browser-use open/state/click/screenshot/close` — Claude Code reasons, CLI executes.
**Agent (complex flows):** Python API with LLM observation→decision→action loop.

## Flow

```text
open page → state (inspect elements)
→ click/input (interact)
→ state/screenshot (verify)
→ close (cleanup)
```

Keep browser evidence in `Harness/tasks/<task-id>/evidence/*.png`.
