# Project Integration Guide

This guide describes how to wire a new project into the global manifest-driven ingress setup.

Use this as the single source of truth for agent tasks when onboarding another repository.

## Target Model

- One shared global ingress runtime (`ingressctl ingress up`) on ports `80/443`.
- Optional shared DNS runtime (`ingressctl dns up`) for wildcard host resolution across browser + Node + CLI.
- Each project defines a local manifest (`project-local.json`) with:
  - `stack.compose`
  - `stack.services`
  - `stack.routes`
  - optional `stack.env`
  - optional `stack.actions` (`up.migrate.enabled`, `migrate`, `seed`)
- Project scripts call global `ingressctl` with local manifest.
- Default local URLs can use slug hosts:
  - `http://<service>-<slug>.localhost` (browser-first, no DNS setup)
  - `http://<service>-<slug>.ingress.test` (recommended when using wildcard DNS)
  - or project-scoped hosts like `http://app.<project>.test` / `http://api.<project>.test`

## Global Prerequisites

1. Clone this repo (global ingress runtime) to a stable path.
2. Ensure Docker is running.
3. Start ingress once:
   - `./bin/ingressctl ingress up` or `make ingress-up`
4. Optional but recommended for non-browser tooling:
   - `./bin/ingressctl dns up`
   - configure OS resolver for `*.ingress.test` -> `127.0.0.1`
5. Confirm:
   - `./bin/ingressctl ingress status` or `make ingress-status`
   - open `http://traefik.localhost`

## Files to Add in Target Project

Create a local ingress folder, for example:

- `.dev/ingress-local/project-local.json`
- `.dev/ingress-local/compose.yml`
- optional tmux helper scripts if that project uses tmuxp

Do not vendor global ingress core into project repos.

## Manifest Template (`project-local.json`)

```json
{
  "name": "project-local",
  "stack": {
    "slug": "auto",
    "domain": "ingress.test",
    "compose": {
      "workdir": ".",
      "files": ["compose.yml"],
      "project_name_template": "{slug}"
    },
    "services": {
      "app": { "compose_service": "client", "port": 8082 },
      "api": { "compose_service": "api", "port": 3333 }
    },
    "env": {
      "APP_BASE_URL": "http://{route.app.host}{http_port_suffix}",
      "API_BASE_URL": "http://{route.api.host}{http_port_suffix}"
    },
    "routes": [
      { "name": "app", "host": "app-{slug}.{domain}", "service": "app" },
      { "name": "api", "host": "api-{slug}.{domain}", "service": "api" }
    ],
    "actions": {
      "up": {
        "migrate": { "enabled": true }
      },
      "migrate": {
        "service": "api",
        "command": "..."
      },
      "seed": {
        "service": "api",
        "command": "..."
      }
    }
  }
}
```

Notes:

- `stack.compose.workdir` is resolved relative to manifest location.
- `stack.routes[*].service` should reference `stack.services` keys.
- `stack.actions` is optional; only set what the project needs.

## Compose Requirements

In the local ingress compose file:

1. Remove host port bindings for app services (use internal ports only).
2. Keep stable service names matching `stack.services.*.compose_service`.
3. Join shared network:
   - `dev-ingress` must be external.
4. Keep data isolation via `COMPOSE_PROJECT_NAME`:
   - no fixed `container_name`
   - project-scoped named volumes (DB, node_modules, etc.).

## Project Scripts (Recommended Pattern)

In target `package.json`, define:

```json
{
  "config": {
    "ingress_manifest": ".dev/ingress-local/project-local.json",
    "ingressctl_bin": "/home/<user>/workspace/_dev/manifest-driven-dev-ingress/bin/ingressctl"
  },
  "scripts": {
    "ingress:ctl": "node $npm_package_config_ingressctl_bin",
    "ingress:up": "npm run ingress:ctl -- ingress up",
    "ingress:down": "npm run ingress:ctl -- ingress down",
    "ingress:status": "npm run ingress:ctl -- ingress status",
    "ingress:stack:up": "npm run ingress:ctl -- stack up --manifest \"$npm_package_config_ingress_manifest\"",
    "ingress:stack:down": "npm run ingress:ctl -- stack down --manifest \"$npm_package_config_ingress_manifest\"",
    "ingress:stack:ls": "npm run ingress:ctl -- stack ls",
    "ingress:stack:migrate": "npm run ingress:ctl -- stack migrate --manifest \"$npm_package_config_ingress_manifest\"",
    "ingress:stack:seed": "npm run ingress:ctl -- stack seed --manifest \"$npm_package_config_ingress_manifest\"",
    "ingress:stack:slug": "npm run ingress:ctl -- stack slug --manifest \"$npm_package_config_ingress_manifest\"",
    "ingress:logs": "npm run ingress:ctl -- stack logs --manifest \"$npm_package_config_ingress_manifest\""
  }
}
```

## Tmux / Logs Pattern (Optional)

If the project uses tmuxp and starts logs in dedicated panes, race with container startup is common.

Recommended no-file helper scripts in `package.json`:

```json
{
  "scripts": {
    "ingress:logs:wait:api": "sh -c 'SLUG=$(npm run -s ingress:stack:slug); while ! docker ps --format \"{{.Names}}\" | grep -qx -- \"${SLUG}-api-1\"; do sleep 1; done; npm run ingress:logs -- api'"
  }
}
```

Then tmux panes call `npm run ingress:logs:wait:<service>`.

## Validation Checklist

Run in target repo:

1. `npm run ingress:up`
2. `npm run ingress:stack:up`
3. `npm run ingress:stack:ls`
4. Check all declared hosts resolve and serve content.
5. `npm run ingress:logs -- <service>`
6. `npm run ingress:stack:down`

Parallel slug check:

1. `npm run ingress:stack:up -- --slug <a>`
2. `npm run ingress:stack:up -- --slug <b>`
3. verify both host sets work.
4. `npm run ingress:stack:down -- --slug <a>`
5. `npm run ingress:stack:down -- --slug <b>`

## Common Pitfalls

1. Wrong manifest `workdir` after moving manifest file.
2. Route service key mismatch (`stack.routes[].service` not found in `stack.services`).
3. Auto-migrate race if service not yet running.
4. tmux shell differences (`bash -lc` behavior can differ); prefer `sh -c` for simple wait loops.
5. Fixed absolute ingress binary path not valid on another machine.
6. `*.localhost` may not resolve in Node.js/CLI on some systems; use wildcard DNS (`*.ingress.test`) for full-machine parity.

## Minimal Agent Prompt

When onboarding a new repo, you can use this prompt:

```text
Use PROJECT_INTEGRATION_GUIDE.md from manifest-driven-dev-ingress as the contract.
Implement local ingress integration for this repo using stack-scoped manifest + compose + scripts.
Do not vendor global ingress core into the repo.
Keep changes minimal and documented.
Run validation checklist at the end.
```
