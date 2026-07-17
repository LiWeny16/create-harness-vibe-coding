---
description: Run safe harness removal via the wf-remove skill
---

# /wf-remove

This is a **workflow command**, not a direct command. Do not execute it as a
static help or script command.

1. Load `CLAUDE.md`, `Harness/MEMORY.md` (index only per Memory Preflight), then `Harness/README.md`.
2. Execute per the skill adapter `.claude/skills/wf-remove/SKILL.md` (mirror: `.agents/skills/wf-remove/SKILL.md`).
3. Do not duplicate the workflow here. The skill adapter and `Harness/scripts/wf-remove.mjs` are authoritative.

If this runtime cannot invoke the skill directly, read
`.claude/skills/wf-remove/SKILL.md` and follow it in place.
