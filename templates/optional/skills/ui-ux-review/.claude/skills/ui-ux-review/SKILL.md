---
name: ui-ux-review
description: Screenshot-driven UI and UX review for responsive behavior, accessibility, visual polish, and task clarity.
---

# UI/UX Review

## When To Use

Use this skill when reviewing or changing user-facing screens, layouts, visual hierarchy, interaction states, accessibility, or responsive behavior.

## Docs To Load

- `docs/workflows/ui-ux-review.md`
- `docs/harness/PLAN.md`
- Existing design system, component, or style documentation.

## Required Inputs

- Screens, routes, or components under review.
- Target users and primary tasks.
- Breakpoints, themes, and accessibility expectations.

## Allowed Writes

- UI code and style files already in scope for the task.
- Screenshot or audit artifacts in existing evidence folders.
- `docs/harness/PLAN.md` when the review is part of a tracked plan.

## Output Format

Return prioritized findings with file or screen references, evidence, recommended fixes, commands run, and residual risks.

## PLAN.md Updates

Update `docs/harness/PLAN.md` only for tracked review tasks or when recording required evidence.

## dispatch.md Usage

Use `docs/harness/dispatch.md` only for independent review streams such as separate routes or breakpoints.
