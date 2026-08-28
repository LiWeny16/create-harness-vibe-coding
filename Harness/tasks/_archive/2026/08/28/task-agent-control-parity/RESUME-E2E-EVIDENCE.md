# RESUME Live E2E Evidence - task-agent-control-parity (verifier pass, 2026-08-13)

Date: 2026-08-13 (UTC). Node v24.18.0, Windows 10. codex-cli 0.147.0.
Backend: fresh `wf-ui` on http://127.0.0.1:56670 with the P5b code (rollout-id detector in `src/wf-ui-server/pty-adapter.mjs`).
All live calls via `Harness/scripts/wf-ui-control.mjs --url http://127.0.0.1:56670 --project .` (env HARNESS_AGENT_KIND=main).

Sessions under test (both `Harness/a2a/sessions/`):
- PHASE-1 session: `aa04dc1f-c563-45e5-a38b-446a6c8db099` (codex main, live spawn, pid 21440)
- PHASE-2 session (restart result): `0d687cb3-40c3-42fc-b535-2aa5e7c40648` (pid 30684)

## Phase 1 - first session with real conversation

### 1. create-agent (real spawn, no --defer)
- Response: status running, pid 21440, runtime codex, agentKind main, role Main Agent, objective "Resume test CEO", graphNodeId session-aa04dc1f-...
- Boot: codex v0.147.0 TUI, YOLO mode, gpt-5.5 xhigh. MCP warnings (codebase-memory-mcp, ssh failed to start - pre-existing env issue, not test-relevant).

### 2. rollout-id capture: FAILED (never fired)
- events.jsonl polled 60s+ after spawn and checked again ~6 min later. ONLY events present:
  `session.created` (08:21:20.810Z), `session.running` (08:21:20.870Z).
  **No `codex.rollout-id.captured` event ever.**
- STATE.json: `agentSessionId: null`, no `codexRolloutId` field.
- The codex rollout UUID DOES exist on disk for this session:
  `~/.codex/sessions/2026/08/13/rollout-2026-08-13T16-21-24-019ffa36-34a1-7923-ab6b-c66732a1e06e.jsonl`
  first line session_meta: `"session_id":"019ffa36-34a1-7923-ab6b-c66732a1e06e"`, originator codex-tui, written 08:23:56.
- Root cause (verified by scanning the FULL stripped PTY output of BOTH this session and the earlier
  session 8bf53868 from the C8/C9 pass): **codex 0.147.0 TUI never prints its rollout UUID to the PTY**,
  and never prints a line matching the detector's `CODEX_ROLLOUT_CONTEXT_PATTERN` (session|rollout) with a UUID.
  The detector (30s window, pty-adapter.mjs:87-129) therefore cannot fire on real codex output.
  Detector wiring itself is correct (pty-adapter.mjs:245-260 observes every codex chunk).

### 3-4. Turn 1 (char-by-char raw typing, 35 chars + CR via CLI send-input --raw)
- INPUT ARTIFACT (verifier's own CLI misuse, NOT a product bug): a flush call `--text "" --raw`
  is parsed by parseArgs as `--text true` (empty value is falsy -> default 'true'), so the submitted
  prompt became `Reply with exactly one word: bananatrue`.
- AI replied `bananatrue` (ground truth from rollout jsonl: response_item final_answer `bananatrue`,
  task_complete 08:24:04, duration 8.15s; terminal frame seq 281 also shows the reply bullet).
- So the phase-1 reply CONTAINS "banana" but the prompt was corrupted by the flush call.

## Phase 2 - stop + resume

### 5. agent.stop -> ok, lifecycle stopped (old pid 21440 gone, verified via tasklist)
### 6. agent.restart --resume true -> response ok / action agent.restart / nodeLifecycle live
- New session created: `0d687cb3-40c3-42fc-b535-2aa5e7c40648` (08:26:48.018Z, pid 30684);
  graph node session-aa04dc1f rebinds to it; events: session.created, session.running,
  session.graph-started previousSessionId=aa04dc1f-...
- **resumeArgs ground truth (wmic cmdline of pid 30684):**
  `cmd.exe /d /c call C:\Users\onion\AppData\Local\pnpm\bin\codex.CMD --dangerously-bypass-approvals-and-sandbox resume --last`
  => resumeArgs[0] === 'resume' PASS; resumeArgs[1] === '--last' (FALLBACK, because agentSessionId and
  codexRolloutId were both empty) -- **NOT the captured rollout id; nothing was captured.**
  The plan assertion "resumeArgs[1] equals the CAPTURED ROLLOUT ID" FAILS.

### 7. Process did NOT exit immediately: pid 30684 alive through the whole second turn and beyond.
- No "No saved session found" error anywhere in the resumed TUI output.
- The resumed TUI boot rendered the PRIOR conversation in scrollback:
  `› Reply with exactly one word: bananatrue` / `• bananatrue` (terminal.jsonl of session 0d687cb3).
  `codex resume --last` restored MY session (it was the most recent codex session on the machine).

### 8. Turn 2 (context memory proof) - PASS (resume functionally works)
- Sent char-by-char: `What was the one word I asked you to reply?`
- Rollout jsonl (same file 019ffa36 continues, ordinals 15-27):
  - ordinal 20 item_completed UserMessage "What was the one word I asked you to reply?"
  - ordinal 23 item_completed AgentMessage "bananatrue"
  - task_complete 08:27:56, duration 9.85s; token_count: input 17735, **cached_input 16768 (94.5% cache hit
    => full prior conversation context was loaded into the resumed session)**
- Terminal rendered the reply bullet `• bananatrue` in the resumed TUI.
- The model answered with the SAME word from turn 1 -> it remembered the pre-restart conversation.

### 9. Post-evidence hygiene: agent.stop on session 0d687cb3 -> ok, lifecycle stopped.

## Verdict: PARTIAL

- The end-to-end resume goal WORKS live: stop -> restart resume:true -> process stays alive ->
  prior conversation restored -> second turn answered from memory (context remembered).
- BUT the P5b rollout-id fix this test targets NEVER ENGAGED:
  1. `codex.rollout-id.captured` never emitted; codexRolloutId never stored; agentSessionId null.
  2. resumeArgs were the `--last` fallback (['resume','--last']), not ['resume', <rolloutId>].
  3. `--last` succeeded only because the test session happened to be the newest codex session on the
     machine (rollout 16:21:24 > previous 15:52:36). Any newer codex session from another project
     would have resumed the WRONG conversation. This is a race, not a guarantee.
- The detector's assumption ("the TUI prints `Session <uuid>` early at session start") does not hold
  for codex 0.147.0 on this environment: the UUID exists only in the on-disk rollout jsonl
  (written ~3.5 min after spawn, i.e., also past the 30s window), never in the PTY stream.

## Risks / open items
- Rollout-id capture needs a different signal source for codex: e.g. scan `~/.codex/sessions/**/rollout-*.jsonl`
  (newest file mtime around spawn), or capture the UUID from the session_meta line, or use
  `codex resume` without an id plus history verification. The 30s PTY-scan detector cannot work as-is.
- `--last` fallback can restore the wrong session; without rollout-id mapping, resume-by-id remains broken
  (harness session id is not a codex rollout id; `codex resume <harness-id>` exits 1, as C9 already showed).
- Phase-1 prompt was corrupted by a verifier-side CLI quirk (`--text ""` -> 'true'); the phase-2 memory
  proof is unaffected (reply "bananatrue" references the actual turn-1 word).
- Terminal seq counters in terminal.jsonl reset repeatedly during char-by-char input (appendTerminalData
  vs persistSession race, 38 resets observed) - pre-existing data-layer artifact, out of scope, noted.

---

# RESUME Live E2E Evidence - PASS 2 (verifier, 2026-08-13)

Date: 2026-08-13 (UTC timestamps). Backend: FRESH wf-ui 0.8.20 on http://127.0.0.1:56670 (pid 18048,
`wf-ui --project . --host 127.0.0.1 --port 56670 --detached-child`; health uptime 37s at first check 09:05:10Z).
All control via `Harness/scripts/wf-ui-control.mjs --url http://127.0.0.1:56670 --project .`
(env HARNESS_AGENT_KIND=main). CLI: claude 2.1.215, codex-cli 0.147.0, opencode 1.18.4.
Prompt typed char-by-char (12ms/char, `--text <char> --raw`, then literal CR) in every turn.

Note: `--role-title ceo` in the task command is silently dropped by the CLI parseArgs (create-agent reads `--role`
only); role "Main Agent" applied. No error.

## 1. CLAUDE runtime

### Phase 1 - real conversation + capture checks

| Step | Time (UTC) | Result |
|------|-----------|--------|
| create-agent (main, claude, real spawn) | 09:05:15 | session 67a1f6cc-7930-4ee2-8f02-4c7a9b03243a, node session-67a1f6cc..., spawnPid 27924, status running |
| STATE.json agentSessionId | 09:05:35 | c80f2d0c-63a9-41d8-8d4c-90f9f78758bd (UUID, pre-assigned) - PASS |
| wmic cmdline | 09:05:37 | claude.exe --dangerously-skip-permissions --session-id c80f2d0c-63a9-41d8-8d4c-90f9f78758bd (pid 27072, PPID 27924) - PASS, contains --session-id <uuid> |
| Turn 1: 35 chars + CR | 09:05:51-58 | all HTTP 200 |
| Reply poll | ~09:06:05 | transcript: "Thought for 7s" then bullet "cherry" then "Churned for 7s" - PASS, cherry replied |

### Phase 2 - stop, resume, memory

| Step | Time | Result |
|------|------|--------|
| agent.stop | 09:08:22 | {ok:true, action:agent.stop}; claude.exe 27072 gone |
| agent.start {resume:true} | 09:08:29 | result: resumeUsed:true, resumeArgs:["--resume","c80f2d0c-63a9-41d8-8d4c-90f9f78758bd"], previousSessionId:67a1f6cc..., new session a717567e..., pid 20156 - response-level wiring exact per spec |
| Process alive after 20s | 09:08:35 | FAIL - exited at 5s, exitCode 1; terminal: "No conversation found with session ID: c80f2d0c-63a9-41d8-8d4c-90f9f78758bd" |
| Memory turn | - | NOT POSSIBLE (no live resumed session; resume deterministically exits 1) |
| ATTACH case (session e277e1c0 running) | 09:12:50 | agent.start -> {ok:true, alreadyRunning:true, resumeUsed:false, resumeArgs:[], sessionId:e277e1c0...} - PASS, no new process |

Deterministic repeat (session e277e1c0-d320-4674-9657-a4c21e0de973, agentSessionId c7a351c3-3be0-43c2-894d-b419778ea6c9):
cherry turn replied bullet cherry 09:13:26 (after "Thought for 8s"); stop 09:13:34; resume 09:13:41 ->
resumeUsed:true, resumeArgs:["--resume","c7a351c3-3be0-43c2-894d-b419778ea6c9"], new session f91fb51d ->
exited 1 "No conversation found with session ID: c7a351c3-...".

### Claude root-cause forensics (runtime persistence)

- The pre-assigned conversation file ~/.claude/projects/D--MyFile-sample-synchronous-github-zingspark-create-harness-vibe-coding/<agentSessionId>.jsonl
  is NEVER created: verified absent after 40s idle boot (e277e1c0), after a completed turn (e277e1c0, checked 09:13:30),
  after agent.stop (67a1f6cc, e277e1c0), and across a full ~/.claude scan of the 09:04-09:09 window (only the main
  agent own conversation 34477ced-...jsonl was touched).
- claude-code DOES register the session: ~/.claude.json projects[...].lastSessionId = c80f2d0c-63a9-41d8-8d4c-90f9f78758bd
  and an empty marker dir ~/.claude/session-env/<id> (created at spawn 17:05:19 +0800).
- agent.stop hard-kills via killPtyProcess (server.mjs stopRuntimeSession) - no graceful exit flush; but no file exists
  even while the TUI is alive after a completed turn.
- 3 independent external re-start attempts on my claude nodes (ab041c68 09:06:40 on node c270322c, aebdf105 09:09:40 on
  node 67a1f6cc [terminal: "No conversation found with session ID: c80f2d0c-..."], 3c6f1829 09:14:41 on node e277e1c0 -
  all objective "Resume E2E claude", all exited ~9s) failed identically, confirming the failure is deterministic at the
  runtime level, not a harness arg bug.

## 2. CODEX runtime

### Phase 1 - real conversation + capture checks

| Step | Time (UTC) | Result |
|------|-----------|--------|
| create-agent (main, codex, real spawn) | 09:14:10 | session e618df73-18ed-45da-b470-21eb7bde1c57, node session-e618df73..., pid 16168, status running; agentSessionId null at create (expected) |
| Turn 1: 35 chars + CR | 09:14:35-53 | all HTTP 200 |
| Reply | ~09:15:01 | transcript: "bullet cherry" then "Improve documentation in @filename ... gpt-5.5 xhigh" - PASS, cherry replied |
| Rollout ground truth | 09:15:01.301Z | C:/Users/onion/.codex/sessions/2026/08/13/rollout-2026-08-13T17-14-15-019ffa66-9974-7cf3-bf9c-6f034cde68ae.jsonl: session_id 019ffa66-9974-7cf3-bf9c-6f034cde68ae, task_complete last_agent_message cherry |
| Capture check | 09:14:10 to 09:17:16 | FAIL - codex.rollout-id.captured NEVER fired for e618df73; STATE.json codexRolloutId absent, agentSessionId null |

### Codex capture root cause (verified by reproduction)

- codex 0.147.0 stores rollout files at ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl (date subdirs; ZERO rollout files
  at the top level: top-level jsonl count = 0).
- createCodexRolloutFsCapture (pty-adapter.mjs) scans fs.readdirSync(sessionsDir) NON-RECURSIVELY, so it can never
  see a rollout file; baseline (snapshotRolloutFilenames) is equally blind. Standalone reproduction with the real
  sessions dir: no capture fires.
- Unit tests pass because the fixture writes rollout files FLAT into the temp sessions dir
  (workflow-codex-resume-id.test.mjs rolloutFilename()), matching the code assumption, not the real codex layout.
- The PTY scanner fallback is also blind: codex 0.147.0 never prints its rollout UUID to the PTY (prior pass finding,
  re-confirmed this pass).

### Phase 2 - stop, resume, memory

| Step | Time | Result |
|------|------|--------|
| agent.stop | 09:18:17 | ok; pid 16168 gone |
| agent.start {resume:true} | 09:18:24 | resumeUsed:true, resumeArgs:["resume","e618df73-18ed-45da-b470-21eb7bde1c57"] - harness-id fallback (capture never fired), NOT the rollout id |
| Process alive | 09:18:36 | FAIL - exited 1: "ERROR: No saved session found with ID e618df73-18ed-45da-b470-21eb7bde1c57. Run codex resume without an ID..." |
| Memory turn via harness | - | NOT POSSIBLE (resumed session exited) |
| ATTACH case (session 910e2a3d running) | 09:21:12 | agent.start -> {ok:true, alreadyRunning:true, resumeUsed:false, resumeArgs:[], sessionId:910e2a3d...} - PASS, no new process |

False-positive finding: the resumed session 9501975f DID emit codex.rollout-id.captured at 09:18:29.027Z with
codexRolloutId = e618df73-18ed-45da-b470-21eb7bde1c57 (the HARNESS id; STATE.json agentSessionId + codexRolloutId both
set to it). Cause: the PTY scanner 30s window matched the error line "No saved session found with ID e618df73-..."
(session context + UUID pattern) - a false positive that poisons the next resume with a non-rollout id.

### Codex runtime continuation proof (diagnostic, correct rollout id)

Manual node-pty spawn exactly as the harness wraps it (cmd.exe /d /c call C:/Users/onion/AppData/Local/pnpm/bin/codex.CMD
--dangerously-bypass-approvals-and-sandbox resume 019ffa66-9974-7cf3-bf9c-6f034cde68ae), cwd = repo root:
- Resumed TUI rendered the PRIOR conversation in scrollback: user line "Reply with exactly one word: cherry" and
  reply bullet "cherry".
- Memory question "What was the one word I asked you to reply?" sent 09:20:31; SAME rollout jsonl continues (ord 17-26):
  UserMessage 09:20:31.622Z -> Reasoning -> AgentMessage -> response_item 09:20:38.082Z assistant content "cherry" ->
  token_count input 17720 / cached 4480 -> task_complete 09:20:38.198Z last_agent_message "cherry" duration 14.8s.
- => runtime-level memory PASS with the correct rollout id; the harness path is blocked solely by the capture bug.

## 3. OPENCODE runtime

Probe (equivalent of opencode login status): `opencode providers list` => 0 credentials in
~\.local\share\opencode\auth.json (only DEEPSEEK_API_KEY env var). `opencode login status` itself is not a valid
subcommand (prints help). Per the bounded task rule (attempt only when auth is present): NOT ATTEMPTED -
environment-limited (0 credentials). The opencode SQLite session-id capture (pty-adapter.mjs
createOpencodeSessionIdCapture) was not exercised.

## 4. Graph/process state after the pass (hygiene)

- Graph version 1854 -> 1867 (09:21:42Z). Nodes added: session-67a1f6cc (claude main), session-c270322c (claude main,
  stopped), session-e277e1c0 (claude main), session-e618df73 (codex main), session-910e2a3d (codex main, stopped).
- All test sessions ended stopped/exited; the attach-case codex 910e2a3d stopped; a diagnostic orphan codex.exe
  (pid 23212) from the manual resume check was killed with taskkill. Pre-existing claude.exe 13856 left untouched.
- Backend still healthy at pass end: 200 ok, uptime 1185s, version 0.8.20.

## 5. Per-runtime verdict (verifier PASS 2)

| Runtime | Verdict | Harness wiring | Runtime resume outcome |
|---------|---------|----------------|------------------------|
| claude | PARTIAL | FULL PASS (pre-assign UUID, --session-id spawn, --resume resume args, stop, attach) | FAILS deterministically - claude-code 2.1.215 never persists the PTY-spawned conversation file, so --resume <uuid> exits 1 "No conversation found"; memory turn not achievable |
| codex | PARTIAL | response-level PASS (resumeUsed/resumeArgs, attach) | FAILS via harness - rollout-id capture broken (FS scan is non-recursive, real files live in date subdirs), resume falls back to the harness id, codex exits 1 "No saved session found"; memory PASS proven at runtime level with the correct rollout id |
| opencode | NOT ATTEMPTED | - | environment-limited (0 credentials in opencode auth.json) |

---

# RESUME Live E2E Evidence - PASS 3 (verifier re-verification, 2026-08-13)

Date: 2026-08-13 (UTC timestamps). Backend: FRESH wf-ui on http://127.0.0.1:56670 (old backend pid 18048
taskkill /F, new listener pid 25944, launched via `node bin/create-harness-vibe-coding.js wf-ui --project .
--host 127.0.0.1 --port 56670 --detach`). Code under test: claude graceful stop (ws-terminal.mjs
gracefulStopPty /exit sequence) + codex recursive rollout capture (pty-adapter.mjs
createCodexRolloutFsCapture, date-subdir walk) - both fixes landed.
All control via `Harness/scripts/wf-ui-control.mjs --url http://127.0.0.1:56670 --project .`
(env HARNESS_AGENT_KIND=main). Runtime versions: claude 2.1.215, codex-cli 0.147.0.
Prompts typed char-by-char (`--text <char> --raw`, 50ms/char, literal CR via send-key enter). 2 real AI
turns per runtime (4 total).

## 1. CLAUDE runtime (session dae0424d-aa10-41fa-a21d-b2ed2987c076, agentSessionId 8537222b-a85d-4fda-8080-a257d114fc0a)

| Step | Time (UTC) | Result |
|------|-----------|--------|
| create-agent (main, claude, real spawn) | ~09:36:46 | session dae0424d, spawnPid 25300, status running, agentSessionId 8537222b pre-assigned |
| TUI boot | ~09:37 | claude TUI up (MCP auth warning banner, non-blocking) |
| Turn 1: 33 chars + CR "Reply with exactly one word: plum" | ~09:37:3x | all HTTP 200 |
| Reply poll | ~09:37:4x | terminal: "Thought for 9s" then bullet `●plum`, "Baked for 9s" - PASS, plum replied |
| agent.stop | 09:38:0x | {ok:true, action:agent.stop}; lifecycle stopped; claude.exe gone |
| GRACEFUL evidence | - | terminal seq94 renders `/exit` (the graceful-stop write), seq95-99 clean TUI teardown; STATE killed:false, exitCode:0, stoppedAt 09:38:08.794Z - process-level graceful exit CONFIRMED (no hard kill) |
| Runtime registration | 09:38:30Z | claude.json projects["D:/MyFile/sample/synchronous-github/zingspark/create-harness-vibe-coding"].lastSessionId = 8537222b-... (claude.json mtime 09:38:30.987Z); marker dir ~/.claude/session-env/8537222b-... created |
| **DISK CHECK (transcript flush)** | 09:38:4x | **FAIL** - ~/.claude/projects/D--MyFile-sample-synchronous-github-zingspark-create-harness-vibe-coding/8537222b-a85d-4fda-8080-a257d114fc0a.jsonl DOES NOT EXIST. Full-tree grep of C:/Users/onion/.claude for the session id: only the session-env marker matches. Transcript file is never created even after graceful stop |
| agent.start {resume:true} | 09:39:0x | ok, new session f6bf80bf (lifecycle live) |
| resumeArgs (ground truth) | - | terminal of f6bf80bf: `No conversation found with session ID: 8537222b-a85d-4fda-8080-a257d114fc0a` => resumeArgs = ['--resume', <agentSessionId>] - harness wiring correct |
| Process alive after 20s | ~09:39:1x | **FAIL** - exited ~5s, exitCode 1, events session.exited; same deterministic runtime failure as PASS 2 |
| Memory turn | - | NOT POSSIBLE (no live resumed session) |

Claude summary: the graceful-stop FIX works at the process level (clean /exit, exit 0, no kill, claude.json
lastSessionId + session-env registered) but the underlying runtime limitation is UNCHANGED: claude-code
2.1.215 in a harness PTY never persists the conversation jsonl, so `--resume <agentSessionId>` still
deterministically exits 1 "No conversation found". End-to-end resume remains broken for claude.

## 2. CODEX runtime (session 29a050ad-7183-4282-8897-19c1f97fb3a6, spawnPid 10052)

| Step | Time (UTC) | Result |
|------|-----------|--------|
| create-agent (main, codex, real spawn) | ~09:40:2x | session 29a050ad, status running |
| **Rollout capture** | 09:40:54.621Z | **PASS** - events.jsonl: `codex.rollout-id.captured` {codexRolloutId: 019ffa7e-8923-7b10-a14e-8fe4b793b42d}; STATE.json codexRolloutId = 019ffa7e-... (agentSessionId mirrors it). RECURSIVE FS SCAN FIX WORKS |
| Cross-check on disk | 09:40:54Z | **PASS** - C:/Users/onion/.codex/sessions/2026/08/13/rollout-2026-08-13T17-40-24-019ffa7e-8923-7b10-a14e-8fe4b793b42d.jsonl EXISTS (85153 bytes, mtime 09:40:54.290Z); session_meta session_id = 019ffa7e-... matches the captured id |
| Turn 1: 33 chars + CR "Reply with exactly one word: kiwi" | ~09:40:4x | all HTTP 200 |
| Reply (ground truth) | 09:40:58Z | rollout task_complete last_agent_message "kiwi", duration 4634ms, time_to_first_token 4421ms; terminal bullet rendered - PASS, kiwi replied |
| agent.stop | ~09:41:0x | {ok:true, action:agent.stop}; lifecycle stopped |
| agent.start {resume:true} | ~09:41:1x | ok, new session 5f942f34, lifecycle live |
| resumeArgs (ground truth, powershell cmdline of pid 19816) | - | `cmd.exe /d /c call C:\Users\onion\AppData\Local\pnpm\bin\codex.CMD --dangerously-bypass-approvals-and-sandbox resume 019ffa7e-8923-7b10-a14e-8fe4b793b42d` => resumeArgs = ['resume', <CAPTURED ROLLOUT ID>] - **NOT the harness id** (29a050ad). The PASS 2 assertion now holds |
| Process alive | 09:41:3x+ | **PASS** - no "No saved session found" anywhere; prior turn rendered in resumed scrollback ("Reply with exactly one word: kiwi"); STATE running, pid 19816, codex.exe child alive well past 20s |
| Memory turn (turn 2, char-by-char) | ~09:42:2x | "What was the one word I asked you to reply?" -> SAME rollout jsonl continues (same session restored): task_complete #2 last_agent_message "kiwi", duration 5202ms; terminal bullet kiwi after resume - **PASS, remembered** |
| Post-evidence hygiene | - | agent.stop on 5f942f34 -> ok; test codex.exe gone (only pre-existing app-server 20632 remains); backend healthy pid 25944 |

## 3. Per-runtime verdict (verifier PASS 3)

| Runtime | Verdict | Harness wiring | Runtime resume outcome |
|---------|---------|----------------|------------------------|
| claude | PARTIAL | FULL (pre-assign UUID, --session-id spawn, --resume resumeArgs, stop, attach) | Graceful-stop fix works at process level (/exit, exit 0, no kill, claude.json lastSessionId registered) BUT transcript still never persisted by claude-code 2.1.215 PTY - --resume <uuid> still exits 1 "No conversation found"; memory turn not achievable |
| codex | FULL | FULL (recursive rollout capture -> codexRolloutId -> resume args ['resume', <rolloutId>]) | Resume by captured rollout id works end-to-end live: stop -> start resume:true -> process alive -> prior conversation restored -> memory question answered "kiwi" |

## Risks / open items
- claude resume remains blocked at the runtime level: no conversation file is written even with the graceful
  /exit stop. Options for a follow-up: (a) capture the conversation from the terminal transcript ring and
  materialize the jsonl at stop time, (b) use claude's `--continue`/last-session semantics instead of
  `--resume <uuid>`, or (c) treat claude resume as unsupported and document it.
- codex capture is timing-dependent on the rollout file appearing during the polling window (file written at
  first turn completion, ~30-60s after spawn; capture confirmed this pass at 09:40:54Z). If a codex session
  never completes a turn, no rollout file appears and the resume arg falls back - acceptable, but worth
  noting.
- The resumed codex process answered correctly; no token_count field present in codex 0.147.0 task_complete
  payload this run, so cache-hit ratio was not available as corroborating evidence (the scrollback render
  plus same-file continuation serve as the context-restore proof).

---

# RESUME Live E2E Evidence - PASS 4 (verifier exit-text probe, 2026-08-13)

Date: 2026-08-13 (UTC timestamps). Backend: wf-ui on http://127.0.0.1:56670 (already running, snapshot
v1892 at start; healthy v1895 at pass end). All control via `Harness/scripts/wf-ui-control.mjs
--url http://127.0.0.1:56670 --project .`. Runtime under test: claude 2.1.215 (deepseek-v4-pro[1M]).
Hypothesis under test: **claude's EXIT TEXT contains its real session id, and the transcript may exist
under THAT id (not the pre-assigned one).** Bounded to 2 real AI turns (1 used: turn 1; turn 2 not
possible - documented below).

## 1. Session under test

- create-agent (main, claude, real spawn, objective "Exit text probe"): session
  `5f9800e9-3e68-4622-bb2c-93c0855bca49`, graphNodeId session-5f9800e9..., spawnPid 20156, status running.
- Pre-assigned agentSessionId (API response + STATE.json identical): `7ca05032-b56f-473c-a191-9f422c9735fe`.
- TUI boot: Claude Code v2.1.215, deepseek-v4-pro[1M] max effort, bypass permissions on.

## 2. Turn 1 (real AI turn 1 of 2)

- 33 chars typed char-by-char (50ms/char, `--text <char> --raw`) + literal CR via send-key enter:
  `Reply with exactly one word: pear`.
- Reply at 09:56:30.162Z (seq 73): "Thought for 7s" then bullet `●pear` then "Brewed for 7s" - PASS.

## 3. agent.stop (graceful) and EXIT TEXT capture

- agent.stop at 09:56:57 -> {ok:true, killed:false, exitCode:0, stoppedAt 09:56:57.983Z, resumeArgs
  ["--resume","7ca05032-b56f-473c-a191-9f422c9735fe"]} - graceful stop CONFIRMED (no hard kill).
- Exit text block (terminal seq 74-81, 09:56:55.867Z - 09:56:57.886Z), raw bytes:

  seq74 `\x1b(B\x0f`
  seq75 `\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h`
  seq76 `\x1b[?2026h\x1b[?25l\x1b[H\r\x1b[2C\x1b[29B\x1b[38;2;87;105;247m/exit\x1b[39m...`
  seq77 `\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l`
  seq78 `\x1b[?2026h\x1b[?25h\x1b[?2026l\x1b[<u\x1b[?1049l\x1b[>4m\x1b[?1006l...` (alt-screen leave)
  seq79 `\x1b(B\x0f`
  seq80 `\x1b[>4m\x1b[<u\x1b[?1004l\x1b[?1004h\x1b[?2031l\x1b[?2004l\x1b[?25h\x1b7\x1b[r\x1b8\x1b]0;\x1b\`
  seq81 `\x1b[?25h`

- Human-readable content of the entire exit block: ONLY `/exit` (echo of the graceful-stop write) +
  terminal control sequences (mouse-mode off, alt-screen leave, cursor restore). NO session id, NO UUID,
  NO exit summary text.
- FULL terminal stream scan (all 164 entries, stdout+stdin, raw data before any stripping):
  **0 UUID tokens found** (regex `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`).
  The only uuid-like text in the stream is the harness sessionId 5f9800e9-... inside each terminal.jsonl
  line's metadata (backend-added, not claude output).
- OSC window titles during the session ("Claude Code", "Reply with the word pear") contain no id either.

## 4. Transcript file existence per id

| id | source | ~/.claude/projects/D--MyFile-sample-synchronous-github-zingspark-create-harness-vibe-coding/<id>.jsonl |
|----|--------|------|
| 7ca05032-b56f-473c-a191-9f422c9735fe | pre-assigned (STATE.json = API) | DOES NOT EXIST (checked after completed turn + graceful stop) |
| (any exit-reported id) | NONE - exit text contains no id | N/A |

- Full-tree grep of C:/Users/onion/.claude for the pre-assigned id: only the empty session-env marker dir
  (~/.claude/session-env/7ca05032-...) and one subagent transcript under the MAIN agent's own conversation
  34477ced (agent-a189373ab5d419650.jsonl, contains the id 38x + "Exit text probe" 8x - it quotes this
  task's text; NOT a claude runtime transcript for the harness node).
- claude.json projects[...].lastSessionId = 7ca05032-b56f-473c-a191-9f422c9735fe (the pre-assigned id;
  no history entries). The runtime registered ONLY the id it was told via --session-id.
- No file in the projects dir was created during the 17:55-17:57 +0800 window other than the main agent's
  own 34477ced transcript.

## 5. Pre-assigned vs exit-reported

**Same id, and that id is only the pre-assigned one.** The exit text reports NO id at all; the runtime
registers the pre-assigned id (claude.json lastSessionId + session-env marker). There is no second
"real" id to discover. Confirms PASS 2/3 forensics: claude-code 2.1.215 in a harness PTY never writes
the conversation jsonl under ANY id.

## 6. Diagnostic resume (harness-equivalent spawn, no state files edited)

`cmd.exe /d /c call C:\Users\onion\AppData\Roaming\npm\claude.cmd --resume 7ca05032-b56f-473c-a191-9f422c9735fe
--dangerously-skip-permissions` in a node-pty (exact harness args from runtime-detector.mjs
resumeArgs ['--resume', id] + --dangerously-skip-permissions), cwd = repo root:
- Output (first line): `No conversation found with session ID: 7ca05032-b56f-473c-a191-9f422c9735fe`
- EXIT_CODE 1 after ~3.3s; ALIVE_AFTER_15S false.
- => no "working id" exists for the harness session: resume-by-id deterministically fails because no
  transcript file exists under any id. Same runtime-level result as PASS 2/3.

## 7. Memory check (second real turn)

NOT POSSIBLE - precondition is a live resumed session; resume exits 1 deterministically (section 6).
Per the bounded-turn rule, no further AI turn was spent.

## 8. Verdict

**HYPOTHESIS REFUTED.**

1. "claude's EXIT TEXT contains its real session id" - REFUTED: the graceful-stop exit block contains
   ONLY `/exit` echo + terminal control codes (verified on raw bytes of seq 74-81); a scan of all 164
   terminal entries found 0 UUID tokens; OSC titles contain no id either.
2. "transcript may exist under THAT id" - MOOT: no id is reported at exit, and full-tree forensics show
   no transcript under the pre-assigned id either. The transcript does not exist under ANY id.

## 9. Fix implication for the harness

The harness has NO exit-reported id to persist - the fix direction "persist the exit-reported id" does
not apply to claude-code 2.1.215. The resume-blocking root cause stands: claude-code 2.1.215 never
persists the PTY-spawned conversation jsonl (even after graceful /exit with exit code 0). Remaining
options are unchanged from PASS 3: (a) materialize the conversation jsonl from the harness transcript
ring at stop time (harness already owns the full PTY byte stream), (b) switch claude resume to
--continue / last-session semantics and verify the right session via transcript content, or (c) declare
claude resume unsupported and document it. If a future claude version prints an id at exit, a small
exit-text watcher (tail of terminal ring at stop) could capture it, but there is no such signal today.

## 10. Risks / notes

- Diagnostic script's node event loop kept the bash tool alive after all evidence printed (tool timeout
  2m, exit 143) - the PTY child itself had already exited (exit code 1); wmic verified no orphan cmd.exe
  from the diagnostic (all listed cmd.exe are pre-existing MCP/bridge processes). Pre-existing
  claude.exe 13856 (main agent's own session) left untouched.
- Turn 1 prompt verified clean this pass (no --text "" flush quirk; reply pear matched the word sent).
- 2 real AI turns bound: 1 used, 1 skipped (memory turn not achievable without a live resumed session).

---

# RESUME Live E2E Evidence - PASS 5 (verifier exit-hint re-probe WITH 90s wait, 2026-08-13)

Date: 2026-08-13 (UTC timestamps). Backend: wf-ui on http://127.0.0.1:56670 (already running, snapshot
v1895 at start, v1898 at stop; healthy through the pass). All control via
Harness/scripts/wf-ui-control.mjs --url http://127.0.0.1:56670 --project . (env HARNESS_AGENT_KIND=main).
Runtime under test: claude 2.1.215 (deepseek-v4-pro[1M] max effort).
Hypothesis under test (user report): a normal terminal prints 'Resume this session with: claude --resume <id>'
at exit. PASS 4 read the stream too early - this pass WAITED 90s AFTER stop before reading, and searched
~/.claude for ANY new transcript (any id). Bounded to 1 real AI turn (used for turn 1; turn 2 not possible).

## 1. Session under test

- create-agent (main, claude, real spawn, objective 'Exit hint probe 2'): session
  861fb2b2-196e-4b29-96e5-a71a45a3102f, graphNodeId session-861fb2b2..., spawnPid 15292, status running.
- Pre-assigned agentSessionId (API response + STATE.json identical): f46807ef-ec35-419f-87a2-93a8697e8530.
- TUI boot: Claude Code v2.1.215, deepseek-v4-pro[1M] with max effort, bypass permissions on, 1 MCP
  auth-required banner (non-blocking).

## 2. Turn 1 (real AI turn 1 of 2; the only turn spent)

- 34 chars typed char-by-char (--text <char> --raw, natural spawn latency ~200ms/char) + literal CR via
  send-key enter: 'Reply with exactly one word: apple'.
- Reply at 11:27:18.825Z (terminal seq 151): 'Thought for 6s' then bullet apple then 'Cogitated for 6s'
  - PASS, apple replied.

## 3. agent.stop (graceful) - 11:27:51.031Z

- {ok:true, killed:false, exitCode:0, stoppedAt 11:27:51.031Z, resumeArgs ['--resume','f46807ef-...']}
  - graceful stop confirmed (no hard kill).

## 4. WAIT 90 seconds, THEN read the full stream

- 90s wait elapsed (11:27:51 -> ~11:29:21Z) before any read of the terminal stream.
- FULL terminal.jsonl scan (160 entries, stdout+stdin, raw data): 0 matches for 'resume' (case-insensitive)
  and 0 matches for 'Resume this session'. The only UUID tokens in the file are the harness sessionId
  861fb2b2-... in each line's backend-added metadata.
- Exit block (seq 68-75, 11:27:48.894Z - 11:27:50.927Z), human-readable content: ONLY '/exit' (echo of the
  graceful-stop write) + terminal control sequences (mouse-mode off, alt-screen leave, cursor restore).
  No session id, NO UUID, NO exit summary text, NO resume hint.
- The last stream write (seq 75, 11:27:50.927Z) precedes stop completion; NOTHING was flushed during the
  90s wait - the cmd.exe wrapper produced no late hint text.

## 5. Transcript file existence per id (10-minute window scan)

find ~/.claude/projects/D--MyFile-sample-synchronous-github-zingspark-create-harness-vibe-coding -name
'*.jsonl' -mmin -10 (19:19:43-19:29:43 +0800 window covering spawn 19:26:54 through stop+90s):

| file | size | mtime (+0800) | note |
|------|------|---------------|------|
| 34477ced-6378-45ea-941a-c294dafbe05c.jsonl | 7462579 | 19:29:03 | MAIN agent's own conversation (pre-existing, grows with this pass's tool-output persistence) |
| 34477ced-.../subagents/agent-a17081419e4f892a3.jsonl | 673156 | 19:29:43 | verifier subagent transcript (this pass) |
| 2be75942-ae81-440d-a316-6ffba9730b7f.jsonl | 40127 | 19:24:39 | PRE-SESSION mtime (before spawn 19:26:54); not test-related |

- NO transcript file under f46807ef-... or under ANY new id was created. A 30-minute window
  (-mmin -30, top-level) shows the same two pre-existing files only.
- ~/.claude.json for this project: lastSessionId = f46807ef-ec35-419f-87a2-93a8697e8530 (the pre-assigned
  id only), lastGracefulShutdown true, lastVersionBase 2.1.215.
- ~/.claude/session-env/f46807ef-... marker dir exists (EMPTY, created 19:26:58 +0800 at spawn). No other
  new marker dir.
- => same runtime limitation as PASS 2/3/4: claude-code 2.1.215 in the harness PTY registers the pre-assigned
  id but NEVER writes the conversation jsonl, even with a 90s post-stop flush wait.

## 6. Diagnostic resume (harness-equivalent spawn, exact args; no state files edited)

node-pty spawn (exact harness pty module @homebridge/node-pty-prebuilt-multiarch, cmd.exe /d /c call
%APPDATA%/npm/claude.cmd --resume f46807ef-ec35-419f-87a2-93a8697e8530 --dangerously-skip-permissions,
cwd = repo root, 120x32, TERM=xterm-256color):
- Output (first line): No conversation found with session ID: f46807ef-ec35-419f-87a2-93a8697e8530
- EXIT_CODE 1, ALIVE_AFTER_15S false.
- => no working resume id exists; resume-by-id deterministically fails because no transcript file exists
  under any id (fresh re-confirmation of PASS 4 result on this pass's session).

## 7. Memory check (second real turn)

NOT POSSIBLE - precondition is a live resumed session; resume exits 1 deterministically (section 6).
Per the bounded-turn rule (1 real AI turn), no further AI turn was spent.

## 8. Verdict

HYPOTHESIS REFUTED (again, now with the 90s wait).

1. 'The exit hint prints after the TUI process exits, from the cmd.exe wrapper' - REFUTED: the stream was
   silent for 90s after stop (last write 11:27:50.927Z, before stop completion); the exit block contains
   ONLY /exit echo + control codes; a full 160-entry scan found 0 'resume' tokens and no exit-reported id.
2. 'A transcript may exist under the exit-reported id (any id)' - REFUTED: no file under any id in the
   10-min (or 30-min) window; the runtime registered ONLY the pre-assigned id (claude.json lastSessionId +
   empty session-env marker), never a transcript.
3. Resume-by-id still deterministically fails: claude --resume f46807ef-... -> 'No conversation found',
   exit 1, dies in ~3s (fresh diagnostic this pass).

Note on the user's report: the harness captures stderr through the same PTY (the diagnostic error line
above WAS captured via the PTY), so the hint's absence is not a stderr-capture artifact. The hint the user
sees in a normal terminal most plausibly comes from their interactive shell wrapper (profile-level
function/alias around claude) or from claude only when it detects a real console; neither exists inside the
harness's cmd.exe /c call invocation. This remains a hypothesis - the harness-side fact is: no hint text
reaches the PTY stream.

## 9. Fix implication for the harness

Same as PASS 4, now with the timing confounder removed: there is NO exit-reported id in the harness PTY to
persist. The resume-blocking root cause stands: claude-code 2.1.215 never persists the PTY-spawned
conversation jsonl, even after graceful /exit with exit 0 and a 90s flush wait. Remaining options
(unchanged from PASS 3/4): (a) materialize the conversation jsonl from the harness transcript ring at stop
time (the harness owns the full PTY byte stream, including the reply bullet), (b) switch claude resume to
--continue / last-session semantics and verify the right session via transcript content, or (c) declare
claude resume unsupported and document it. If a future claude version prints an id at exit, a small
exit-text watcher (tail of the terminal ring at stop) could capture it, but there is no such signal today.

## 10. Risks / notes

- Baseline 2be75942-... jsonl (40KB, mtime 19:24:39 +0800) pre-dates the session spawn (19:26:54 +0800);
  identified as pre-existing, excluded from the 'new transcript' count.
- Temp diagnostic scripts cleaned; no orphan processes left (only pre-existing claude.exe 13856, the main
  agent's own session, remains; tasklist verified).
- Turn 1 prompt verified clean (34 chars, reply apple matched the word sent).
- 2 real AI turns bound: 1 used (apple), 1 skipped (memory turn not achievable without a live resumed session).

---

# RESUME Live E2E Evidence - PASS 6 (verifier decisive no-session-id probe, 2026-08-13)

Date: 2026-08-13 (UTC timestamps). Backend: wf-ui already running on http://127.0.0.1:56670
(v0.8.20, uptime 7084s at start; started from this checkout at PASS 3). All control via
Harness/scripts/wf-ui-control.mjs --url http://127.0.0.1:56670 --project . (env HARNESS_AGENT_KIND=main).
Runtime under test: claude 2.1.215 (deepseek-v4-pro[1M] max effort).
Hypothesis under test: "the harness passes --session-id <uuid> to claude, and this flag may suppress
transcript persistence" (user's normal-terminal claude sessions DO write transcripts - 2be75942-....jsonl,
39.5KB, July 31 - and print a resume hint at exit). Decisive probe: harness-equivalent spawn WITHOUT
--session-id, 1 real AI turn (mango), graceful /exit, 90s flush wait, then transcript + exit-hint checks.
Bounded to 1 real AI turn (spent on the decisive no-session-id probe; the with-session-id control
received NO AI turn by design).

## 1. Control: real harness create-agent WITH --session-id (no AI turn)

- create-agent (main, claude, real spawn, objective "No-session-id probe"): session
  e38e147d-fa3b-4789-a2a9-948872f11d0c, spawnPid 21184, status running; agentSessionId
  97b518b4-58b9-4cb6-ac4a-b992ecd54cab pre-assigned (API response = STATE.json).
- wmic cmdline (pid 21184): `cmd.exe /d /c call C:\Users\onion\AppData\Roaming\npm\claude.cmd
  --dangerously-skip-permissions --session-id 97b518b4-58b9-4cb6-ac4a-b992ecd54cab`; claude.exe
  (pid 28876) carries the same --session-id. => harness DOES pass --session-id <pre-assigned uuid>
  (consistent with PASS 2-5).
- agent.stop (graceful) -> {ok:true, action:agent.stop, lifecycle stopped}. terminal.jsonl (2 entries):
  boot banner + /exit echo; 0 'resume' tokens, 0 UUIDs, no hint. Baseline re-confirmed.

## 2. Decisive experiment: harness-equivalent spawn WITHOUT --session-id (the 1 real AI turn)

node-pty spawn (exact harness pty module @homebridge/node-pty-prebuilt-multiarch):
`cmd.exe /d /c call C:\Users\onion\AppData\Roaming\npm\claude.cmd --dangerously-skip-permissions`
(NO --session-id flag), cwd = repo root, 120x32, TERM=xterm-256color, HARNESS_AGENT_KIND=main +
HARNESS_PEER_SESSION_ID=<fresh uuid> env (harness identity vars only). Spawn 11:40:08.917Z, pid 24404.

| Step | Time (UTC) | Result |
|------|-----------|--------|
| TUI boot | 11:40:12 | Claude Code v2.1.215, deepseek-v4-pro[1M] with max effort, bypass permissions on, 1 MCP auth banner (non-blocking) |
| Turn 1 (only AI turn): 34 chars char-by-char + CR "Reply with exactly one word: mango" | 11:40:14.6 | all raw chars accepted |
| Reply | 11:40:19.2 | "Thought for 4s" then bullet `● mango` then "Cooked for 4s" - PASS, mango replied |
| Graceful /exit | 11:40:19.2 | PTY EXIT exitCode=0 (clean teardown, same as harness graceful stop) |
| 90s flush wait | 11:40:22 - 11:41:52 | stream silent after exit; nothing flushed late |

### 2a. Exit hint check (step 5a)

- Full PTY stream scan (8451 raw bytes): 0 "Resume this session", 0 "claude --resume", 0 UUID tokens,
  0 "No conversation found".
- Exit block (raw tail): ONLY terminal control sequences (mouse-mode off, alt-screen leave, cursor
  restore, window-title clear ESC]0;BEL); last human-readable content "⏵⏵ bypass permissions on
  (shift+tab to cycle)". NO hint text, NO id. => NO exit hint appears even WITHOUT --session-id.

### 2b. Transcript existence check (step 5b)

- claude minted its OWN id: ~/.claude.json projects["D:/MyFile/.../create-harness-vibe-coding"]
  lastSessionId = 90d2c392-5178-4dad-9a34-2ac48c0eafb2 (claude.json mtime 11:41:05.299Z, ~44s after
  PTY exit - async flush, no lingering process: tasklist shows only pre-existing claude.exe 13856).
- ~/.claude/session-env/90d2c392-... marker dir created at spawn (EMPTY); ~/.claude/tasks/session-90d2c392
  created (EMPTY). Same registration pattern as the pre-assigned id in PASS 2-5.
- find ~/.claude/projects/**/*.jsonl -newermt spawn: NO file under 90d2c392 or under ANY new id.
  Only files touched in the window: the main agent's own 34477ced transcript + its subagents dir
  (this pass's own tool-output persistence). Full-tree ~/.claude scan: same.
- => NO transcript written even when claude is free to use its own id.

## 3. Diagnostic resume of the SELF-MINTED id (step 6 precondition probe)

- Step-6 precondition ("if a new transcript id found") NOT met - no transcript exists under any id.
- Corroboration (harness pty, exact args): `claude.cmd --resume 90d2c392-5178-4dad-9a34-2ac48c0eafb2
  --dangerously-skip-permissions`, cwd = repo root: OUTPUT "No conversation found with session ID:
  90d2c392-5178-4dad-9a34-2ac48c0eafb2", EXIT_CODE 1 after 3.6s. The id claude itself minted is not
  restorable either.

## 4. Verdict

HYPOTHESIS REFUTED - --session-id is NOT the transcript-persistence suppressor.

1. WITHOUT --session-id (this pass): claude minted its own id (90d2c392), registered it in claude.json,
   created empty session-env + tasks markers, answered mango, exited 0 - but wrote NO conversation
   jsonl under its own id and printed NO exit hint.
2. WITH --session-id (control + PASS 2-5): identical outcome under the pre-assigned id.
3. => the harness's --session-id flag is exonerated; the cause lives in the PTY environment itself
   (node-pty + cmd.exe /c call wrapper vs a real console): claude-code 2.1.215 never persists
   PTY-spawned conversations regardless of who mints the id. The user's normal-terminal transcript
   (2be75942, 39.5KB) remains the only transcript source on this machine.
4. The exit hint the user sees also does not depend on --session-id: no hint appears in the harness
   PTY stream with or without the flag (PASS 4/5 + this pass) - consistent with PASS 5's note that the
   hint most plausibly comes from the user's shell wrapper (profile-level alias/function around claude)
   or from claude only when it detects a real console.

## 5. Fix implication

Dropping --session-id does NOT fix claude persistence; no harness spawn-flag change can make
claude-code 2.1.215 persist a PTY-spawned conversation. Remaining options unchanged from PASS 3/4/5:
(a) materialize the conversation jsonl from the harness transcript ring at stop time (the harness owns
the full PTY byte stream, including the reply bullet), (b) switch claude resume to
--continue/last-session semantics and verify the right session via transcript content, or (c) declare
claude resume unsupported and document it. Re-test if a future claude version persists PTY transcripts
or prints an id at exit - today there is no such signal in either direction (with or without
--session-id).

## 6. Risks / notes

- The with-session-id control session (e38e147d) received no AI turn by design (1-turn bound spent on
  the decisive probe); its stop was a boot-only graceful stop.
- Temp probe scripts + raw logs cleaned; no orphan processes (only pre-existing claude.exe 13856 and
  pre-existing MCP/bridge cmd.exe remain; tasklist verified).
- Turn-1 prompt verified clean (34 chars, reply mango matched).

---

# RESUME Live E2E Evidence - PASS 7 (decisive stored-session resume probe, 2026-08-14)

Question under test (user): can the harness DETECT claude's stored sessions, and can `resume`
itself be used to test/detect a stored session id? Decisive experiment: resume a session id
whose transcript EXISTS on disk, in the exact harness node-pty wrapper.

## 1. Storage scan (ground truth)

- `~/.claude/projects/D--MyFile-sample-synchronous-github-zingspark-create-harness-vibe-coding/*.jsonl`:
  150 transcripts (2026-07-20 .. 2026-08-13). Newest real transcript: `2be75942-ae81-440d-a316-6ffba9730b7f`
  (40,127B, mtime 2026-08-13T11:24:39Z - the user's own normal-terminal session; scrollback shows
  "你好" turn). The only file touched 08-13/14 during probe windows besides it: the main agent's own
  conversation 34477ced (8.3MB, grows with this pass).
- **ZERO transcripts exist for ANY harness PTY session id** (8537222b, 7ca05032, f46807ef, 97b518b4,
  90d2c392, 93e5c0e6 - none appear in the projects dir).
- `~/.claude.json` projects[repo].lastSessionId = 93e5c0e6 (a harness PTY registration); **no `history`
  array** in the project entry (2.1.215 does not maintain one here). session-env marker dirs exist for
  both real and PTY ids - markers are NOT a transcript signal.

## 2. Decisive test: resume a stored id WITH transcript, harness-equivalent PTY

node-pty spawn (exact harness pty module @homebridge/node-pty-prebuilt-multiarch):
`cmd.exe /d /c call %APPDATA%/npm/claude.cmd --resume 2be75942-ae81-440d-a316-6ffba9730b7f
--dangerously-skip-permissions`, cwd = repo root, 120x32, TERM=xterm-256color. No state files edited.

- 14s boot window output: TUI banner, then **the PRIOR conversation rendered in scrollback**:
  `❯ 你好` / `Thought for 7s` / `● 你好！有什么我可以帮你的吗？` / `Cogitated for 7s`.
- Checks: "No conversation found" = FALSE; conversation content = TRUE; `/exit` after capture ->
  PTY EXIT code=0. No orphan claude.exe left (only the main session's own claude.exe 10424,
  started 09:28 local, pre-existing; diagnostic child exited with the PTY).

## 3. Verdict (refines PASS 2-6)

**The node-pty environment does NOT block claude resume (reading).** Resume-by-id works perfectly in
the harness's exact pty wrapper when the transcript jsonl exists - proven live on the user's own
stored session. The blocker is one-sided: claude-code 2.1.215 never WRITES the transcript for a
PTY-spawned conversation (with or without --session-id, graceful or hard stop, 90s wait). No
transcript => no id can resume => "No conversation found" exit 1 (deterministic, PASS 2-6).

## 4. Fix implication (now precise)

Detection IS available and cheap: snapshot `~/.claude.json` lastSessionId + `~/.claude/projects/<key>/`
filenames at spawn, poll after spawn for registration, and check transcript existence for the session
id. That answers "is resume possible?" honestly (today: never for harness-spawned claude sessions).
Actual resume still requires one of: (a) materialize the conversation jsonl from the harness
terminal ring at stop time (format sample: any existing transcript, e.g. 2be75942), (b) switch to
`--continue`/last-session semantics, (c) document claude resume as unsupported.

---

# RESUME Live E2E Evidence - PASS 8 (claude transcript materialization, 2026-08-14)

Feature under test: stop-time claude transcript materialization (option A from PASS 3-7:
the harness rebuilds the conversation jsonl from its own terminal ring at stop, because
claude-code 2.1.215 never persists PTY-spawned conversations itself). Implemented in
src/wf-ui-server/claude-transcript-materializer.mjs + stopRuntimeSession wiring.

## 1. Unit level (workflow-claude-materialize.test.mjs, 10/10)

- U1/U2/U10: turn extraction for both ring shapes (CLI char-by-char + "\r" entries; API
  promptSubmit single full-prompt stdin entry with NO CR in the ring - the enter is a raw
  PTY write). Turn boundaries = the TUI answer bracket (● opens capture, ❯ ready closes).
- U3 slash-command filtering, U4 boot-only 0 turns, U8 answer cleanup (verb tail/spinners/
  thinking preview/multi-bullet), U5 schema-faithful line sequence, U6/U7 file write into
  the encoded project dir / no-turns skip, U9 project-dir encoding matches real claude dirs.
- Real-data check: extractor over the actual E2E session terminal.jsonl (33 entries) →
  exactly [{user:"Reply with exactly one word: mango", assistant:"mango"}].

## 2. Live E2E (real backend + real claude TUI, 12/12 checks across 2 parts)

| # | Check | Result |
|---|-------|--------|
| E1 | claude TUI boots in harness PTY | PASS |
| E2 | turn 1 answered (mango) via promptSubmit | PASS (typing slow on loaded machine - echo lag, not a harness fault) |
| E3 | stop of the ORIGINAL session (backend-restarted registry: disk-record fallback path) | PASS killed=false |
| E4 | transcript materialized at stop | PASS ~/.claude/projects/D--MyFile-.../e0c5c64b-....jsonl |
| E5 | materialized user prompt exact | PASS |
| E6 | materialized assistant reply | PASS "mango" |
| E7 | agent.start resume:true | PASS newSession c492ebf8 |
| E8 | resume wiring (--resume <agentSessionId>) | PASS |
| E9 | resumed TUI renders prior conversation | PASS |
| E10 | no "No conversation found" | PASS |
| E11 | memory question answered from materialized context | PASS (mango) |
| E12 | cleanup stop | PASS |

## 3. Bugs found & fixed during the pass (real E2E value)

1. **Ring shape assumption**: extractor v1 flushed prompts on "\r" stdin entries, but the
   promptSubmit path writes the enter as a raw PTY write → real sessions extracted 0 turns
   → materialize skipped. Fixed: bracket-delimited state machine (●...❯), both shapes pass.
2. **Registry-empty stop**: after a backend restart, sr.get(sessionId) is null → stop early-
   returned WITHOUT materializing, and the graph node had already rebound to a later resume
   session so agent.stop never touched the original again. Fixed: stopRuntimeSession now
   materializes from the disk record (listTerminalSessions lookup) on the early-return path,
   and POST /api/sessions/<id>/stop stops the original session directly.
3. **Backend died mid-pass** (between turn-1 completion and the stop; cause not yet
   isolated - old crashpad debug.log noise unrelated). Restart + disk-record fix made the
   flow resilient to it.

## 4. Verdict

**claude resume is now END-TO-END WORKING via harness-side materialization.** The 6-pass
runtime limitation (no transcript ever written for PTY sessions) is bypassed: the harness
owns the full PTY byte stream, rebuilds a schema-faithful 2.1.215 transcript at stop, and
claude --resume <agentSessionId> restores the conversation with memory intact (proven by
the E11 memory question). Zero LLM tokens: pure string extraction, ms-scale.

Known limits: materialized content is prompt text + final reply text only (no thinking,
no tool-call internals); the materialized file overwrites on repeated stops (idempotent).

Follow-up (same day): "❯" truncation SOLVED. Turn-over detection no longer closes on any
"❯": it requires the verb+❯ signature (✻Verb for Xs❯, TURN_OVER regex); a lone "❯" in the
answer (quoted shell prompt) is preserved. Fallback: a verb-less ready "❯" sets sawReady,
and the next prompt's stdin closes the turn. cleanAnswer now strips only a TRAILING "❯".
Unit tests: U12 (❯ preserved in answer), U13 (verb-less ready closed by next prompt input)
+ regression on the real E2E session data (mango turn still exact). 12/12 green.
