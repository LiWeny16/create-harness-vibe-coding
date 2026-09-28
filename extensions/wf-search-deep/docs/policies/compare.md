# Policy: compare

Mode `compare` — compare two or more options under the same conditions.

## Same-Condition Comparison

Compare options on a common evaluation grid: capability, limits, platform
support, license, maintenance activity, migration cost. Do not compare one
option's marketing page against another's issue tracker; assemble each
criterion from comparable source types and note the asymmetry when
comparable data is missing.

## User Constraints First

Constraints stated by the user (runtime version, license requirements,
budget, offline operation, team skills) filter and weight the criteria
before any general ranking. Record the constraints in `constraints` on the
result. A technically superior option that violates a user constraint is
reported as such, not recommended.

## Maturity Signals

Stars, download counts, and a single enthusiastic or angry review do not
prove maturity or community consensus. They may be recorded as
`community-observation` claims scoped to exactly what was observed ("the
repo showed N stars on the checked date"), never as facts about quality.

## Recommendation vs Fact

Keep `recommendation` claims separate from `fact` claims. A recommendation
must reference the facts and constraints it depends on through
`supportIds`/`dependsOnClaimIds`. Present the comparison as a table in the
user report; state which cells are direct evidence and which are inference.

## Gaps

When an option's data could not be found with the available tools, record the gap
explicitly instead of silently omitting the criterion.

