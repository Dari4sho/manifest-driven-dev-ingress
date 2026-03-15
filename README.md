# Dev Setup Isolation Experiment

This repo now contains three approaches side-by-side:

## 1) Current Self-Contained Setup

Path: `approaches/current-self-contained`

- Starts Traefik and stacks from the same workflow scripts.
- Good for single-directory demo convenience.

## 2) Global Shared Ingress Setup

Path: `approaches/global-shared-ingress`

- Global Traefik lifecycle is separate from stack lifecycle.
- Start ingress once (`bin/ingress-up`), then register any number of stacks/workspaces independently (`bin/dev-up`).
- Matches the architecture for real multi-project parallel development.

## 3) Manifest-Driven Global Ingress Setup

Path: `approaches/manifest-driven-global-ingress`

- Keeps one global ingress instance.
- Registers stacks through manifest files (JSON), not fixed repo structure assumptions.
- Supports multiple HTTP routes/services per stack and manifests located anywhere.

## Recommended Next Step

Use `approaches/manifest-driven-global-ingress` for your intended pattern.
