# Policy: verify

Mode `verify` — check an existing claim or statement against real evidence,
actively looking for counter-evidence.

## Decompose First

Split the original statement into separately checkable atomic claims. A
compound statement ("X is deprecated, fast, and unsupported on Windows") is
verified claim by claim; the overall verdict is assembled from the parts,
never asserted wholesale.

## Support and Counter-Evidence

For each atomic claim, look for supporting evidence AND significant
counter-evidence. Searching only for confirmation is a protocol violation:
record contradiction sources in `contradictionIds`, not only in free text.
Counter-evidence that is significant must be kept even when inconvenient.

## Handling Conflicts

- Evidence conflicts but one side is clearly primary/official and newer:
  the claim may stay `supported` with the conflict noted in `gaps` or
  `confidenceReason`.
- Conflict is unresolvable with available evidence or credibility: mark the claim
  `disputed`, keep both sides' sources, and set the overall `status` to
  `incomplete`. A disputed result is a legitimate outcome; do not force a
  verdict.
- A `complete` result that still carries an unexplained significant
  contradiction is invalid (see `references/evidence-contract.md`).

## Independence

Treat source independence explicitly. Different domains are not
automatically independent sources; syndicated or mirrored coverage needs an
explicit `originGroup`. When independence is unknown, say so — an
independence of `unknown` never counts as proven independent corroboration.

## Absence of Evidence

If the claim is about absence ("feature X does not exist"), record what was
searched and where; absence findings are `insufficient` rather than
`supported` unless an authoritative negative statement (official "not
supported" note) is found.

