# WF-AUTO Protocol Improvement Plan

## Objective

Replace the fixed eight-angle W0 scan with adaptive probe selection driven by
project risk, changed surface, evidence gaps, user value, novelty, and scan
cost. Preserve the WF acceptance chain and make exhaustion explainable.

## Acceptance Criteria

- AC-001: WF-AUTO references an adaptive coverage protocol instead of a fixed
  angle count.
- AC-002: The protocol defines probe selection, dynamic obligations, scan
  strategy rotation, confidence/coverage evidence, and an exhaustion gate.
- AC-003: The protocol includes common recipes for web/API, CLI/SDK,
  AI-agent/workflow, data/async, and documentation changes.
- AC-004: Root and template validators require the adaptive protocol file.
- AC-005: Root and template Skill mirrors load the adaptive protocol and no
  longer describe an eight-angle hard stop.

## Write Set

- `Harness/WF-AUTO.md`
- `Harness/WF-AUTO-ANGLES.md`
- `Harness/WF-AUTO-SPARK.md`
- `Harness/MEMORY.md`
- `Harness/README.md`
- `.agents/skills/wf-auto/SKILL.md`
- `.claude/skills/wf-auto/SKILL.md`
- `templates/common/**` mirrors
- validators and generator tests

## Verification

- `node --test tests/generator.test.js`
- `npm test`
- `node Harness/scripts/validate-harness.mjs --strict`
- local README/template link checks
