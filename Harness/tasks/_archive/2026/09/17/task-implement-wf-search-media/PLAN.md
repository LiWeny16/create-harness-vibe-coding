# task-implement-wf-search-media - PLAN

## Goal

- Outcome: Give `wf-search` a bounded authenticated-browser adapter contract and a tested video-transcript/ASR path backed by the user's remote Whisper host.
- Non-goals: CAPTCHA or anti-bot bypass, raw-cookie handling, unrestricted crawling, or sending video binaries into an Agent context.

## Scope

- Write set: `templates/common/.claude/skills/wf-search/**`, mirrored root `.claude/.agents` wf-search surfaces, `templates/common/Harness/scripts/wf-search-video.mjs`, its root mirror, tests, and remote Whisper service integration artifacts.
- Forbidden: raw credentials/cookies in files or logs; unrelated dirty-worktree files; claiming a workflow as reusable until it passes an end-to-end check.

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | Use BrowserOS Neo as the authenticated page interaction layer and expose only bounded extraction results to wf-search. | Cookies stay inside the browser profile; the Agent receives evidence, not session secrets. | 2026-09-17 |
| 2 | Run Whisper as a mutually-exclusive `ai switch whisper` profile on the RTX 3080 host. | The current Qwen profile uses nearly all 20 GiB VRAM. | 2026-09-17 |
| 3 | Use faster-whisper `large-v3` behind localhost:8090 and an SSH tunnel. | Preserve high ASR quality without making the ASR endpoint public. | 2026-09-17 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | Platform/browser and video evidence contracts are present in the wf-search skill and all mirrors. | `tests/wf-search-media.test.js`, `tests/wf-search-install.test.js` | passed |
| AC-002 | Local transcript CLI validates, searches, and normalizes a mocked ASR response with timestamped segments. | `tests/wf-search-media.test.js` and CLI smoke | passed |
| AC-003 | Remote host can switch to Whisper, report readiness, and transcribe a real speech sample through the SSH tunnel. | `evidence/wf-search-whisper/VERIFICATION.md` | passed |
| AC-004 | Only successful remote commands are promoted into reusable skill references; no secrets are recorded. | reviewed `video-research.md` mirrors and verification evidence | passed |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Browser sessions and platform limits vary. | Bound pages/items/time, stop on login/CAPTCHA/429, record limitations. | open |
| Whisper and Qwen compete for VRAM. | Make profiles mutually exclusive and use the existing `ai` switch surface. | open |
