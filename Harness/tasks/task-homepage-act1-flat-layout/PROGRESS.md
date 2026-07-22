# PROGRESS — task-homepage-act1-flat-layout

## Status
- Phase: Implementation
- Gate: CONTRACT-GATE passed (intent locked via 3 user decisions; writeSet + 5 edits specified in PLAN).
- Next: dispatch implementer for E1–E4b, then browser-verify AC1–AC6.

## Heartbeat
- 2026-07-22: Intake done. User wants Act 1 = 5 flat staggered boxes, zero tilt, no float, no singled-out openable box; Act 2 behavior preserved. Code map complete (hero=Act1, theater=Act2; box0 singled out via selectedStage=0 + createStageCube(i,i===0); cluster tilted -24° + bob at hero). 5 surgical edits defined.

## Changes
(pending implementer)

## Verification
(pending browser evidence)

## Decisions / Assumptions
- selectedStage stays 0 (needed for detail-panel default text); only the 3D visual singling-out is neutralized at hero.
- Lid-open already gated to spread>0.28 → already Act-2-only; no change needed to lid logic itself.
- Stagger pattern = zig-zag (high/low alternating); tunable in browser.
