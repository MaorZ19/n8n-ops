# AGENTS.md

## Project

n8n-ops is a self-hosted operations console for many n8n instances: failure monitoring and problem grouping, Telegram alerts and email reports, MCP and REST access for agents, encrypted backups to S3-compatible storage, and instance consolidation.

**Stage: preparation.** No application code exists yet.

- Product requirements: `docs/requirements.md`
- Foundation plan (desired state, order of work, acceptance criteria): `docs/project-foundation.md`

The foundation plan describes the desired state. Do not assume that any planned file, directory, script, image or command exists until it is in the repository and its status in the plan says so.

## Repository policies

- The repository is public. Everything tracked is in English. No Hebrew anywhere in tracked files.
- Never commit environment-specific details: instance names, hostnames, IP addresses, local paths, API keys, tokens or passwords. Those belong in the ignored `docs/private/` or in ignored environment files.
- The product UI is English only and LTR only. Do not add localization or RTL support.
- Keep the repository root minimal. Every root file must be listed and justified in the foundation plan.
- Record user-visible or operational changes under `Unreleased` in `CHANGELOG.md` once it exists. Do not bump versions in pull requests.
- Use the lockfile for every install once it exists (`pnpm install --frozen-lockfile`).

## Architecture (planned)

- `apps/server`: Hono on Node.js, Drizzle with PostgreSQL, Better Auth (one user, mandatory TOTP), MCP and REST, pollers, alerting, scheduler. Serves the built UI. Never mounts the Docker socket.
- `apps/web`: React, Vite, Tailwind CSS, shadcn/ui (Vega style).
- `apps/worker`: optional outbound-only agent on an n8n Docker host. The only component with the Docker socket. Never receives database credentials.
- `packages/shared`: API contracts and schemas.

## Workflow scripts (planned)

All are Bash, run inside WSL, resolve the repository root from their own location, and run Node and linters inside a toolchain container:

- `scripts/local.sh`: build, up, down, status, nuke for the development stack.
- `scripts/verify.sh`: the single entry point for format, lint, types, tests, builds and guards. CI runs the same commands.
- `scripts/try-pr.sh`: run a pull request in a disposable worktree.
- `scripts/release.sh`: versioned release of the container images. Never deploys.

Existing script: `scripts/discover.sh` is read-only and must stay read-only. It has not been run against a production host.

## Docker

- `docker-compose.yml` (tracked) is the production deployment and references published images on GHCR.
- `docker-compose-dev.yml` (root, ignored, never committed) is the development stack. Use it only through `scripts/local.sh`. CI and release must not depend on it. On a new machine, create it from the description in the foundation plan.
- Neither Compose file may contain `build:`. Images are built explicitly by the scripts.
- Runtime variables go in an `env_file`. `.env.example` is the tracked contract with safe placeholders; `.env` is ignored.
- Every application container runs as a non-root user and has a real health check. Verification must fail if an application process runs as UID 0. The `worker` gets socket access through the socket's group, not by running as root.
- Persistent data uses bind-mounted host directories (`${N8N_OPS_DATA_DIR}`, `${N8N_OPS_WORKER_DIR}`), not named volumes. Ordinary `down` keeps them; only a confirmed nuke removes the validated project data directory.
- Logs go to stdout and stderr.

## Safety

- Never run anything that changes a production n8n instance (environment flags, restarts, API key creation) without explicit approval from the owner.
- Development and integration tests use disposable n8n containers, never production instances.
