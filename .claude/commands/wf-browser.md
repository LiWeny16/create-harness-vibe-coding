---
description: Run agent-operable browser architecture and runtime control through BrowserOS Neo via the wf-browser skill
---

# /wf-browser

This is a **workflow command**, not a direct command. Do not execute it as a
static help or script command.

1. Load `CLAUDE.md`, `Harness/MEMORY.md` (index only per Memory Preflight), then `Harness/README.md`.
2. Preserve cache-first order per `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`.
3. Execute per the skill adapter `.claude/skills/wf-browser/SKILL.md` (mirror: `.agents/skills/wf-browser/SKILL.md`).
4. BrowserOS Neo must be connected before browser-visible work. If it is unavailable, tell the user to download, install, and start it manually; never download or install it automatically.
5. Do not duplicate the workflow here. The skill adapter and `Harness/specs/protocols/HARNESS_BRIDGE.md` are authoritative.

If this runtime cannot invoke the skill directly, read
`.claude/skills/wf-browser/SKILL.md` and follow it in place.
