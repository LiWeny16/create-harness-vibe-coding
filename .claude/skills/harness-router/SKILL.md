---
name: harness-router
description: Use at the start of any task, or when unsure which harness document applies. Keeps context small by routing to one primary doc.
---

# Harness Router

1. Read `Harness/README.md`.
2. Identify the current situation from "Load By Task".
3. Apply routing priority before loading extra files:
   - `/wf`, long, difficult, uncertain, repeated-failure, migration, architecture-heavy, browser-visible, or broad multi-agent implementation work routes to `wf-mode` first.
   - Bounded subagent-only coordination routes to `subagent-orchestrator`.
4. Load only the listed primary doc(s). Let `wf-mode` decide when to load subagent docs.
5. If the task grows, update `Harness/PLAN.md` and use `harness-context`.

Do not bulk-read `Harness/`.
