# n8n-ops Project Foundation

Status: Preparation (2026-10-14)

This document separates what exists in the repository today from the approved foundation that a later implementation task must build. A planned item does not exist until its status and verification evidence say otherwise. Product behavior is specified in [requirements.md](requirements.md).

## Current truth

Inspected on 2026-10-14:

- Git repository initialized locally on branch `main`. The first commit contains only documentation, repository metadata and one operator script.
- Tracked content: `README.md`, `AGENTS.md`, `LICENSE`, `.gitignore`, `.gitattributes`, `docs/requirements.md`, `docs/project-foundation.md`, `scripts/discover.sh`.
- `docs/private/` exists locally and is ignored. It holds environment-specific notes.
- `scripts/discover.sh` is a read-only Docker host discovery script. Its syntax and secret masking were checked locally; it has **not** been run against a real host.
- There is no application code, package manifest, lockfile, Dockerfile, Compose file, CI workflow or workflow script.
- Development machine: Windows with WSL (Ubuntu). Docker Engine 29.8.2 is reachable from WSL. Node.js, pnpm and shellcheck are **not** installed in WSL, so all tooling must run in containers.
- GitHub: `ShlomiPorush/n8n-ops` is created only when Shlomi authorizes it (see the handoff report of the preparation task for the outcome). No labels, rulesets, templates or Actions settings are configured.

## Product intent and boundaries

- **Problem:** a team running many self-hosted n8n instances gets tens of failure emails per day and ignores them; backups are unreliable; moving workflows between instances is manual.
- **Product:** one self-hosted web application that monitors n8n instances through their public API, groups failures into problems, sends a small number of Telegram alerts and email reports, exposes failures to AI agents over MCP and REST, backs up workflows and credentials encrypted to S3-compatible storage, and helps consolidate instances.
- **Users:** one operator (single local account). Agents use read-only tokens.
- **Stage:** requirements approved; nothing implemented.
- **Deployment shape:** Docker Compose. `app` and its PostgreSQL run on any host that can reach the n8n instances. An optional `worker` runs on each n8n Docker host.
- **Non-goals for v1:** full-instance backup (`pg_dump`), automatic container discovery, write actions over REST or MCP, multiple users or roles, localization.

## Preparation decisions

| Decision | Status | Choice | Rationale or blocker |
|---|---|---|---|
| Publication posture | Approved | Public-ready; repository is public | Shlomi wants it public (free CI). Environment-specific details live only in ignored `docs/private/`. |
| Repository language | Approved | English for everything | Public-ready posture. The product is English-only, so no locale file is exempt. |
| Runtime shape | Approved | Docker Compose: `server` (UI, API, MCP, pollers), `postgres`, optional `worker` per n8n host | Requirements section 4. `server` needs no Docker socket; only `worker` has it. |
| Language and runtime | Approved | TypeScript on Node.js (current LTS, expected 24; confirm at implementation) | Same ecosystem as n8n; good MCP and HTTP libraries. |
| Package manager and layout | Approved | pnpm workspaces monorepo | Three deployables sharing types. |
| Server framework | Approved | Hono on Node.js | Small, modern, first-class TypeScript. |
| Database access | Approved | PostgreSQL (current major, expected 18; confirm) with Drizzle ORM and Drizzle migrations | JSONB search of stored executions; Better Auth supports Drizzle. |
| Authentication | Approved | Better Auth: one local user, password plus mandatory TOTP | No hand-written auth. |
| UI | Approved | React, Vite, Tailwind CSS, shadcn/ui (Vega style), lucide icons; built to static files served by `server` | Chosen from a prototype; English and LTR only; light and dark themes. |
| Agent interface | Approved | MCP over HTTP (official TypeScript SDK) plus REST, token auth, read-only | Requirements E1 to E3. |
| Backup encryption | Approved | age, public key on server, private key only with the operator | Requirements D2. |
| Format and lint | Proposed | Biome (format and lint), `tsc --noEmit` for types | One tool for TS, JSON and CSS. Config under `config/`. |
| Tests | Proposed | Vitest (unit and integration), Playwright (UI end to end) | Integration tests run against a real n8n container. |
| Workflow scripts | Approved | WSL Bash `.sh` files under `scripts/` | Baseline. |
| Root layout | Approved | Minimal root with every file justified (below) | Baseline. |
| Release artifact | Approved | Two container images on GHCR: `ghcr.io/shlomiporush/n8n-ops` and `ghcr.io/shlomiporush/n8n-ops-worker`; SemVer tags | Deployed with Compose. Release publishes images only; deploying is the operator's action. |
| Versioning | Approved | SemVer, single source of truth in root `package.json` `version`, `CHANGELOG.md` with `Unreleased` | One product version for both images. |
| License | Approved | MIT | Shlomi's choice. |
| UI localization baseline | Approved override | No Hebrew, no RTL, no localization layer | Shlomi decided the product is English only; the baseline's Hebrew and RTL default does not apply. |

## Publication and language policy

- The repository is public. Code, comments, documentation, commit messages, Issues, PR bodies and review discussion are in English.
- No Hebrew is allowed anywhere in tracked files. There are no locale-file exceptions because the product has no localization.
- Planned CI guard: fail if any tracked text file contains Hebrew characters. The ignored `docs/private/` is outside its scope by construction.
- No environment-specific names, hostnames, IP addresses, instance lists or secrets in tracked files. Those belong in `docs/private/` or in ignored environment files.

## Planned architecture

| Component | Responsibility | Expected path | Status | Dependencies or blockers |
|---|---|---|---|---|
| `server` | HTTP API, MCP endpoint, Better Auth, pollers, problem grouping, alert queue, Telegram webhook, email reports, scheduler, worker job queue; serves the built UI | `apps/server` | Planned | PostgreSQL |
| `web` | Single-page UI (variant D layout) | `apps/web` | Planned | `shared` API types |
| `worker` | Outbound-only agent on an n8n Docker host: `docker exec` exports, age encryption, S3 upload, local health and metrics collection | `apps/worker` | Planned | Docker socket; pairing with `server` |
| `shared` | API contracts and schemas (zod), shared types | `packages/shared` | Planned | None |
| Database schema and migrations | Drizzle schema, generated SQL migrations | `apps/server/src/db`, `apps/server/drizzle` | Planned | PostgreSQL |
| Container images | Multi-stage builds per deployable | `docker/server.Dockerfile`, `docker/worker.Dockerfile` (with `*.Dockerfile.dockerignore` beside them) | Planned | Workspace build |
| Tool configuration | Biome, TypeScript base config, Vitest and Playwright config where movable | `config/` | Planned | None |
| Discovery script | Read-only inventory of an n8n Docker host | `scripts/discover.sh` | Exists, not run on a real host | None |

Load-bearing boundaries:

- Only `server` opens the database. `worker` talks to `server` over HTTPS with its own identity and never receives database credentials.
- `server` never mounts the Docker socket. Anything that needs the host runs in `worker`.
- Credential secrets exist in plaintext only inside `worker` memory and are age-encrypted before they leave the host.

## Planned repository root

| Root file | Git tracking policy | Why this exact root location is required | Status |
|---|---|---|---|
| `README.md` | Tracked | GitHub and contributor convention | Exists |
| `AGENTS.md` | Tracked | Agent instruction discovery | Exists |
| `LICENSE` | Tracked | GitHub license detection | Exists |
| `.gitignore` | Tracked | Git reads it from the root | Exists |
| `.gitattributes` | Tracked | Git reads it from the root; enforces LF for scripts written on Windows | Exists |
| `CHANGELOG.md` | Tracked | Release workflow and contributor convention | Planned |
| `package.json` | Tracked | pnpm workspace root, product version source of truth | Planned |
| `pnpm-workspace.yaml` | Tracked | pnpm requires it at the workspace root | Planned |
| `pnpm-lock.yaml` | Tracked | pnpm writes the lockfile at the workspace root | Planned |
| `docker-compose.yml` | Tracked | Production deployment contract (Docker baseline) | Planned |
| `docker-compose-dev.yml` | Ignored | Machine-local development file used only by `scripts/local.sh` (Docker baseline) | Planned |
| `.env.example` | Tracked | Environment contract read by Compose `env_file` | Planned |
| `.env` | Ignored | Real environment values | Planned |

Everything else goes into `apps/`, `packages/`, `docker/`, `config/`, `scripts/`, `docs/` or `.github/`. Dockerfiles live in `docker/` and use per-Dockerfile ignore files, so no root `.dockerignore` is needed. TypeScript and Biome base configs live in `config/` and are referenced explicitly.

## Containers

| Service | Runtime user | Health check | Persistent state | Host directory (bind mount) | Named volume exception | Backup lifecycle |
|---|---|---|---|---|---|---|
| `server` | Non-root (`node`, UID 1000) | HTTP readiness endpoint that checks the database connection | App secrets key file | `${N8N_OPS_DATA_DIR}/server` | None | Key file is backed up manually by the operator (download in Settings); never in the repository |
| `postgres` | Official image entrypoint drops to `postgres` (UID 999) | `pg_isready` against the app database | Database files | `${N8N_OPS_DATA_DIR}/postgres` | None | Nightly encrypted dump to S3 (requirement D8) |
| `worker` | Non-root user added to the Docker socket's group (`group_add` with the host's socket GID) | Command that checks the last successful heartbeat to `server` | Worker identity file | `${N8N_OPS_WORKER_DIR}` | None | Re-pair on loss; no backup needed |

Socket access is root-equivalent on the host even for a non-root process. This is accepted for `worker` only and contained by: no inbound ports, outbound HTTPS only, a revocable identity, and no database credentials.

Compose interpolation is limited to image tags and the two host data directories. Everything else is in the `env_file`.

## Foundation implementation plan

| Order | Deliverable | Status | Acceptance criteria | Required verification |
|---|---|---|---|---|
| 1 | Repository baseline | Planned | `package.json`, `pnpm-workspace.yaml`, `config/` (Biome, tsconfig base), empty-but-building `apps/server`, `apps/web`, `apps/worker`, `packages/shared`, `CHANGELOG.md` with `Unreleased` | `pnpm install --frozen-lockfile` and `pnpm -r build` succeed inside the toolchain container |
| 2 | Toolchain container | Planned | A pinned Node.js plus pnpm image used by every script and by CI, so no host tooling is needed | `scripts/verify.sh` runs on a WSL machine without Node installed |
| 3 | Runtime and development environment | Planned | `docker/server.Dockerfile`, `docker/worker.Dockerfile`, `docker-compose.yml`, `.env.example`, documented `docker-compose-dev.yml`; `server` serves the built UI and a readiness endpoint; Drizzle migration runs on start | Containers report healthy; process UID is not 0; no `build:` in Compose files |
| 4 | Local workflow | Planned | `scripts/local.sh` build, up, up detached, down, status, confirmed nuke | Fresh clone to healthy stack; data survives down and up |
| 5 | Verify workflow | Planned | `scripts/verify.sh` full and changed-area modes: Biome, types, Vitest, builds, guards (Hebrew, Compose `build:`, shellcheck and shfmt in a container), integration tests against a disposable n8n 2.44 container | Passes locally and in CI with the same commands |
| 6 | Try PR workflow | Planned | `scripts/try-pr.sh <pr>`, `status`, `restore`; disposable worktree; rebuilds only affected images; keeps `postgres` running; backs up the dev database before applying a PR's migrations and restores it on `restore` | Running images match the PR's commit; user's checkout untouched |
| 7 | Release workflow | Planned | `scripts/release.sh` with preflight, dry run, version bump, changelog close, full verify, immutable `vX.Y.Z` tag, push of both images to GHCR | Dry run makes no changes; real run refuses a dirty or unsynchronized tree |
| 8 | Path-filtered CI | Planned | `.github/workflows/ci.yml`: change detection, per-area jobs, final summary job, PR cancellation only, manual full run, weekly full sweep, pinned actions, least privilege | A docs-only PR skips build jobs and still passes the summary check |
| 9 | Dependency management | Planned | `.github/dependabot.yml` weekly for npm, GitHub Actions and Docker; minor and patch grouped; majors separate; no auto-merge | Dependabot config validates on GitHub |
| 10 | GitHub configuration | Planned, needs authorization | Labels, issue templates, ruleset on `main` (PR required, summary check required), secret scanning with push protection, Actions default permission read-only | Settings inspected with `gh` after the change |

Product features (pollers, problems, alerts, backups, MCP tools, pages beyond a placeholder) are **not** part of the foundation task.

## Required workflow contracts

All four scripts: Bash run inside WSL, `#!/usr/bin/env bash`, `set -euo pipefail`, LF line endings, executable mode, repository root resolved from the script's own location, Linux paths internally. Node, pnpm and linters run inside the toolchain container, not on the host.

- **`scripts/local.sh`**: `build` builds `n8n-ops-server:dev` and `n8n-ops-worker:dev` explicitly and stops on the first failure; `up` and `up -d` use root `docker-compose-dev.yml` explicitly (fail with a clear message if it is missing, never fall back to `docker-compose.yml`) and pass `--remove-orphans`; `down` keeps `${N8N_OPS_DATA_DIR}`; `status` shows health, image IDs and runtime UIDs; `nuke` asks for confirmation and removes only the validated project data directory. After `up`, verify health and non-root identity. The development `worker` targets a local disposable n8n container, never production.
- **`scripts/verify.sh`**: one entry point for Biome check, `tsc`, Vitest, builds, the Hebrew guard, the Compose `build:` guard, shellcheck and shfmt, and integration tests against a disposable n8n container with its own PostgreSQL. `--changed` limits work to affected workspaces. Cleans up containers and temporary data.
- **`scripts/try-pr.sh`**: `try-pr.sh <number>`, `status`, `restore`. Uses `gh` to fetch the PR into a disposable worktree, builds only affected images, restarts only `server` and `worker`, keeps `postgres`. Takes a database dump before running the PR's migrations so `restore` can return the database to the pre-PR state. Never merges, pushes or edits the user's checkout.
- **`scripts/release.sh`**: `--dry-run` and a required explicit target (`ghcr`). Preflight checks clean and synchronized `main`, runs full verify, chooses the SemVer bump, updates `package.json` and derived copies, closes `Unreleased` in `CHANGELOG.md`, commits specific files only, creates an immutable annotated tag, builds and pushes both images with the version tag. Never force-pushes a tag, never overwrites a published version, never prints secrets. Does not deploy.

## Known unknowns and blockers

| Question or blocker | Why it matters | Evidence or decision needed | Owner |
|---|---|---|---|
| Discovery of the production n8n host | Versions, pruning, Redis, exposed endpoints affect pollers and alerts | Run `scripts/discover.sh` and share the report, or grant SSH (on hold) | Shlomi |
| Reaching queue worker `/healthz` and `/metrics` when `server` runs elsewhere | Usually not exposed outside the host | Proposed: `worker` collects and reports them; confirm after discovery | Shlomi |
| Retention for stored failed executions | Storage size | 30 days proposed | Shlomi |
| Scope table per feature | Feature gating by API key scopes | Build from n8n source during implementation | Implementation |
| Exact Node.js and PostgreSQL versions | Image pinning | Confirm current LTS and current PostgreSQL major at implementation time | Implementation |
| Where `server` is hosted and which reverse proxy fronts it | Deployment only; does not block the foundation | Decide before first production deploy | Shlomi |
| Biome and Playwright | Tooling defaults proposed here | Confirm or replace at the start of the foundation task | Shlomi |

## Ready-for-implementation criteria

- This document and `requirements.md` are approved by Shlomi.
- The GitHub repository exists and Shlomi has authorized pushing the foundation work on a topic branch with a pull request.
- Authorization for item 10 (GitHub settings) is given separately, or item 10 is deferred.

## Handoff to foundation implementation

- **First task:** deliverables 1 to 9 on a topic branch, in order, with a pull request.
- **Permitted scope:** workspace skeleton, toolchain container, Dockerfiles, Compose files, the four workflow scripts, CI and Dependabot, a placeholder `server` readiness endpoint and a placeholder UI page. Nothing from the product features in `requirements.md`.
- **Stopping point:** the pull request is open, every CI check is green, `scripts/local.sh up` produces a healthy non-root stack on a clean WSL machine, and `scripts/verify.sh` passes. Then stop and report; merging is Shlomi's decision.
- **Must run:** `scripts/verify.sh` (full), `scripts/local.sh build` and `up`, and a check that CI skips unaffected areas on a docs-only change.
