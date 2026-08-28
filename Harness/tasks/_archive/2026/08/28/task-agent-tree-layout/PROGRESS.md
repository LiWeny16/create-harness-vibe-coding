# task-agent-tree-layout - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived

## User requirements (2026-08-14/17)

- Round 2: compact agent-centric layout — main centered anchor, subagents one layer
  below as an agent TREE, scattered nodes as matrix bands ABOVE agents; never
  create/modify edges. Plus 409 merge-replay + clipboard image paste.
- Round 3: better edge routing algorithm; connection icon must not stack above
  node cards.

## Completed

- W1-W4 (round 2): agentTreePositions engine + server mode 'agent-tree' + client
  mode switch + 409 merge-replay + image paste (see git history / earlier heartbeat).
- Round-3a channel trunks: edgeRoutingFromNodes (free gutters between node bands
  per axis + node rects); bridgeStepPath picks channel trunk over naive midpoint.
- Round-3b dogleg routing: when a THIRD node still blocks the channeled 3-segment
  path (e.g. source/target stacked behind a card), route a 5-segment dogleg through
  a clear swing column/row — depart the port outward, approach the target port from
  its own side; source/target rects never count as blockers. filletedPolylinePath
  emits the 8px-fillet polyline; label midpoint via orthogonalPathMidpoint.
- Round-3c z-index fix: edge-label layer default z 30 (below nodes layer 360) so
  icons never paint over cards; .has-selected-edge on the canvas raises it back to
  420 while any edge is selected (drag/click preserved).
- Round-3d center/top-left semantics fix (own defect from round 2):
  agentTreePositions now emits TOP-LEFT positions (origin.x anchors main's CENTER);
  unit tests A1-A11 + L8 HTTP expectations updated. Real graph: main center 260,
  sub row centers 884/260/-364 → row center 260 — properly centered now.
- renderMarkdown.ts: TS2722 fix (possibly-undefined fence rule invocation) — build
  blocker from concurrent work, minimal guard added.

## Verification (all green, after concurrent-agent merge)

- Server: agent-tree A1-A11 + tidy T1-T13 + G1-G5 + workflow-layout L1-L8 = 47/47.
- UI: tsc 0; vite build ok; e2e m9 4/4 (AC-002 agent-centric tidy, AC-001 create
  no-overlap x2, NEW AC-004 dogleg + z-index two-state: label below nodes default,
  above when selected).
- Regression: m4-magnetic + m4-interactions 11/11.
- Real-graph engine check (4 agents 560x358 + component/timer/goal, 3 bridges):
  overlaps 0, min clearance 48, bands above/main centered/sub row centered.

## Notes

- Dogleg is best-effort: port-adjacent edge cases (a node spanning the whole band
  between ports) fall back to the channeled direct path — full obstacle-avoiding
  (A*) deliberately deferred.
- Concurrent agent node active in this worktree (server.mjs/WorkflowRoute.tsx
  touched mid-round); all markers verified present post-merge, tests re-run green.
- Nothing committed (per rules). Working tree holds all changes.
