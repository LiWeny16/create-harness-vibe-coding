---
name: wf-readme
description: Use when a project README already exists and the user asks to preserve, merge, modernize, optimize, or clarify repository documentation during harness install or documentation work.
---

# README Optimizer

Improve `README.md` without breaking project-owned public docs.

## Load

- root `README.md`
- package files and scripts (`package.json`, `pyproject.toml`, `go.mod`, etc.)
- CI files when present
- `Harness/PROGRESS.md`
- `Harness/tasks/<task-id>/PLAN.md` when available
- `Harness/architecture.md` only when an architecture summary or diagram is requested

## Mode

Ask the user which mode they approve when the existing README is meaningful:

| Mode | Use when | Allowed edit |
| --- | --- | --- |
| Preserve + append | default for existing projects | Add only a compact Development, Test, Build, Git, or Harness section |
| Structure pass | README is stale, hard to scan, or missing operational docs | Reorganize with headings, tables, command blocks, and links while preserving facts |
| Full rewrite | user explicitly wants a polished public README | Rewrite after approval; keep claims source-backed |

If unanswered, use Preserve + append.

## Rules

- Preserve existing product, package, API, and public-facing content unless the user approves a rewrite.
- Do not invent features, benchmarks, roadmap, support policy, badges, install commands, or CI status.
- Use tables for command matrices, environment variables, endpoints, and deployment notes when facts are known.
- Use Mermaid or ASCII architecture diagrams only when the structure is observed or approved; label uncertain diagrams as proposed.
- Keep detailed architecture in `Harness/architecture.md`; README may link to it or show a short overview.
- Keep agent rules in `CLAUDE.md`/`AGENTS.md`, not README.
- Record the chosen mode and any skipped README improvements in `Harness/tasks/<task-id>/PLAN.md` when available.

## Output

Before broad edits, return:

1. chosen mode
2. sections to preserve
3. sections to add or reorganize
4. facts still unknown
5. verification command or manual review step
