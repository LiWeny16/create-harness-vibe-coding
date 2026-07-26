# External Benchmark Assets

This directory is a repository proof area for HarnessBench. It is intentionally
outside `Harness/` and outside `templates/`, and `package.json` does not include
it in the npm package files.

Generated Harness installs should carry published result summaries only. They
must not receive benchmark fixtures, raw run logs, scorer scripts, or task
schemas.

## Current Assets

- `results/harnessbench-local-v0.2.json` - 15-round-per-mode local lifecycle
  proof for fresh install, existing project preservation, same-name user skill
  protection, old-Harness updater recovery, and benchmark exclusion.
- `../scripts/harness-bench.mjs` - scorer for raw result JSON.
- `../scripts/harness-bench-local.mjs` - local runner that regenerates the raw
  v0.2 result JSON from fixture projects.

Run:

```bash
node scripts/harness-bench-local.mjs --output benchmarks/results/harnessbench-local-v0.2.json
node scripts/harness-bench.mjs --input benchmarks/results/harnessbench-local-v0.2.json --markdown
```
