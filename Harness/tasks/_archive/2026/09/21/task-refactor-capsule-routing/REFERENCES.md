# task-refactor-capsule-routing - REFERENCES

## Evidence

| What | Pointer | Verified |
|------|---------|----------|
| Canonical state and resume contract | Harness/specs/workflows/WF-STATE.md | yes |
| Archive safety and retention contract | Harness/specs/protocols/TASK_ARCHIVE.md | yes |
| Role-scoped bounded context contract | Harness/specs/runtime/context-loading.md; Harness/scripts/task-context.mjs | yes |
| Current route ambiguity | Harness/PROGRESS.md; `task-state list --json` | yes |

## Notes

Route is derived state. Do not add a second task database or expose full archive contents by default.
