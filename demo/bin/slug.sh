#!/usr/bin/env bash
set -euo pipefail

repo_name="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")"
branch_name="$(git branch --show-current 2>/dev/null || true)"
worktree_name="$(basename "$(pwd)")"

if [[ -n "${branch_name}" ]]; then
  if [[ "${branch_name}" == "${repo_name}" ]]; then
    raw="${repo_name}"
  else
    raw="${repo_name}-${branch_name}"
  fi
else
  if [[ "${worktree_name}" == "${repo_name}" ]]; then
    raw="${repo_name}"
  else
    raw="${repo_name}-${worktree_name}"
  fi
fi

slug="$(printf '%s' "${raw}" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g')"

if [[ -z "${slug}" ]]; then
  slug="dev"
fi

max_len=40
if (( ${#slug} > max_len )); then
  hash="$(printf '%s' "${raw}" | sha1sum | cut -c1-6)"
  keep=$((max_len - 7))
  slug="${slug:0:keep}-${hash}"
fi

printf '%s\n' "${slug}"
