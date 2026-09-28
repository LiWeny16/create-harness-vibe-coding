# Policy: troubleshoot

Mode `troubleshoot` — diagnose an error or misbehavior using external
evidence matched to the local environment.

## Local Facts First

Before any external search, confirm the local facts: the exact error text,
the tool/library versions in use, the platform, and what already changed
recently. A mismatched-version answer is worse than no answer; record the
local environment in `constraints`.

## Redacted Minimal Query

Build the smallest query that identifies the problem: the distinctive error
token or message fragment plus the exact version, with paths, usernames,
hostnames, tokens, and business data removed. Never paste raw private logs
into a search tool. Redact first; if a log line cannot be safely reduced to
its distinctive tokens, do not send it.

## Environment-Matched Evidence

Weight found evidence by how closely its environment matches the local one
(same major version, same platform). An applicable fix for a different
version is a hint, not an answer — record the version it actually applies
to in the claim or source notes.

## No Uploads

This mode never uploads raw private logs, configuration files, or secrets to
any search tool, paste site, or third-party service. Evidence flows in
(search results), private data does not flow out.

## Outcome

Report the most probable cause with its evidence, the steps to verify it
locally, and alternatives when several causes match. If no
environment-matched evidence is found with the available tools, say so and record the
gap rather than generalizing from mismatched versions.

