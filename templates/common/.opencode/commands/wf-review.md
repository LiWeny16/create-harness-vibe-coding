---
description: Run cross-model peer review via the wf-review skill
---

# /wf-review

This is a **workflow command**, not a direct command. Do not execute it as a
static help or script command.

1. Load `CLAUDE.md`, `Harness/MEMORY.md` (index only per Memory Preflight), then `Harness/README.md`.
2. Execute per the skill adapter `.claude/skills/wf-review/SKILL.md` (mirror: `.agents/skills/wf-review/SKILL.md`).
3. Do not duplicate the workflow here. The skill adapter and the wf-review cross-model contract are authoritative.

If this runtime cannot invoke the skill directly, read
`.claude/skills/wf-review/SKILL.md` and follow it in place.
