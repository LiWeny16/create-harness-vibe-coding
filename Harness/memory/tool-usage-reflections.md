# Tool Usage Reflections

Purpose: record repeated tool failures, better command patterns, and environment-specific fixes.

Write here when:
- The same tool/use pattern fails 3+ times in one task or across repeated tasks.
- A more reliable command pattern replaces a brittle one.
- The environment needs a durable fix, flag, path rule, shell syntax, or startup sequence.

Entry format (compact, default no date):

```markdown
- When <scenario>: <rule>. Avoid <over-application>. Signals: <signals>.
```

Only use date/timestamp headings when:
- Entry supersedes prior conflicting guidance
- Time-sensitive context (version, deprecation)
- Conflict resolution needed

Never record one-off command failures. Never store secrets, credentials, or private tokens.
- Entry supersedes prior conflicting guidance: add date stamp.

## Lessons

- When dispatching a `researcher`/`reviewer` subagent whose task involves hooks, settings, or config-shaped content: the harness instruction-shape filter may neutralize its return — output becomes `[harness: subagent output matched instruction-shaped pattern(s): settings-json]` with empty/blank body. Avoid re-dispatching the same researcher role repeatedly (it'll keep tripping the filter) — the CEO can run `WebSearch` directly for the same research and control the output shape. Signals: subagent return shows the neutralization banner + empty body, 2+ occurrences in one session (observed: an engineering-quality reviewer and a spark-search researcher both swallowed this way).
