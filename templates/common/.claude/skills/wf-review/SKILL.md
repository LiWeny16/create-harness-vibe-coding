---
name: wf-review
description: Cross-model peer review. Invokes the other agent CLI (Codex or Claude) to independently review changes, architecture, or bug fixes. Use for /wf-review, peer review, second opinion, or when stuck.
---

# WF Review

Cross-model peer review via the OTHER agent CLI. Fresh eyes on your changes.

## Load

- `Harness/README.md` for project context
- Current diff or target files

## How It Works

1. **Detect runtime**: Check `which codex` and `which claude`
2. **Prepare context**: Gather diff (`git diff`), relevant architecture docs, the specific question
3. **Invoke the OTHER CLI** — the one we're NOT currently running under
4. **Read and synthesize**: Present the raw output, then add analysis

## CLI Commands

| Runtime | Review Command |
|---|---|
| Claude → Codex | `git diff \| codex exec "..."` (include full diff, not just commit message) |
| Codex → Claude | `git diff \| claude -p "..."` |
| Either (fallback) | try the other CLI; if only one installed, use it (still better than self-review) |

**Anti-self-review rule**: Detect which runtime we're in, then use the OTHER one. Never invoke the same CLI that's running the session.

## Context to Include

For a good review, pipe or include:
- `git diff` or `git diff --cached`
- Relevant `Harness/` docs (architecture.md, domain/ports.md if filled)
- The specific focus: "find bugs", "critique architecture from 4+ dimensions", "fix this bug", "check for security issues"

## Rules

- Never simulate or fake the review. The Bash tool MUST invoke the other CLI.
- If both CLIs fail, report the error — don't silently skip.
- Present the raw review output to the user before adding your own analysis.
- Distinguish between: the peer's findings (authoritative) and your interpretation (supplementary).

## Return

- Which CLI was used for review
- Raw review output
- CEO's synthesis and action items
