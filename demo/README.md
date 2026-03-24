# Demo (Child Context)

This folder is only a sample implementation that uses the parent `ingressctl` core.

Contents:

- `project-local.json`: sample manifest
- `stack/`: dummy frontend + api + postgres compose stack
- `scripts/dev-demo-parallel`: helper for running two demo slugs in parallel
- `Makefile`: primary command entrypoint for demo actions

## Run

From repository root:

```bash
cp infra/traefik/.env.example infra/traefik/.env
cp infra/dns/.env.example infra/dns/.env
cp demo/stack/api/.env.example demo/stack/api/.env
cp demo/stack/frontend/.env.example demo/stack/frontend/.env

./bin/ingressctl dns up
./bin/ingressctl dns doctor
./bin/ingressctl ingress up

make -C demo up
./demo/scripts/dev-demo-parallel up
./demo/scripts/dev-demo-parallel check
```

Default demo hosts now use project-style subdomains:

- `app.<slug>.test`
- `api.<slug>.test`

## Stop

```bash
./demo/scripts/dev-demo-parallel down
make -C demo down
./bin/ingressctl ingress down
./bin/ingressctl dns down
```
