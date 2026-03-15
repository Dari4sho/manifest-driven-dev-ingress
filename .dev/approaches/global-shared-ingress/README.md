# Global Shared Ingress + Per-Stack Registration

This variant separates global ingress lifecycle from stack lifecycle.

- Global ingress (Traefik) is started once and shared.
- Each stack/workspace registers its own app/api routes via a generated file.
- Stacks can start/stop independently without recreating ingress.

## Layout

- `bin/ingress-up`, `bin/ingress-down`: manage global ingress only.
- `bin/dev-up`, `bin/dev-down`: manage one stack + its route file only.
- `infra/traefik/dynamic/dashboard.yml`: static global dashboard route.
- `infra/traefik/dynamic/<slug>.yml`: generated per-stack routes.

## Usage

1. Prepare env files:

```bash
cp infra/traefik/.env.example infra/traefik/.env
cp stack/api/.env.example stack/api/.env
cp stack/frontend/.env.example stack/frontend/.env
```

2. Start global ingress once:

```bash
./bin/ingress-up
```

3. Start one or more stacks:

```bash
./bin/dev-up
./bin/dev-demo-parallel up
```

4. Validate routes:

```bash
./bin/dev-demo-parallel check
```

5. Stop stacks and ingress:

```bash
./bin/dev-demo-parallel down
./bin/dev-down
./bin/ingress-down
```

## Notes

- Traefik listens on one shared host port (`TRAEFIK_HTTP_PORT`, default `80`).
- Stack isolation is by slug/hostname, not host-port-per-stack.
- This setup uses Traefik file provider only.
