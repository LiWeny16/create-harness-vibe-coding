---
name: github-pr-review
description: GitHub pull request review workflow using available GitHub CLI, local git diff, checks, and CI evidence.
---

# GitHub PR Review

## When To Use

Use this skill when reviewing a GitHub pull request, responding to PR feedback, checking CI status, or summarizing review findings.

## Docs To Load

- `Harness/workflows/github-pr-review.md`
- `Harness/PROGRESS.md` and current task `tasks/<id>/PLAN.md`
- Repository contribution, test, and review guidelines.

## Required Inputs

- PR number, branch, or comparison range.
- Review goal: bug hunt, approval readiness, CI diagnosis, or feedback response.
- Expected test and check requirements.

## Allowed Writes

- Local files needed to address approved review feedback.
- Review notes or evidence in existing docs only when requested.
- Current task `tasks/<id>/PLAN.md` when tracking review work.

## Output Format

Return findings first by severity with file and line references, then open questions, tests/checks run, and change summary if edits were made.

## PROGRESS.md & Task PLAN.md Updates

Update `Harness/tasks/<task-id>/PLAN.md` only when the PR review is part of a tracked implementation plan.

## dispatch.md Usage

Use `Harness/dispatch.md` when independent review areas can be assigned separately, such as backend, frontend, and CI.
