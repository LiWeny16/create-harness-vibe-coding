# Startup Hints (L2 Memory Digest)

> L2 = lightweight startup memory digest. New Harness sessions may read this
> file after `CLAUDE.md`, but must not load full `Harness/MEMORY.md`,
> `Harness/README.md`, or `Harness/PROGRESS.md` during thin startup.

## Core Principles

- Memory is short scenario guidance, not a task log.
- Do not write timestamps by default; write only durable, reusable guidance.
- Broad runtime hooks are forbidden. The only Harness exception is the bounded `/wf-auto` tick hook.
- Direct mode must not load the full Harness router. `startup-hints.md` is the lightweight startup allowance.
- Detailed memory still loads only when routed through `MEMORY_PROTOCOL.md`.

## Memory Candidate Detection

Treat these as memory candidates:

- English: remember, next time, don't, do not, never, always, I prefer, I want you to
- Chinese: 记住, 下次, 以后, 不要再, 总是, 永远不要, 我偏好, 我希望你以后

## When to Write Memory

- Explicit user preference: write immediately only when clear, safe, and reusable.
- Repeated implicit correction: same assumption or pattern corrected 2+ times.
- Tool/command failure: same tool or command pattern fails 3+ times.
- Review/debug lesson: write only when it is reusable and can prevent regressions.

## What NOT to Write

- Task logs, process summaries, or one-off emotions.
- Raw logs or transcripts.
- Secrets, tokens, credentials, or private data.
- Temporary preferences or notes with no reusable value.
