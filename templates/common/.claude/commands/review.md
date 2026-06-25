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

- If `codex` is available: use `codex exec` for code review
- If only `claude` is available: use `claude -p` for code review
- Try `codex exec` first, fall back to `claude -p`

## Flow

```text
CEO prepares context (diff + architecture docs + focus prompt)
→ Bash: codex exec "..."  (or claude -p "...")
→ CEO reads output
→ CEO presents findings + own analysis
```
