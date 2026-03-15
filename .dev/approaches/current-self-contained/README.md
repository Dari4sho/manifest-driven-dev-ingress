# Local Parallel Dev Template

This repository demonstrates hostname-based local parallel development with a shared ingress and isolated workspace stacks.

## Architecture

```
Browser
  -> http://app-<slug>.localhost
  -> http://api-<slug>.localhost
           |
           v
     Shared Traefik (ports 80/443)
           |
           +--> frontend container (React + Vite, internal :FRONTEND_PORT)
           +--> api container (TypeScript, internal :API_PORT)

Project-local network
  api <-> postgres (internal :5432, not published)
```

## Files

- `infra/traefik/compose.yml`: shared reverse proxy stack.
- `infra/traefik/.env(.example)`: ingress-level settings (host ports).
- `infra/traefik/dynamic/dashboard.yml`: static shared dashboard route.
- `infra/traefik/dynamic/<slug>.yml`: generated app/api routes per workspace.
- `stack/compose.yml`: per-workspace app stack.
- `stack/api/*`: TypeScript API service + `stack/api/.env(.example)`.
- `stack/frontend/*`: standard React + Vite TypeScript frontend + `stack/frontend/.env(.example)`.
- `bin/*`: shell automation scripts.

## Prerequisites

- Docker Engine + Docker Compose v2
- Linux or WSL2 recommended

## Workspace Commands

1. Create env files from examples:

```bash
cp infra/traefik/.env.example infra/traefik/.env
cp stack/api/.env.example stack/api/.env
cp stack/frontend/.env.example stack/frontend/.env
```

2. Start the stack:

```bash
./bin/dev-up
./bin/dev-down
```

## Parallel Demo (same directory)

```bash
./bin/dev-demo-parallel up
./bin/dev-demo-parallel check
./bin/dev-demo-parallel down
```

Equivalent `make` targets:

```bash
make demo-up
make demo-check
make demo-down
```

Optional overrides:

- `FRONTEND_PORT=<port>`
- `API_PORT=<port>`

## Notes

- `postgres` is intentionally private (no host port published).
- Frontend API origin is explicit via `API_BASE_URL` (default derived by `bin/dev-up` as `http://api-<slug>.localhost`).
- Internal frontend and API ports are explicit config in `stack/frontend/.env` and `stack/api/.env`.
- `bin/dev-up` generates only per-workspace app/api route files; dashboard routing is static in `infra/traefik/dynamic/dashboard.yml`.
- This setup is file-provider-only (no Docker label discovery).
- If `80/443` are occupied, set `TRAEFIK_HTTP_PORT` and `TRAEFIK_HTTPS_PORT` in `infra/traefik/.env`.
