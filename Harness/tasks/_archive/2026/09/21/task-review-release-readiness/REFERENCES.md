# task-review-release-readiness - REFERENCES

## Logs

| Description | File / Command | Date |
|-------------|---------------|------|

## Evidence

| What | Pointer | Verified |
|------|---------|----------|
| Release process and dual-channel gate | README.md:251-278 | yes |
| Candidate features | README.md:72, README.md:96-97, Harness/specs/guides/extension.md:62-88 | yes |
| Version metadata | package.json:3, CHANGELOG.md:3 | yes |
| Gate output | `npm run prepush`, `npm run check:mirrors`, `node scripts/build-version.mjs --check`, `node scripts/check-root-harness-version.mjs` | yes |
| Test rerun | `npm test` | yes |

## Links

| Description | URL / Path |
|-------------|------------|

## Notes

-
