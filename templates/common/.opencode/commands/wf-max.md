---
description: Run the WF-MAX maximum-safe-parallelism workflow via the wf-max skill
---

# /wf-max

This is a **workflow command**, not a direct command. Do not execute it as a
static help or script command.

1. Load `CLAUDE.md`, `Harness/MEMORY.md` (index only per Memory Preflight), then `Harness/README.md`.
2. Preserve cache-first order per `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`.
3. Execute per the skill adapter `.claude/skills/wf-max/SKILL.md` (mirror: `.agents/skills/wf-max/SKILL.md`).
4. Do not duplicate the workflow here. The skill adapter and `Harness/specs/workflows/WF-MAX.md` are authoritative.

If this runtime cannot invoke the skill directly, read
`.claude/skills/wf-max/SKILL.md` and follow it in place.
