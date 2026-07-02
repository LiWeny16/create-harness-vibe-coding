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
| `web/hooks.md` | PostToolUse format/lint/type-check, PreToolUse file size guard, Stop build verification | CI setup |
| `typescript/patterns.md` | API response envelope, custom hooks, Repository pattern | Backend-frontend contract |

### Backend Design (python/ + golang/ + rust/)

| Rule File | Design Guidance | When to Apply |
|-----------|----------------|---------------|
| `python/fastapi.md` | FastAPI patterns: async correctness, dependency injection, Pydantic schemas, OpenAPI quality | Python API projects |
| `python/patterns.md` | Repository pattern, service layer, API response format | Any Python backend |
| `golang/patterns.md` | Idiomatic Go patterns, concurrency, error handling | Go microservices |
| `rust/patterns.md` | Ownership patterns, error handling, unsafe usage | Rust services |
| `common/patterns.md` | Skeleton projects, Repository pattern, API response format, design pattern guidance | All projects |

### Full-Stack Architecture Templates

When filling `Harness/architecture.md`, use these templates based on project type:

#### React + FastAPI (TypeScript frontend, Python backend)
```
src/
├── frontend/          # React + TypeScript (ECC: typescript/ + web/)
│   ├── components/    # Compound components (web/patterns.md)
│   ├── hooks/         # Custom hooks (typescript/patterns.md)
│   ├── lib/           # API client, utilities
│   └── styles/        # CSS custom properties (web/coding-style.md)
├── backend/           # FastAPI (ECC: python/ + python/fastapi.md)
│   ├── api/           # Route handlers
│   ├── models/        # Pydantic schemas
│   ├── services/      # Business logic
│   └── db/            # Repository pattern (common/patterns.md)
└── shared/            # Shared types (optional: tRPC-style type sharing)
```

#### Next.js Full-Stack (TypeScript)
```
src/
├── app/               # App Router (server components)
├── components/        # Client components
├── lib/               # Server actions, API helpers
├── hooks/             # Client hooks
└── styles/            # CSS modules or Tailwind
```

#### Go Backend + React Frontend (separate repos)
```
backend/               # Go (ECC: golang/)
├── cmd/               # Entry points
├── internal/          # Business logic
│   ├── handler/       # HTTP handlers
│   ├── service/       # Business logic
│   └── repository/    # Data access (common/patterns.md)
└── api/               # OpenAPI spec

frontend/              # React + TypeScript (ECC: typescript/ + web/)
├── src/
│   ├── components/
│   ├── hooks/
│   └── lib/           # API client generated from OpenAPI
```

### API Contract Design

The most important frontend-backend integration pattern:

1. **Backend defines the contract**: OpenAPI (FastAPI), GraphQL schema, or gRPC proto
2. **Frontend generates the client**: `openapi-generator`, `graphql-codegen`, or manual type definitions
3. **Shared validation**: Both sides validate with the same schema (Zod on frontend, Pydantic on backend)
4. **Error envelope**: Use `common/patterns.md` API response format: `{ success, data?, error?, meta? }`

### When to Use What

| Project Size | Architecture | ECC Rules |
|-------------|-------------|-----------|
| Single dev, MVP | Monolith (Next.js or FastAPI + React) | `common/` + stack rules |
| 2-5 devs | Layered monolith (controller → service → repository) | Above + `web/` full |
| 5+ devs, microservices | Separate frontend/backend repos, API contract generated | All applicable |
| Real-time heavy | WebSocket + event-driven backend | Above + performance rules |

## Agent Skills ↔ ECC Rules Mapping

Harness dispatches different subagents for different tasks. Each subagent loads specific ECC rules
PLUS optional stack-specific skills. The dispatch packet (see `Harness/dispatch.md`) should include
both `ecc` and `skills` fields.

### Frontend Agent Skills

| Skill | When to Install | ECC Rules to Load |
|-------|----------------|-------------------|
| `react-review` | React/Next.js projects | `typescript/patterns.md`, `web/patterns.md`, `web/design-quality.md` |
| `vue-review` | Vue 3 projects | `vue/` rules, `web/design-quality.md` |
| `react-build` | Build errors in React | `typescript/hooks.md` |
| `react-test` | TDD for React | `typescript/testing.md`, `web/testing.md` |
| `flutter-review` | Flutter/Dart projects | `dart/` rules |
| `e2e-runner` | Browser automation / Playwright | `web/testing.md` |
| `a11y-architect` | Accessibility audit | `web/testing.md` (a11y section) |
| `seo-specialist` | SEO optimization | `web/performance.md` |
| `performance-optimizer` | Bundle size, Core Web Vitals | `web/performance.md` |
| `ui-ux-review` (optional) | Design quality review | `web/design-quality.md` |
| `gsap` / `animation` (external) | Complex animations | `web/performance.md` (animation section) |

### Backend Agent Skills

| Skill | When to Install | ECC Rules to Load |
|-------|----------------|-------------------|
| `fastapi-review` | Python FastAPI projects | `python/fastapi.md`, `python/patterns.md` |
| `python-review` | Any Python project | `python/patterns.md`, `python/testing.md` |
| `go-review` | Go microservices | `golang/patterns.md`, `golang/testing.md` |
| `rust-review` | Rust services | `rust/patterns.md` |
| `database-reviewer` | PostgreSQL/SQL work | `common/patterns.md` (Repository section) |
| `java-review` | Java/Spring Boot | `java/` rules |
| `kotlin-review` | Kotlin projects | `kotlin/` rules |
| `csharp-review` | C#/.NET projects | `csharp/` rules |
| `php-review` | PHP projects | `php/` rules |
| `django-reviewer` | Django projects | `python/patterns.md` |
| `cpp-review` | C++ projects | `cpp/` rules |

### Cross-Cutting Skills

| Skill | When to Install | ECC Rules to Load |
|-------|----------------|-------------------|
| `security-reviewer` | Any project (before commit) | `common/security.md`, stack security |
| `code-reviewer` | After writing code | `common/code-review.md`, stack patterns |
| `tdd-guide` | New features, bug fixes | `common/testing.md`, stack testing |
| `refactor-cleaner` | Dead code cleanup | `common/patterns.md` |
| `build-error-resolver` | Build failures | Stack-specific hooks |
| `silent-failure-hunter` | Error handling audit | `common/patterns.md` |
| `type-design-analyzer` | Type system design | `typescript/patterns.md` |
| `mle-reviewer` | ML pipelines | `python/patterns.md` |

## API Contract Specification (Frontend ↔ Backend)

The single most important integration pattern. Without this, frontend and backend drift apart silently.

### Contract Rules

1. **Backend owns the schema.** Define types in the backend language, generate frontend types.
2. **Never duplicate types manually.** One source of truth, code-generated copies.
3. **Validate at both boundaries.** Backend validates input (Pydantic/Zod), frontend validates API responses.
4. **Error envelope is universal.** Use `common/patterns.md` format everywhere.

### Contract Template (Conceptual — for human agreement)

```yaml
# api/contract.yaml — Conceptual contract. Not generator-readable.
# Human-readable agreement before generating OpenAPI/GraphQL schema.
#
# After agreement: generate real schema from this.
#   OpenAPI:  fastapi.openapi() → openapi.json → openapi-typescript → types.ts
#   GraphQL:  write schema.graphql → graphql-codegen → types.ts
#   tRPC:     router definition IS the contract (auto-inferred types)

endpoints:
  GET /api/users:
    request: {}
    response: { success: true, data: { users: User[] }, meta: { total: number, page: number } }
  POST /api/users:
    request: { body: CreateUserInput }
    response: { success: true, data: { user: User } }

types:
  User:       { id: uuid, email: email, name: string, role: admin|member, createdAt: ISO8601 }
  CreateUserInput: { email: email, name: 1-100chars, role: admin|member = member }
```

### Real Generator-Readable Example (OpenAPI 3.0)

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
