# PLAN — task-localize-wf-ui-theme

## Goal

Add i18n (en/zh) and dark/light theme support to wf-ui control panel. No functional changes — only UI text and theme CSS.

## Scope

| In scope | Out of scope |
|----------|-------------|
| React i18n context + en/zh translation strings | Backend i18n (server messages) |
| CSS `[data-theme="dark"]` variables | Japanese (ja) translations (key structure supports it, but strings not written) |
| Theme toggle functional in Header + Settings | System-level theme preference persistence |
| Replace all 200+ hardcoded English strings in 9 components | New features or behavior changes |

## Architecture Decisions

1. **No external i18n library** — 3 languages only, custom React Context suffices
2. **English text as translation keys** — `t("Loading workflow canvas")` style, zero abstraction overhead
3. **`data-theme` attribute on `<html>`** — pure CSS variable switch, no JS theme computation
4. **I18nContext reads from Settings API** (`/api/settings`) on mount, language persisted via settings POST

## D-GATE: Dispatch Table

### Phase 1 — Infrastructure (serial, single worker)

| Field | Value |
|-------|-------|
| Worker | W0-implementer |
| Role | implementer |
| Model | opus (architecture decisions) |
| Objective | Create i18n system, theme CSS, wire App entry point |
| WriteSet | `src/ui/src/i18n/translations.ts`, `src/ui/src/i18n/I18nContext.tsx`, `src/ui/src/i18n/index.ts`, `src/ui/src/index.css`, `src/ui/src/App.tsx`, `src/ui/src/main.tsx` |
| Forbidden | Do NOT modify any component files under `src/ui/src/components/` |
| Verification | `npx tsc --noEmit` in `src/ui/` passes, `npx vite build` in `src/ui/` succeeds |
| AC | AC-INFRA-01: I18nContext provides `t()` and `lang` to all children; AC-INFRA-02: `data-theme` attribute toggles on `<html>`; AC-INFRA-03: dark CSS variables defined for all `:root` counterparts |

### Phase 2 — Component i18n (parallel, 6 haiku workers)

All workers share the same contract template. WriteSets are **disjoint** — no file appears in more than one worker's writeSet.

| Worker | Files | ~Strings |
|--------|-------|----------|
| W1 | `Header.tsx`, `Footer.tsx`, `LoadingView.tsx` | 25 |
| W2 | `SettingsRoute.tsx` + theme toggle wiring | 30 |
| W3 | `TaskList.tsx` | 35 |
| W4 | `WorkflowRoute.tsx` | 80 |
| W5 | `AgentsRoute.tsx` | 40 |
| W6 | `RolesRoute.tsx`, `TerminalDrawer.tsx` | 30 |

**Shared Worker Contract:**
- Role: implementer
- Model: haiku (mechanical string replacement)
- Forbidden: Do NOT change any logic, structure, or behavior. Only replace hardcoded English strings with `t("...")` calls. Do NOT add imports not needed. Do NOT modify CSS or styling.
- Import to add: `import { useT } from '../i18n/index';` at top of each component
- Pattern: `const t = useT();` inside component, then wrap all user-facing strings: `t("Loading settings")`
- Verification: File compiles without TS errors
- AC: AC-TXT-01 through AC-TXT-06 — zero hardcoded English user strings remain in each assigned file

### Phase 3 — Verification (serial)

| Field | Value |
|-------|-------|
| Worker | V0-verifier |
| Role | verifier |
| Model | haiku |
| Objective | Run TypeScript check, Vite build, report pass/fail |
| WriteSet | none (read-only) |
| Verification | Self — reports build result |

## AC Summary

| ID | Description |
|----|-------------|
| AC-INFRA-01 | `useT()` hook returns translation function, available in all components |
| AC-INFRA-02 | `<html data-theme="dark">` toggles when theme setting changes |
| AC-INFRA-03 | All `:root` CSS variables have `[data-theme="dark"]` counterparts |
| AC-TXT-01..06 | Zero hardcoded English user-visible strings remain in each component group |
| AC-VERIFY-01 | `tsc --noEmit` passes in `src/ui/` |
| AC-VERIFY-02 | `vite build` succeeds in `src/ui/` |

## Risks

| Risk | Mitigation |
|------|-----------|
| Translation key typos cause runtime errors | TS strict mode catches missing keys at compile time |
| Worker W0 output incompatible with W1-W6 | W0 produces `translations.ts` with ALL keys; W1-W6 only consume |
| Settings page language selector not wired | W2 specifically tasked with wiring theme toggle AND language selector |
