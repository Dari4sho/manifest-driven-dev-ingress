# Demo (Child Context)

This folder is only a sample implementation that uses the parent `ingressctl` core.

Contents:

- `manifests/demo-local.json`: sample manifest
- `stack/`: dummy frontend + api + postgres compose stack
- `bin/dev-*`: convenience wrappers for this demo

## Run

From `approaches/manifest-driven-global-ingress`:

```bash
cp infra/traefik/.env.example infra/traefik/.env
cp demo/stack/api/.env.example demo/stack/api/.env
cp demo/stack/frontend/.env.example demo/stack/frontend/.env

./bin/ingressctl ingress up
./demo/bin/dev-up
./demo/bin/dev-demo-parallel up
./demo/bin/dev-demo-parallel check
```

## Stop

```bash
./demo/bin/dev-demo-parallel down
./demo/bin/dev-down
./bin/ingressctl ingress down
```
