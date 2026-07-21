# Debug Protocol

Purpose: make debug work evidence-led and AC-traceable.

Debugging starts only after a reproduced failure or a concrete validation gap exists.

## Inputs

Debugger receives:

- failed AC ID
- failing command
- console output or stack trace
- screenshot, video, trace, or network capture when available
- relevant diff
- smallest relevant files or contracts

Debugger does not start from "try a fix." Debugger starts from "which layer failed?"

## Layer Classification

Classify the failure before editing:

| Layer | Evidence |
| --- | --- |
| UI | DOM missing, selector absent, wrong text, visual state wrong |
| API | request absent, wrong method/URL/payload, bad response handling |
| State | route/store/localStorage/session mismatch |
| Data | seed missing, fixture wrong, database not reset |
| Environment | server not running, port conflict, dependency missing |
| Test | selector wrong, race/flake, assertion not tied to AC |
| Contract | PRD/AC/API/UI contract conflict |

## Debug Loop

1. Reproduce or confirm the existing reproduction evidence.
2. Identify the failing layer and root cause hypothesis.
3. Edit only the smallest write set needed for that root cause.
4. Re-run the failed check.
5. Re-run adjacent checks that could regress.
6. Update the acceptance result matrix.

If the same class of failure repeats three times, stop blind fixes and run architecture review.

## Debug Handoff

```markdown
## Debug Handoff

- Failed AC: AC-002
- Failing command: `npx playwright test login.spec.ts --trace on`
- Layer: API
- Root cause: request payload sends `phoneNumber`; contract requires `phone`
- Fix set: `src/features/login/api.ts`
- Verification: command passed, trace path recorded
- Residual risk: none
```

## Forbidden

- Do not weaken or delete ACs to make tests pass.
- Do not rewrite tests from implementation behavior.
- Do not broadly refactor while fixing one reproduced failure.
- Do not claim browser/API success without browser/API evidence.
