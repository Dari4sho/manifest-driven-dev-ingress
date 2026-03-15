# Agent Rules

## Ingressctl Change Rule

- If you modify `bin/ingressctl` or `bin/ingressctl-lib.mjs`, you must also update or add tests in `tests/ingressctl.test.mjs` (or additional files under `tests/`) to cover the behavior change.
- Do not merge ingressctl logic changes without test coverage updates.
