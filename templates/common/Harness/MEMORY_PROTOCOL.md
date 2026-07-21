# Memory Protocol

Purpose: record durable lessons from acceptance, validation, and debug work without storing noisy or sensitive context.

Memory is downstream of evidence. It records reusable patterns, not raw transcripts.

## L1/L2/L3 Memory Architecture

- **L1 = File/Project Facts**: CLAUDE.md, Harness/README.md, PROGRESS/task capsules. Always loaded when relevant.
- **L2 = Startup Digest**: `Harness/memory/startup-hints.md`. Lightweight hints loaded at session start. Not a replacement for full router.
- **L3 = Detailed Durable Memory**: `Harness/memory/*.md` files. Loaded only when scenario matches via `routes.md`.

## When To Write Memory

Write memory when any condition applies:

- **Explicit user preference**: 用户显式说 remember/next time/never/always/记住/下次/不要再 时，清晰、安全、场景明确可立即写入 L3 (explicit user preference can be written immediately when safe and scoped)
- **Repeated implicit correction**: 同一假设/模式被纠正 2+ 次 — user corrects the same assumption or preference 2+ times
- **Tool/command pattern fails 3+ times**: 同类工具/命令失败 3+ 次 — same tool or command pattern fails 3+ times
- **Review/debug/validation lesson**: 只有可复用、能防回归时才写
- **WF closeout**: context-master 提取 durable knowledge 后写入

## What To Record

Memory entries should be short and AC-aware when possible. Use **compact format** (default no date):

```markdown
- When <scenario>: <rule>. Avoid <over-application>. Signals: <signals>.
```

Only use date/timestamp headings when:
- Entry supersedes prior conflicting guidance
- Time-sensitive context (version, deprecation)
- Conflict resolution needed

Good memory:

- failure mode
- root cause pattern
- better command or protocol
- affected AC IDs or workflow docs
- proof that the lesson is durable

Bad memory:

- secrets, tokens, credentials, private user data
- full logs when a summary is enough
- transient speculation
- implementation summaries with no reusable lesson
- task logs, process summaries, one-time emotions

## Memory Candidate Detection

**Explicit trigger phrases** (中英文):
- 英文: remember, next time, don't, do not, never, always, I prefer, I want you to
- 中文: 记住, 下次, 以后, 不要再, 总是, 永远不要, 我偏好, 我希望你以后

**Decision flow**:
```
detect candidate -> classify target file -> safety filter -> dedup -> write/update -> return concise summary
```

- **Explicit user preference**: can be written immediately when safe and scoped
- **Repeated implicit correction**: still requires 2+ occurrences
- **Tool failure**: 3+ same failures required
- **Review/debug lesson**: only when reusable and regression-preventing

## Memory Routing (L3)

Routes are defined in `Harness/memory/routes.md`. Not detailed memory, but hit-rules index.

**Scenario pack**: intent / files / commands / signals / risk

**Scoring**:
- +4 exact file/path match
- +3 explicit trigger phrase match
- +3 command/error signature match
- +2 workflow/mode match
- +1 keyword overlap
- -4 avoid match

**Thresholds**:
- score >= 5: load matching entry/file section
- score 3-4: load route summary only
- score < 3: load nothing

**Hard triggers** (bypass scoring):
- Explicit user memory statement → user-corrections-preferences.md
- Same command fails 3x → tool-usage-reflections.md
- Review/debug/validation reusable lesson → agent-lessons-patterns.md
- Modifying hook-related files → load only-wf-auto hook lesson
- /wf-learn → full learning cycle

**Load logging**: always state `memory hints loaded: <id> because <signal>`

No embedding; keep stable, explainable, token-efficient.

## Scenario Memory Hints

Controllers, context-master, or memory-master may load a compact memory hint when the current task matches a known scenario.

| Scenario | Load Or Hint |
| --- | --- |
| new session / startup | `Harness/memory/startup-hints.md` (L2 digest) |
| same tool or command error repeats | matching entries from `memory/tool-usage-reflections.md` |
| user repeats a correction or preference | matching entries from `memory/user-corrections-preferences.md` |
| review/debug/validation failure | matching entries from `memory/agent-lessons-patterns.md` |
| acceptance/UI/API work | relevant AC/debug lessons plus `ACCEPTANCE_PROTOCOL.md` and `HARNESS_BRIDGE.md` |
| WF closeout | context-master extraction, then memory-master write/dedup |
| `/wf-auto` cycle start | auto PROGRESS/PLAN summary plus memory hints tied to the selected angle |

Hint rules:

- load or summarize 3-10 bullets, not whole memory files
- include file paths and trigger reasons
- include AC IDs or failure signatures when available
- load nothing when no relevant memory exists
- never inject secrets, credentials, tokens, private data, or raw transcripts
- memory-master owns writes; controller/context-master route context

## Closeout Flow

For WF closeout:

```text
context-master
-> extract durable acceptance/debug/validation lessons
-> memory-master
-> deduplicate
-> write concise entry
```

Memory Master writes to:

- `Harness/memory/tool-usage-reflections.md`
- `Harness/memory/user-corrections-preferences.md`
- `Harness/memory/agent-lessons-patterns.md`
- `Harness/MEMORY.md` only for routing/index updates

## Memory Write Flow

Memory write triggers must never append raw logs directly to memory files.

Safe write flow:

```text
controller detects trigger
-> context-master extracts durable candidate
-> memory-master reads existing memory
-> memory-master deduplicates or merges
-> memory-master writes concise entry
-> controller records file path and reason
```

## Traceability

When a lesson comes from acceptance work, include:

- AC ID or contract name
- command or validation method
- failure layer
- final fix or operating rule

This keeps future agents from relearning the same acceptance gap.
