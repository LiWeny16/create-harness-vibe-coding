# CLAUDE.md

## 1. Startup

- Every session: read `MEMORY.md`, then `docs/README.md`.
- If `SETUP.md` exists in the project root, read it first.
- All routing, role-based reading, and per-task doc loads live in `docs/README.md`. Not here.
- If work spans more than one step, update `docs/harness/PLAN.md`.
- Universal rules live in `.claude/rules/ecc/common.md`.
- Never bulk-read `docs/`.

---

Behavioral guidelines to reduce common LLM coding mistakes. For trivial tasks, use judgment. These bias toward caution over speed.

## 2. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

### 2.1 Confidence Threshold (Non-Negotiable)

- You must have **≥95% confidence** in user intent before writing implementation code.
- If confidence is below 95%, stop and ask. False confidence is worse than a question.
- **Maximum 3 blocking questions per decision point.** Ask the highest-impact questions first.
- If you catch yourself thinking *"this is probably what they want"* — that is a mandatory stop condition. Ask.
- **Silent picks are forbidden.** When two valid approaches exist and you cannot decide with 95% confidence, present both trade-offs to the user.
- Record every assumption explicitly in `docs/harness/PLAN.md` so the user can correct it.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 3. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 4. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 5. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## 6. Memory & Self-Learning

- **User memory**: triggers "remember", "never", "next time", "always", "I prefer" — persist newest-first under `MEMORY.md#User Mem`. Don't record ordinary chat. Ambiguous? Ask.
- **Tool memory**: auto-record under `MEMORY.md#Tool Usage Standards` when a tool/pattern fails 3+ times or a better alternative is found. Update old entries, don't duplicate. Never record secrets.
- Format details live in `MEMORY.md`, not here.
