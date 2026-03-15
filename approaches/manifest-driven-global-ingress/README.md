# Manifest-Driven Global Ingress

This approach has two clearly separated layers:

- Core ingress tooling at this level (`bin/ingressctl`, `infra/traefik`, `.ingressctl`).
- Optional demo under `demo/` (dummy stack + sample manifest + helper scripts).

## Core only

Commands:

- `./bin/ingressctl ingress up|down|status`
- `./bin/ingressctl stack up --manifest <path> [--slug <slug>]`
- `./bin/ingressctl stack down --manifest <path> [--slug <slug>]`
- `./bin/ingressctl stack ls`

Core manifest model (JSON):

```json
{
  "name": "billing",
  "slug": "auto",
  "compose": {
    "workdir": "/abs/or/relative/path/to/project",
    "files": ["compose.yml", "compose.dev.yml"],
    "project_name_template": "{slug}"
  },
  "env": {
    "APP_BASE_URL": "http://{route.web.host}{http_port_suffix}",
    "API_BASE_URL": "http://{route.api.host}{http_port_suffix}"
  },
  "routes": [
    {
      "name": "web",
      "host": "app-{slug}.localhost",
      "service": { "compose_service": "frontend", "port": 5173 }
    },
    {
      "name": "api",
      "host": "api-{slug}.localhost",
      "service": { "compose_service": "api", "port": 8080 }
    },
    {
      "name": "admin",
      "host": "admin-{slug}.localhost",
      "service": { "url": "http://some-other-host:9000" }
    }
  ]
}
```

Notes:

- `{slug}` and `{project}` placeholders are supported.
- `env` is optional and lets you inject manifest-derived values into compose env.
- `env` supports `{slug}`, `{project}`, `{name}`, `{http_port}`, `{https_port}`, `{http_port_suffix}`, `{https_port_suffix}`, `{route.<name>.host}`, `{route.<name>.url}`.
- `compose_service + port` resolves to `http://<project>-<service>-1:<port>`.
- `service.url` supports direct HTTP targets outside compose.

## Demo

Demo files are intentionally isolated under [demo/](./demo).
See [demo/README.md](./demo/README.md) for commands and expected URLs.
