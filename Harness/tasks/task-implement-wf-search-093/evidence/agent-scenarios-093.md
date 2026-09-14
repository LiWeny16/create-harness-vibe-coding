# wf-search 0.9.3 agent-facing scenario evidence

Date: 2026-09-13  
Candidate SHA: `0b4451266ae0883f523a1786ed52ebce3523f5f5`

These are three repeatable controller/agent scenario probes executed against the clean candidate. They exercise the same packaged contract an Agent uses after loading `wf-search/SKILL.md`; the helper itself remains stateless and does not perform network calls. No live Claude provider session was available on this host, so the evidence records deterministic ledger outcomes rather than claiming a remote search occurred.

## Fact mode

Input: `C:/Users/onion/Documents/Codex/2026-09-13/wf-search-clean-093c/agent-scenarios/fact.json`  
Command: `node Harness/scripts/wf-search.mjs validate --input agent-scenarios/fact.json --json`  
Result: exit `0`, `ok: true`, `mode: fact`, `status: complete`, 5 operations, 3 sources, 4 claims. The major fact is supported by the full-access official source.

## Compare mode

Input: `tests/fixtures/wf-search/valid-compare.json`  
Command: `node Harness/scripts/wf-search.mjs validate --input tests/fixtures/wf-search/valid-compare.json --json`  
Result: exit `0`, `ok: true`, `mode: compare`, `status: complete`, 5 operations, 3 sources, 4 claims. The ledger preserves a disputed minor claim and a community observation without promoting them to universal facts.

## Tool-unavailable fallback

Input: `C:/Users/onion/Documents/Codex/2026-09-13/wf-search-clean-093c/agent-scenarios/unavailable.json`  
Command: `node Harness/scripts/wf-search.mjs validate --input agent-scenarios/unavailable.json --json`  
Result: exit `0`, `ok: true`, `mode: fact`, `status: incomplete`, 1 unavailable search, 0 sources, 0 claims. The stop reason explicitly records the unavailable tool and the report makes no fabricated claim.

The three probes were run with the same root helper and the same schema validator; no files were written by `validate`/`render`.
