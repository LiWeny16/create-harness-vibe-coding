# GitHub PR Review Workflow

## Required Evidence

- PR URL or number and base/head refs.
- Diff or changed-file summary.
- CI/check status and relevant failing logs.
- Review findings with exact file and line references when available.

## Common Commands

```powershell
gh pr view --web
gh pr view --json number,title,baseRefName,headRefName,mergeStateStatus,statusCheckRollup
gh pr diff
git diff --stat
npm test
```

Use repository-specific test commands when they differ from npm.

## Fallback

If `gh` is unavailable or unauthenticated, use local git refs, remote URLs, and `git diff` against the target branch. Ask for missing PR context only when it cannot be inferred.

## Windows Notes

Quote branch names containing special characters. In PowerShell, pipe JSON output to tools that are available locally, or read it directly if `jq` is not installed.
