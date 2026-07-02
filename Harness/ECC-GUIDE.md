# ECC Rules Guide — Stack to Rule Set Mapping

ECC (Engineering Code Conventions) rules are organized by language/domain under `~/.claude/rules/ecc/`. The Harness bootstrap process MUST install the appropriate rule sets for the project's tech stack.

## Installation

```bash
# From the ECC rules repository:
cp -r rules/common .claude/rules/ecc/
cp -r rules/<language> .claude/rules/ecc/

# Verify:
ls .claude/rules/ecc/
```

## Stack Detection (Automatic)

| File Found | Stack | Install These Rules |
|------------|-------|-------------------|
| `package.json` + `tsconfig.json` | TypeScript/Node | `common/`, `typescript/`, `web/` |
| `package.json` (no tsconfig) | JavaScript/Node | `common/`, `typescript/` (JS mode), `web/` |
| `go.mod` | Go | `common/`, `golang/` |
| `pyproject.toml` / `requirements.txt` | Python | `common/`, `python/` |
| `Cargo.toml` | Rust | `common/`, `rust/` |
| `Gemfile` | Ruby/Rails | `common/`, `ruby/` |
| `composer.json` | PHP | `common/`, `php/` |
| `build.gradle` / `pom.xml` | Java/Kotlin | `common/`, `java/` or `kotlin/` |
| `*.sln` / `*.csproj` | C#/.NET | `common/`, `csharp/` |
| `Package.swift` | Swift | `common/`, `swift/` |
| Multiple frontend files (`.vue`, `.tsx`, `.jsx`) | Web frontend | Add `web/` to any stack |

## Stack Detection (Ask User)

If no stack markers are found (empty/new repo), ask:

> "What's your tech stack? I need to install the right coding rules.
>  Options: TypeScript/Node, Python, Go, Rust, Ruby, PHP, Java, Kotlin, C#, Swift, or other.
>  Frontend framework? (React, Vue, Next.js, Nuxt, none)"

Based on answer, install matching rules.

## Rule Set Catalog

| Rule Set | What It Covers | Files |
|----------|---------------|-------|
| `common/` | **Required for all projects.** Immutability, error handling, file organization, git workflow, testing, security, agents, hooks, patterns. | `coding-style.md`, `git-workflow.md`, `testing.md`, `security.md`, `patterns.md`, `agents.md`, `hooks.md`, `performance.md`, `development-workflow.md` |
| `typescript/` | TS/JS types, interfaces, immutability patterns, error handling with try-catch, Zod validation, React props, custom hooks, repository pattern. | `coding-style.md`, `testing.md`, `security.md`, `patterns.md`, `hooks.md` |
| `web/` | Frontend: CSS custom properties, animation-only properties, semantic HTML, component composition, state management, image optimization, CSP, XSS, Core Web Vitals, bundle budgets. | `coding-style.md`, `design-quality.md`, `testing.md`, `security.md`, `patterns.md`, `performance.md`, `hooks.md` |
| `python/` | PEP 8, type hints, immutability, async patterns, pytest, input validation. | `coding-style.md`, `testing.md`, `security.md`, `patterns.md` |
| `golang/` | Idiomatic Go, error handling, concurrency patterns, table-driven tests, security. | `coding-style.md`, `testing.md`, `security.md`, `patterns.md` |
| `rust/` | Ownership, lifetimes, error handling, unsafe usage, cargo-llvm-cov. | `coding-style.md`, `testing.md`, `security.md`, `patterns.md` |
| `ruby/` | Ruby idioms, Rails patterns, RSpec, security. | `coding-style.md`, `testing.md`, `security.md` |
| `php/` | PSR-12, Eloquent ORM, security, testing. | `coding-style.md`, `testing.md`, `security.md` |
| `swift/` | Protocol-oriented design, value semantics, ARC, Swift Concurrency. | `coding-style.md`, `testing.md`, `security.md` |
| `arkts/` | HarmonyOS/ArkTS specific. | `coding-style.md`, `testing.md`, `security.md` |
| `angular/` | Angular specific patterns. | Extends `typescript/` and `web/` |
| `vue/` | Vue 3 Composition API, reactivity, Pinia. | Extends `typescript/` and `web/` |
| `nuxt/` | Nuxt 4 specific. | Extends `vue/` |

## Recommended Combinations

| Project Type | Rule Sets |
|-------------|-----------|
| React + TypeScript frontend | `common/`, `typescript/`, `web/` |
| Vue 3 frontend | `common/`, `typescript/`, `web/`, `vue/` |
| Next.js fullstack | `common/`, `typescript/`, `web/` |
| Python backend (FastAPI) | `common/`, `python/` |
| Go microservice | `common/`, `golang/` |
| Rust CLI tool | `common/`, `rust/` |
| Electron + React desktop | `common/`, `typescript/`, `web/` |
| React Native mobile | `common/`, `typescript/`, `web/` |

## Bootstrap Verification

After installing ECC rules, verify:

```bash
ls .claude/rules/ecc/common/          # MUST exist
ls .claude/rules/ecc/<language>/      # MUST exist for detected/declared stack
```

If rules are missing, the agent MUST install them before proceeding to step 1.
