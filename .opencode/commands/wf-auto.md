---
description: Run perpetual adaptive auto-optimization via the wf-auto skill
---

# /wf-auto

This is a **workflow command**, not a direct command. Do not execute it as a
static help or script command.

1. Load `CLAUDE.md`, `Harness/MEMORY.md` (index only per Memory Preflight), then `Harness/README.md`.
2. Preserve cache-first order per `Harness/context-loading.md#Cache-First Context Contract`.
3. Execute per the skill adapter `.claude/skills/wf-auto/SKILL.md` (mirror: `.agents/skills/wf-auto/SKILL.md`).
4. Do not duplicate the workflow here. The skill adapter and `Harness/WF-AUTO.md` are authoritative.

If this runtime cannot invoke the skill directly, read
`.claude/skills/wf-auto/SKILL.md` and follow it in place.
