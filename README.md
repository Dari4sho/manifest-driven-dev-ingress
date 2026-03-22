# Manifest-Driven Global Ingress

This approach has two clearly separated layers:

- Core ingress tooling at this level (`bin/ingressctl`, `infra/traefik`, `.ingressctl`).
- Optional demo under `demo/` (dummy stack + sample manifest + helper scripts).
- `bin/ingressctl` is a thin CLI wrapper; implementation lives in `bin/ingressctl-lib.mjs`.

## Core only

Commands:

- `./bin/ingressctl ingress up|down|status`
- `./bin/ingressctl stack up|down|logs [service]|migrate|seed|slug --manifest <path> [--slug <slug>]`
- `./bin/ingressctl stack ls`

Core manifest model (JSON):

```json
{
  "schema_version": 2,
  "name": "billing",
  "stack": {
    "slug": "auto",
    "compose": {
      "workdir": "/abs/or/relative/path/to/project",
      "files": ["compose.yml", "compose.dev.yml"],
      "project_name_template": "{slug}"
    },
    "services": {
      "web": { "compose_service": "frontend", "port": 5173 },
      "api": { "compose_service": "api", "port": 8080 },
      "admin": { "url": "http://some-other-host:9000" }
    },
    "env": {
      "APP_BASE_URL": "http://{route.web.host}{http_port_suffix}",
      "API_BASE_URL": "http://{route.api.host}{http_port_suffix}"
    },
    "routes": [
      { "name": "web", "host": "app-{slug}.localhost", "service": "web" },
      { "name": "api", "host": "api-{slug}.localhost", "service": "api" },
      { "name": "admin", "host": "admin-{slug}.localhost", "service": "admin" }
    ],
    "actions": {
      "up": {
        "migrate": { "enabled": true }
      },
      "migrate": {
        "service": "api",
        "command": "npm run migration:run"
      },
      "seed": {
        "service": "api",
        "command": "npm run seed:run"
      }
    }
  }
}
```

Notes:

- `{slug}` and `{project}` placeholders are supported.
- `stack` owns routing and compose runtime config.
- `stack.services` defines reusable service targets.
- `stack.routes[*].service` can be a key from `stack.services`, or an inline service object.
- `stack.env` is optional and lets you inject manifest-derived values into compose env.
- `stack.env` supports `{slug}`, `{project}`, `{name}`, `{http_port}`, `{https_port}`, `{http_port_suffix}`, `{https_port_suffix}`, `{route.<name>.host}`, `{route.<name>.url}`.
- `compose_service + port` resolves to `http://<project>-<service>-1:<port>`.
- `service.url` supports direct HTTP targets outside compose.
- Optional `stack.actions` config drives `stack up|migrate|seed` behavior:
  - `stack.actions.migrate.service` and `.command` are used by `stack migrate`.
  - `stack.actions.seed.service` and `.command` are used by `stack seed`.
  - `stack.actions.up.migrate.enabled=true` enables auto-migrate during `stack up`.
  - `--migrate-service` / `--seed-service` (or `INGRESS_MIGRATE_SERVICE` / `INGRESS_SEED_SERVICE`) override target services at runtime.
- Set `DEBUG_INGRESSCTL=1` to print command execution traces for troubleshooting.

## Tests

Run from this directory:

```bash
npm test
# or
make test
```

## Demo

Demo files are intentionally isolated under [demo/](./demo).
See [demo/README.md](./demo/README.md) for commands and expected URLs.

## Integration Guide

For onboarding another project repo, use:

- [PROJECT_INTEGRATION_GUIDE.md](./PROJECT_INTEGRATION_GUIDE.md)
