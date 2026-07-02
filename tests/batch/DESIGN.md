# Batch Integration Test Design

## Goal
Verify all /wf-* commands, hook enforcement, mode detection, and memory capture
in real project environments. Not unit tests — full lifecycle simulations.

## Test Matrix (12 scenarios)

| # | Command | What It Tests | Success Criteria |
|---|---------|---------------|------------------|
| 1 | `/wf-max fix bug` | Hook writes mode file, SessionStart injects CEO, PreToolUse blocks Edit | mode=wf-max, agentRole=ceo, Edit blocked |
| 2 | `/wf-max` + Worker dispatch | Worker with writeSet can edit, outside writeSet blocked | writeSet allow/deny correct |
| 3 | `/wf-max` + CEO escalate | CEO escalates after 3 failures, can write escalated file, deescalate works | escalation flow correct |
| 4 | `/wf-auto-spark fix` | Hook writes mode file, SessionStart injects SPARK context | mode=wf-auto-spark, phase=SPARK |
| 5 | `/wf-auto optimize` | Hook writes mode file, SessionStart injects AUTO context | mode=wf-auto, phase=AUTO |
| 6 | `/wf fix bug` | Hook writes mode file, SessionStart injects WF context | mode=wf, phase=W0_EXPLORE |
| 7 | `/wf-review code` | Hook writes mode file, SessionStart injects REVIEW context | mode=wf-review |
| 8 | `/wf-learn` | Hook writes mode file, SessionStart injects LEARN context | mode=wf-learn |
| 9 | SessionStart stale clear | Mode file >30min old → auto-cleared | active=false after stale SessionStart |
| 10 | PostToolUse error capture | Error in tool output → written to memory/ | reflections.md updated |
| 11 | Goal persistence | goal set → survives SessionStart → goal complete clears | goals.json lifecycle |
| 12 | Cross-mode transition | /wf-max → /wf (wf overrides wf-max) | mode switches correctly |

## Test Harness Architecture

```
tests/batch/
├── DESIGN.md          ← this file
├── runner.mjs         ← main test orchestrator
├── fixtures/          ← minimal test projects
│   ├── empty/         ← empty dir + npm init
│   ├── node-app/      ← simple Node.js app
│   └── react-app/     ← minimal React app
├── scenarios/         ← one file per test scenario
│   ├── 01-wf-max-ceo.mjs
│   ├── 02-wf-max-worker.mjs
│   ├── ...
│   └── 12-cross-mode.mjs
└── harness/           ← shared test utilities
    ├── setup.mjs      ← install harness on project
    ├── simulate.mjs   ← simulate tool calls through hook
    └── verify.mjs     ← assert mode file, memory file, hook output
```

## How Each Scenario Works

```
1. Create fresh project copy from fixtures/
2. Install harness: node bin/create-harness-vibe-coding.js <dir> -y --on-conflict skip
3. Simulate user command through UserPromptSubmit hook
4. Check mode file (current-mode.json)
5. Simulate tool calls through PreToolUse hook
6. Check hook output (block/allow)
7. Simulate SessionStart
8. Check context injection text
9. Cleanup
```

## Verification Commands

```bash
# Run all batch tests
node tests/batch/runner.mjs

# Run specific scenario
node tests/batch/runner.mjs --scenario 01

# Run with verbose output
node tests/batch/runner.mjs --verbose
```
