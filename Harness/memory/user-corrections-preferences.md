# User Corrections And Preferences

Purpose: record repeated user corrections, durable preferences, and common-sense course corrections.

Write here when:
- The user says "remember", "never", "next time", "always", or "I prefer".
- The user corrects the same assumption/pattern 2+ times.
- A correction changes how future work should be scoped, explained, verified, or handed off.

Entry format, newest first:

```markdown
## YYYY-MM-DD - Short Preference Name

- Correction/preference: the durable instruction.
- Trigger: what prompted the correction.
- Apply when: future contexts where this should guide behavior.
- Avoid: contexts where this should not be over-applied.
```

Do not record ordinary chat. If the preference is ambiguous, ask before writing it. Never store secrets.

## 2026-07-01 - Do Not Use docs For Harness Files

- Correction/preference: Scaffold-owned Harness documentation and workflow files must live under root `Harness/` and template source `templates/common/Harness/` or optional `templates/optional/**/Harness/workflows/`; do not place Harness files under `docs/`.
- Trigger: User corrected the install-scaffold design: "docs directly abandon, do not put it under docs folder."
- Apply when: Creating, moving, generating, packaging, or documenting Harness scaffold files.
- Avoid: Do not over-apply to project-owned `docs/` folders in target applications; those remain project facts to preserve, but Harness should not write there.

## 2026-06-26 - Explicit /wf and /wf-max ALWAYS fan out subagents

- Correction/preference: When the user explicitly types `/wf`, `/wf-max`, `wf mode`, or `wk mode`, subagent fan-out is MANDATORY and UNCONDITIONAL. File count, task size, and overhead are IRRELEVANT for explicit invocation — they govern only AUTO-triggering. A 1-file `/wf-max` still fans out. "Degrade to /wf" changes organization (flat vs CEO→Manager→Worker), never the fact of fan-out. There is NO path from an explicitly typed command to a solo main-thread pass. The CEO must also NOT do W0 exploration itself by reading source files — dispatch read-only explorers in one batch.
- Trigger: User invoked `/wf-max` on a small task; I front-loaded CEO paperwork (PLAN/PROGRESS/self-audit) and read source files myself instead of immediately dispatching subagents. User corrected this twice, noting the "files < 5 → degrade" wording was being misread as "go solo."
- Apply when: ANY explicit WF/WK/wf-max invocation, regardless of how trivial the task looks. Dispatch subagents fast; minimize CEO ceremony before the first fan-out.
- Avoid: Do not apply the file-count thresholds to explicit invocation. Those thresholds only decide whether to AUTO-enter WF mode.
