---
description: Run the README preservation and improvement workflow via the wf-readme skill
---

# /wf-readme

This is a **workflow command**, not a direct command. Do not execute it as a
static help or script command.

1. Load `CLAUDE.md`, `Harness/MEMORY.md` (index only per Memory Preflight), then `Harness/README.md`.
2. Preserve cache-first order per `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`.
3. Execute per the skill adapter `.claude/skills/wf-readme/SKILL.md` (mirror: `.agents/skills/wf-readme/SKILL.md`).
4. Do not duplicate the workflow here. The skill adapter and the project root \`README.md\` ownership rules are authoritative.

If this runtime cannot invoke the skill directly, read
`.claude/skills/wf-readme/SKILL.md` and follow it in place.
