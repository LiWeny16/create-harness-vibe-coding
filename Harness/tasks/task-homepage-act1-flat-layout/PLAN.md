# PLAN — task-homepage-act1-flat-layout

## Goal
Redesign the homepage **Act 1 opening frame** (hero zone, scroll progress = 0) in `docs/index.html`:
5 flat boxes in an **orderly staggered (错落) zig-zag arrangement, zero tilt, no floating**, with **no singled-out "openable/floating" box** at rest. The 2D→3D tilt, depth, spread, and lid-open behavior must remain and emerge progressively as the user scrolls toward Act 2 (theater).

## User decisions (locked)
1. Act 1 first frame = **pure flat staggered, zero tilt** (30° tilt + 3D depth grow only on scroll).
2. **5 boxes** (not 3) — keep count.
3. Scope = **layout + remove the openable/floating singled-out box from Act 1** (keep that behavior for Act 2).

## Non-goals
- Do NOT change Act 2 (theater) openable/lid/spotlight/click behavior.
- Do NOT change `stages` content/labels, detail panel DOM, theme, or scroll-wipe.
- Do NOT add the 30° tilt at Act 1 (that is a scroll-driven emergence, out of scope for the static first frame).
- No new libraries; Three.js + GSAP only.

## Acceptance Criteria
- **AC1 (positions):** At scroll=0, the 5 boxes form a staggered/zig-zag arrangement (alternating high/low), not the old symmetric arc.
- **AC2 (flat + zero tilt + no float):** At scroll=0, the cluster has no visible yaw/pitch tilt and no auto-bob/floating motion (boxes are static, face-on, thin slabs).
- **AC3 (no singled-out box):** At scroll=0, all 5 boxes render identically — same scale, same (idle) materials, payloads tucked, lids closed. Box 0 is NOT bigger/brighter.
- **AC4 (transition preserved):** Scrolling down progressively introduces tilt, 3D depth (module scale grows), spread to theater positions, and the active/lid-open behavior — visually unchanged from current behavior by mid-scroll and in Act 2.
- **AC5 (no regressions):** Act 2 spotlight, lid-open on focused box, click/hover selection, detail panel text, and theme/scroll-wipe all still work.
- **AC6 (evidence):** Real-browser screenshots at scroll=0 (Act 1), ~transition, and theater (Act 2) recorded.

## WriteSet
- `docs/index.html` (only file). Edits confined to the `<script type="module">` 3D scene.

## Edits (surgical, exact)

**E1 — Staggered flat positions** (`heroFlatPositions`, ~lines 1820-1823). Replace symmetric arc with zig-zag:
```js
const heroFlatPositions = [
  [-2.7, 0.34, 0.1], [-1.35, -0.12, 0.06], [0, 0.34, 0.1],
  [1.35, -0.12, 0.06], [2.7, 0.34, 0.1]
];
```

**E2 — Gate whole-cluster tilt + bob by scroll depth** (~lines 2295-2296). Hoist `heroDepth` (currently ~line 2303) above these lines, then multiply every term by `heroDepth` so tilt/parallax/bob are 0 at hero and ramp in on scroll:
```js
var heroDepth = smoothstep(Math.max(smoothHeroDepth, smoothSpread));
group.rotation.y = heroDepth * (-0.42 + smoothSpread * 0.24) + mouse.x * 0.05 * heroDepth + Math.sin(frame) * 0.014 * heroDepth;
group.rotation.x = heroDepth * (-0.16 + smoothSpread * -0.08) + mouse.y * 0.035 * heroDepth + Math.cos(frame * 0.78) * 0.01 * heroDepth;
```
Remove the now-duplicate `var heroDepth = ...` declaration at the old location (keep one declaration).

**E3 — Gate per-box float bob by depth** (~line 2317):
```js
node.position.y = heroY + (ty - heroY) * spread + Math.sin(frame * 2 + i) * depth * 0.025;
```
(was `* (0.012 + depth * 0.013)` → at depth=0 the bob is now 0; at depth=1 ≈ same magnitude.)

**E4a — No active box at hero** (~line 2323):
```js
var visualActive = smoothSpread > 0.28 && i === focusIndex;
```
(was `i === focusIndex`. This neutralizes the bigger activeScale + payload pop + lid at hero; they return in Act 2 where spread > 0.28.)

**E4b — No pre-highlighted box 0** (~line 1835):
```js
var node = createStageCube(i, false);
```
(was `createStageCube(i, i === 0)`. All boxes start with idle/equal materials. Theater still gets active materials via scroll-driven `selectStage(...,'scroll')` → `updateVisualMaterials`.)

## Verification (manual / browser — no test framework for static visual page)
1. Serve `docs/` locally; open in Chromium.
2. Screenshot at scroll=0 → check AC1/AC2/AC3 (staggered, flat, still, equal boxes).
3. Screenshot mid-scroll → check AC4 (tilt + depth emerging).
4. Scroll into theater → check AC5 (lid opens on focused box, spotlight, click selects, detail text updates).
5. If the flat staggered look needs tuning (camera `camY`/`lookX`/`groupScale` at hero, or position values), iterate — these are in-scope visual tuning, not new behavior.

## Risks
- Camera framing (camY=4.18 looks slightly down) may make flat slabs read oddly face-on → may need minor hero camera tuning (in-scope, AC verify loop).
- Hoisting `heroDepth` must not leave a duplicate `var` (clean removal).
- Gating `visualActive` by spread must not dim the theater focus (spotlight + scroll-driven selectStage cover it).

## Subagent Dispatch
- **implementer** (sonnet): apply E1–E4b in `docs/index.html`, self-diff-check, return changed line ranges. writeSet = `docs/index.html`.
- **controller** (this agent): browser verify AC1–AC6, tune positions/camera if needed.
- **reviewer** (independent, read-only): one review lens on the diff for regressions/AC traceability before closeout.
