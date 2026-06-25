# /wf-remove

Safely uninstall the Harness framework from this project. Uses `Harness/scripts/wf-remove.mjs` for fast, deterministic file classification. Auto-removes unmodified framework files. MUST ask user for every modified or uncertain file before deletion. NEVER touches user data.

## Required

- Load `wf-remove` skill.
- Run `node Harness/scripts/wf-remove.mjs` first (dry-run).
- For MODIFIED files: present each one, get explicit [D]elete / [K]eep decision.
- NEVER auto-delete user data or modified files.

## Flow

```text
node Harness/scripts/wf-remove.mjs          → DRY-RUN plan
  ├── SAFE files → list, auto-remove with --apply
  ├── MODIFIED files → present each, user decides D/K
  └── USER DATA → list, NEVER remove
node Harness/scripts/wf-remove.mjs --apply  → execute
git status → review
```

Full spec: `.claude/skills/wf-remove/SKILL.md`.
