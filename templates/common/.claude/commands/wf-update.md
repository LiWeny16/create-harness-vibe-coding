# /wf-update

Check for Harness scaffold updates from GitHub and apply them incrementally. Script-driven for speed — comparison happens in milliseconds, only conflicts need user decision.

## Required

- Load `wf-update` skill.
- Run `node Harness/scripts/wf-update-check.mjs` first (instant plan).
- For CONFLICT files: user decides [M]erge (recommended) / [O]verwrite / [K]eep.

## Check mode

`/wf-update --check` — Report available updates without applying.

## Full update

`/wf-update` — Script compares → AI resolves conflicts → Script applies SAFE+NEW.
