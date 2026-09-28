# Policy: fact

Mode `fact` — confirm a single object, version, date, capability, or other
discrete fact.

## What to Confirm

Identify exactly what is being confirmed: the artifact name, the version or
date (if the question is versioned), and the precision the user needs. A
"fact" pass answers one bounded question, not a survey.

## Source Priority

Official primary text first: vendor documentation, release notes, the
standard/spec text, or the project's own source code. Source code outranks
blog posts and summaries. Community restatements are corroboration only,
never the primary support for a supported fact.

## Early Stop

If direct official evidence fully answers the question (for example a
changelog entry naming the exact version and date), stop after that single
query/read. Record the early stop reason in `stopReason`. Do not spend the
re-confirming an already-direct answer or repeating the same source.

## Dates

Record `publishedAt` only when the source itself states or clearly implies a
publication date. When the date is unknown, set `publishedAt: null` — never
infer, approximate, or copy an unrelated page date. A null date is valid; a
fabricated date is not. An old source is not automatically wrong, but do not
claim a current version was verified from stale evidence.

## Claims

The confirmed fact is normally one `fact` claim with `importance: major` and
at least one supporting source whose `access` is not `snippet`. Note
versioning caveats (e.g. "as of the checked date") in `confidenceReason` or
`limitations`.

