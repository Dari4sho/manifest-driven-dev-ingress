# Dev Setup Isolation Experiment

This repo now contains two approaches side-by-side:

## 1) Current Self-Contained Setup

Path: `approaches/current-self-contained`

- Starts Traefik and stacks from the same workflow scripts.
- Good for single-directory demo convenience.

## 2) Global Shared Ingress Setup

Path: `approaches/global-shared-ingress`

- Global Traefik lifecycle is separate from stack lifecycle.
- Start ingress once (`bin/ingress-up`), then register any number of stacks/workspaces independently (`bin/dev-up`).
- Matches the architecture for real multi-project parallel development.

## Recommended Next Step

Use `approaches/global-shared-ingress` for your intended pattern.
