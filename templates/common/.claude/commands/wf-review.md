# /wf-review [focus]

Cross-model peer review. Invokes the OTHER agent CLI for independent multi-dimension review.

## Anti-Self-Review Guard

**Use the OTHER CLI.** Claude → `codex exec`. Codex → `claude -p`. Only one CLI? Warn user, do NOT self-review.

## Required

- Load `wf-review` skill (authoritative: dimensions, severity, synthesis format).
- Detect CLI: `which codex` / `which claude`. Use the one NOT running this session.
- `Bash` invoke the other CLI — never simulate.
- Present raw output + classified synthesis.

## Flow

```text
diff + architecture docs + 5-dimension prompt (from skill)
→ Bash: codex exec "..." or claude -p "..."
→ classify findings (Critical/High/Medium/Low per skill severity table)
→ raw output + synthesis + action items
```

Context guard: if `git diff` >500 lines, warn and suggest narrowing scope.
