---
description: Run method-neutral, evidence-first wf-review via the wf-review skill
---

# /wf-review

This is a **workflow command**, not a direct command. Do not execute it as a
static help or script command.

1. Load `CLAUDE.md`, `Harness/MEMORY.md` (index only per Memory Preflight), then `Harness/README.md`.
2. Preserve cache-first order per `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`.
3. Follow `.claude/skills/wf-review/SKILL.md` (mirror: `.agents/skills/wf-review/SKILL.md`) for risk-based independent review, targeted challenge, and evidence adjudication.
4. The skill owns the review strategy; do not duplicate its process here.

If this runtime cannot invoke the skill directly, read
`.claude/skills/wf-review/SKILL.md` and follow it in place.
