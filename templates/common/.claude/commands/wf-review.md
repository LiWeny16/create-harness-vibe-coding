# /wf-review [focus]

Cross-model peer review. Invokes the OTHER agent CLI to review changes from a fresh perspective.

## How it works

1. Detect which runtime we're running under
2. Prepare context: diff, relevant files, architecture docs, problem description
3. Pipe to the OTHER CLI for independent review
4. Synthesize the response

## Required

- Load `wf-review` skill.
- MUST use `Bash` to invoke the other CLI — never simulate or fake the review.
- Present the raw review output to the user, then add your own analysis.

## CLI Detection

- Check `which codex && echo CODEX || echo NO_CODEX` to detect Codex
- Check `which claude && echo CLAUDE || echo NO_CLAUDE` to detect Claude
- Use the OTHER CLI — the one NOT running this session. Never self-review.
- If only one CLI is available: warn, then use it (single-model review is better than none).

## Flow

```text
CEO prepares context (diff + architecture docs + focus prompt)
→ Bash: codex exec "..."  (or claude -p "...")
→ CEO reads output
→ CEO presents findings + own analysis
```
