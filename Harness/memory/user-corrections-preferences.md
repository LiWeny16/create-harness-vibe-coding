# User Corrections And Preferences

Purpose: record repeated user corrections, durable preferences, and common-sense course corrections.

Write here when:
- The user says "remember", "never", "next time", "always", "I prefer", "记住", "下次", "不要再" etc.
- Explicit, safe, scoped user preferences can be written immediately without `/wf-learn`.
- The user corrects the same assumption/pattern 2+ times.
- A correction changes how future work should be scoped, explained, verified, or handed off.

Entry format (compact, default no date):

```markdown
- When <scenario>: <rule>. Avoid <over-application>. Signals: <signals>.
```

Only use date/timestamp headings when:
- Entry supersedes prior conflicting guidance
- Time-sensitive context (version, deprecation)
- Conflict resolution needed

Do not record ordinary chat, task logs, process summaries, one-time emotions, or transient preferences. If the preference is ambiguous, ask before writing it. Never store secrets.
- Entry supersedes prior conflicting guidance: add date stamp.

## 2026-07-22

- When preparing Harness updates or releases: keep `LiWeny16/create-harness-vibe-coding` plus npm as the canonical install/update source, but always sync `zingspark/create-harness-vibe-coding` as the legacy compatibility mirror before considering the release done. Low-version installs may have updater scripts hardcoded to the legacy mirror, so dropping or ignoring it strands those users. Avoid pointing new generated installs at the legacy mirror; it is a compatibility mirror, not the canonical source. Signals: release, publish, update-source, `/wf-update`, mirror, old installs.
