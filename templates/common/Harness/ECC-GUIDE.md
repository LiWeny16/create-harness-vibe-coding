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
| `common/` | **Required for all projects.** Immutability, error handling, file organization, git workflow, testing, security, agents, patterns, performance, development workflow. | `coding-style.md`, `git-workflow.md`, `testing.md`, `security.md`, `patterns.md`, `agents.md`, `performance.md`, `development-workflow.md` |
| `typescript/` | TS/JS types, interfaces, immutability patterns, error handling with try-catch, Zod validation, React props, reusable React hooks, repository pattern. | `coding-style.md`, `testing.md`, `security.md`, `patterns.md` |
| `web/` | Frontend: CSS custom properties, animation-only properties, semantic HTML, component composition, state management, image optimization, CSP, XSS, Core Web Vitals, bundle budgets. | `coding-style.md`, `design-quality.md`, `testing.md`, `security.md`, `patterns.md`, `performance.md` |
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

## ECC Design Rules — Frontend + Backend Architecture

Beyond coding style, ECC provides design-level guidance for both frontend and backend.
These are NOT in Harness by default — the agent should consult them when filling
`Harness/architecture.md` and `Harness/research/research-results.md`.

### Frontend Design (web/ + typescript/)

| Rule File | Design Guidance | When to Apply |
|-----------|----------------|---------------|
| `web/design-quality.md` | Anti-template policy, required qualities (hierarchy, depth, typography, motion, color semantics), banned patterns (stock hero, default card grids, safe gray-on-white) | Before writing any frontend code |
| `web/patterns.md` | Compound components, render props, container/presentational split, state management (server/client/URL/form), URL as state, stale-while-revalidate, optimistic updates | When architecting frontend data flow |
| `web/performance.md` | Core Web Vitals targets, bundle budgets, loading strategy, image optimization, font loading, animation performance | Before production build |
| `web/security.md` | CSP (nonce-based), XSS prevention, third-party script SRI, HTTPS headers, CSRF protection | Before any user-facing deploy |
| `web/testing.md` | Visual regression (320/768/1024/1440), a11y, Lighthouse, cross-browser, responsive | Before launch |
| `web/testing.md` | format/lint/type-check, file size guard, build verification | CI setup |
| `typescript/patterns.md` | API response envelope, custom hooks, Repository pattern | Backend-frontend contract |

### Backend Design (python/ + golang/ + rust/)

| Rule File | Design Guidance | When to Apply |
|-----------|----------------|---------------|
| `python/fastapi.md` | FastAPI patterns: async correctness, dependency injection, Pydantic schemas, OpenAPI quality | Python API projects |
| `python/patterns.md` | Repository pattern, service layer, API response format | Any Python backend |
| `golang/patterns.md` | Idiomatic Go patterns, concurrency, error handling | Go microservices |
| `rust/patterns.md` | Ownership patterns, error handling, unsafe usage | Rust services |
| `common/patterns.md` | Skeleton projects, Repository pattern, API response format, design pattern guidance | All projects |

### Architecture Templates

Write the project-specific structure in `Harness/architecture.md`. Use the ECC rule combinations above to decide which standards apply to each layer.

### API Contract

See [Contract Rules](#contract-rules) below for the full spec.

## Agent Skills + ECC Rules

Dispatch packets MUST include `ecc` and SHOULD include `skills` fields (use `skills: none` when no skill applies). `Harness/context-loading.md#ecc-rules-per-role` owns the role-to-ECC mapping. This guide owns stack detection and the catalog of available ECC rule sets.

## API Contract Specification (Frontend ↔ Backend)

The single most important integration pattern. Without this, frontend and backend drift apart silently.

### Contract Rules

1. **Backend owns the schema.** Define types in the backend language, generate frontend types.
2. **Never duplicate types manually.** One source of truth, code-generated copies.
3. **Validate at both boundaries.** Backend validates input (Pydantic/Zod), frontend validates API responses.
4. **Error envelope is universal.** Use `common/patterns.md` format everywhere.

### OpenAPI 3.0 Example (Generator-Readable)

```yaml
# api/openapi.yaml — Feed this to openapi-typescript or openapi-generator
openapi: "3.0.3"
info:
  title: User API
  version: "1.0.0"
paths:
  /api/users:
    get:
      operationId: listUsers
      parameters:
        - name: page
          in: query
          schema: { type: integer, default: 1 }
        - name: limit
          in: query
          schema: { type: integer, default: 20 }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  success: { type: boolean }
                  data:
                    type: object
                    properties:
                      users: { type: array, items: { $ref: "#/components/schemas/User" } }
                  meta:
                    type: object
                    properties:
                      total: { type: integer }
                      page: { type: integer }
    post:
      operationId: createUser
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CreateUserInput" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                type: object
                properties:
                  success: { type: boolean }
                  data:
                    type: object
                    properties:
                      user: { $ref: "#/components/schemas/User" }
components:
  schemas:
    User:
      type: object
      required: [id, email, name, role, createdAt]
      properties:
        id: { type: string, format: uuid }
        email: { type: string, format: email }
        name: { type: string }
        role: { type: string, enum: [admin, member] }
        createdAt: { type: string, format: date-time }
    CreateUserInput:
      type: object
      required: [email, name]
      properties:
        email: { type: string, format: email }
        name: { type: string, minLength: 1, maxLength: 100 }
        role: { type: string, enum: [admin, member], default: member }
```

```bash
# Generate TypeScript types from OpenAPI:
npx openapi-typescript api/openapi.yaml -o src/shared/api-types.ts
```

### Implementation Per Stack

| Stack | Backend Schema | Frontend Types | Validation |
|-------|---------------|----------------|------------|
| Python BE + TS FE | Pydantic models | `openapi-typescript` from OpenAPI | Pydantic (BE) + Zod (FE) |
| Go BE + TS FE | Go structs + OpenAPI | `openapi-generator` | Go validator (BE) + Zod (FE) |
| Next.js fullstack | Zod schemas in `shared/` | Same Zod schemas | Zod (both sides) |
| tRPC | tRPC router definitions | Auto-inferred from router | tRPC built-in |
| GraphQL | GraphQL schema | `graphql-codegen` | GraphQL middleware + Zod (FE) |

### Agent Dispatch with ECC + Skills

When dispatching a subagent, the dispatch packet MUST include:

```json
{
  "agentRole": "worker",
  "task": "Implement user profile page",
  "writeSet": ["src/components/UserProfile.tsx", "src/hooks/useUser.ts"],
  "forbidden": ["src/backend/", "database/"],
  "verification": ["npm test", "npm run lint"],
  "ecc": ["web/design-quality.md", "web/patterns.md", "typescript/patterns.md"],
  "skills": ["react-review"],
  "apiContract": "api/contract.yaml"
}
```

Different subagents get different `ecc` and `skills` arrays.
A frontend implementer loads `web/` rules. A backend implementer loads `python/` or `golang/` rules.
A reviewer loads `security/` + `testing/` rules. See `Harness/context-loading.md` for the full per-role mapping.
