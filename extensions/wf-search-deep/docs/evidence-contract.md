# Evidence Contract (ResearchResult schema, schemaVersion=1)

Summary of the validated ledger. The helper
(`Harness/scripts/wf-search.mjs validate`) is authoritative for the exact
error codes; this file is the agent-facing contract.

## Shape

- Top level: `schemaVersion, question, mode, checkedAt, constraints,
  operations[], sources[], claims[], status(complete|incomplete), stopReason,
  limitations[]`. The Agent decides search effort; no operation
  budget is imposed by this workflow.
- operations: `id, kind(search|read), tool, query|url,
  outcome(success|unavailable|failed), checkedAt`. A source may link several
  operations; every source must link the operations that actually read or
  discovered it.
- sources: `id, url, title,
  sourceType(official|source-code|issue|paper|community|news|other),
  publishedAt|null, retrievedAt, access(full|excerpt|snippet), excerpt,
  locator, originGroup|null, operationIds`.
- claims: `id, text, kind(fact|inference|community-observation|
  recommendation), importance(major|minor), supportIds, contradictionIds,
  dependsOnClaimIds, status(supported|disputed|insufficient),
  confidence(high|medium|low), confidenceReason, gaps`.

## Validation Rules

1. Required fields, types, and lengths: `question` 1-500; `claim.text`
   1-2000; `excerpt` <=2000; ids match `^[a-z0-9][a-z0-9-]{0,63}$`; duplicate
   ids rejected.
2. Enumerations: mode (4 values), sourceType (7), access (3), claim.kind
   (4), importance (2), claim.status (3), confidence (3), operation.kind
   (2), operation.outcome (3).
3. Dangling references rejected: `claim.supportIds`, `contradictionIds`,
   `dependsOnClaimIds`, and `source.operationIds` must resolve to existing
   ids; claim dependency cycles rejected (DFS).
4. Dates: `publishedAt`/`retrievedAt`/`checkedAt` are ISO-8601 strings or
   null; unparseable dates rejected; `publishedAt: null` is valid (never
   fabricate a publication date).
5. Operation counts are recorded for auditability only. Search and read
   failures still belong in the ledger, but the workflow does not reject a
   valid result because it contains many operations.
6. A `supported` claim of kind `fact` or importance `major` needs at least
   one support from a source whose `access` is not `snippet` (WFR-EVD001).
7. A `major` claim that is `insufficient`/`disputed` forces overall
   `status: incomplete`; a `complete` result with an unexplained significant
   contradiction is an error (WFR-STA001).
8. `inference`/`recommendation` claims require non-empty `supportIds`
   (WFR-EVD002); `community-observation` text must not assert beyond the
   observed scope (warning).
9. URLs: http/https only; normalization removes only known tracking
   parameters (`utm_*`, `fbclid`, `gclid`, `msclkid`, `ref_src`); other
   query parameters and fragments are kept; URLs are never merged across
   origins; `originGroup` must be explicit when used.
10. Rendering escapes title/excerpt/question/text as HTML entities and
    strips `[text](url)` Markdown link syntax to plain text; non-http(s)
    URLs are never rendered as links.

## Operation Ledger

- A batch of 4 queries records 4 operations.
- Failed and unavailable operations remain recorded for auditability.
- Search-result snippets and page reads keep their distinct operation kinds;
  neither kind is capped by this workflow.

## Claim Evidence Caps

Each claim keeps at most 3 primary supporting sources in `supportIds` for
the report; ALL significant counter-evidence must be kept in
`contradictionIds`. Other recorded evidence stays in the ledger without
being pushed into the main context.

## Capability Boundary

The helper verifies that the record is self-consistent and that citations
exist within it. It does not prove pages are real, conclusions semantically
correct, or that no tool calls went unrecorded. Budgets are a protocol
constraint and post-hoc check, not a host-tool hard rate limiter.


