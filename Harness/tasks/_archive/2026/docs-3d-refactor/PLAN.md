# PLAN.md - docs-3d-refactor

## Goal

Overhaul `docs/index.html` with Apple-style 3D product page: shared Three.js scene (hero→theater), upgraded cube assets with explode, scroll parallax, dark-to-light transition, global grid, overflow fixes.

## AC IDs

- **AC-OVERFLOW**: No horizontal scrollbar at 375/768/1440/1920 widths. All text readable, no overlapping.
- **AC-SHARED-3D**: Single Three.js scene visible in hero (small cube cluster) that transitions to theater (workflow stage layout).
- **AC-UPGRADED-CUBES**: Each stage cube is a modular Group with body, top plate, wireframe edges, emissive highlights, CanvasTexture labels.
- **AC-EXPLODE**: Clicking a stage cube triggers fragment explosion (40-120 pieces), auto-reassembly within 1.4s.
- **AC-SCROLL-TRANSITION**: After theater, background transitions black→white. Grid inverts. "Evidence is the interface." paragraph appears.
- **AC-GLOBAL-GRID**: Fixed global grid layer with CSS variables, pointer-events:none, driven by GSAP ScrollTrigger.
- **AC-APPLE-LAYOUT**: Large whitespace, restrained mono palette, clear hierarchy, minimal cards. Hero has 3D visual alongside copy.
- **AC-STAGE-PANEL**: Stage text switches on click/scroll, no overlap with rail or canvas elements.
- **AC-COPY-INSTALL**: Copy button still works.
- **AC-REDUCED-MOTION**: prefers-reduced-motion disables complex animations.

## Architecture Decisions

### 1. Single Shared Canvas

- Remove canvas from `.theater-visual`. Place one `#flow3d` canvas as `position: fixed; inset: 0; z-index: 2; pointer-events: auto;` inside `.site-shell`.
- Canvas visibility: only during hero+theater+transition sections. In advantages/install, canvas is `visibility: hidden` or `opacity: 0`.
- Hero state: small cube cluster, right-side offset, subtle floating.
- Theater state: 5 cubes in workflow layout, camera close.
- Transition: scene fades out.

### 2. Scene States (driven by GSAP ScrollTrigger)

4 scroll zones:
1. **hero-zone** (0-1): Small cubes floating in cluster at right. Camera far. Passive idle animation.
2. **theater-zone** (1-2): Cubes animate to workflow positions. Camera moves in. Stage selection via scroll.
3. **transition-zone** (2-3): 3D scene fades. Background transitions dark→light. "Evidence is the interface." text.
4. **light-zone** (3+): White background. Grid inverted. Dark text sections.

### 3. Cube Asset Design

Each stage node is a Group:
- **body**: `BoxGeometry(1.16, 0.72, 1.16)` with `MeshPhysicalMaterial` (dark metal, clearcoat 1, roughness 0.14)
- **topPlate**: `BoxGeometry(1.22, 0.04, 1.22)` positioned at y=0.38, emissive highlight
- **edgeFrame**: `EdgesGeometry` + `LineBasicMaterial` (white, opacity 0.25)
- **cornerNodes**: 8 small `SphereGeometry(0.04)` at corners, emissive
- **innerShelf**: thin `BoxGeometry(0.9, 0.015, 0.9)` at y=-0.1, glass-like
- **label**: `Sprite` with `CanvasTexture` (512×192), clear text

Active state: body turns light (0xf2f2f2), edge opacity increases, shelf emissive.

### 4. Explode System

- On cube click (Raycaster), call `explodeStage(index)`.
- Create fragment pool (shared geometry/material):
  - 60-80 small cubes (`BoxGeometry(0.06, 0.06, 0.06)`)
  - Scatter outward from cube center with random velocity
  - Each fragment: random rotation, emissive pulse
- After ~1.0s, animate fragments back to origin positions
- After reassembly, hide fragments, restore original cube
- **Memory**: Pool reuses same 80 fragments. Cleanup after animation.

### 5. Global Grid CSS Variables

```css
:root {
  --grid-opacity: 0.5;
  --grid-scale: 1;
  --grid-x: 0px;
  --grid-y: 0px;
  --page-bg: #050505;
  --page-ink: #f7f7f7;
}
```

`.global-grid` layer:
```css
position: fixed; inset: 0; z-index: 0; pointer-events: none;
background: repeating-linear-gradient(...);
opacity: var(--grid-opacity);
transform: scale(var(--grid-scale)) translate(var(--grid-x), var(--grid-y));
```

### 6. CSS Overflow Fixes

- `html, body { overflow-x: clip; max-width: 100%; }`
- All `100vw` values reviewed and replaced with `100%` or `calc(100% - ...)`
- `clamp()` for all large font sizes
- Mobile: stage-panel uses bottom positioning that doesn't overlap rail
- Canvas: `width: 100%; height: 100%;` without causing overflow

### 7. Transition Section

New section between theater and advantages:
```html
<section class="transition-band">
  <div class="transition-content">
    <h2 class="evidence-text">Evidence is the interface.</h2>
    <p>Harness makes verification part of the operating contract.</p>
  </div>
</section>
```

GSAP drives:
- `--page-bg` from `#050505` to `#fafafa`
- `--page-ink` from `#f7f7f7` to `#111111`
- `--grid-opacity` from `0.5` to `0.12`
- Grid line color from white to black

### 8. Layout Restructure

```
Hero (min-height: 92svh)
├── Left column: headline + copy + CTA
├── Right column: small 3D cube cluster (shared canvas)
└── Scroll cue

Theater (height: 290svh, sticky)
├── Shared canvas (now workflow layout)
├── Stage copy (top-left)
├── Stage panel (bottom-right)
└── Stage rail (bottom-left)

Transition (height: 100svh)
├── "Evidence is the interface." large text
└── Background transitions black→white

Advantages (white bg, dark text)
└── 3-column grid

Install (white bg, dark text)
└── Two columns: copy + prompt box

Footer
```

## Write Set

- `docs/index.html` — single file, complete rewrite of CSS + HTML + JS

## Risks

1. Single-file monolithic rewrite — hard to review diff. Mitigation: implementer must preserve all testids, data attributes.
2. Three.js module import may fail on some CDNs. Mitigation: keep existing CDN approach (unpkg).
3. Canvas sizing on mobile may cause jank. Mitigation: `requestAnimationFrame` resize debounce.
4. Explode fragment count may be too high for mobile. Mitigation: reduce fragment count on mobile (40 vs 80).

## Subagent Dispatch

| Wave | Agent | Role | WriteSet |
|------|-------|------|----------|
| W1 | implementer | Rewrite docs/index.html | docs/index.html |
| W2 | verifier | Browser verification | None |
| W3 | reviewer | Code review | None |
