#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PS_SCRIPT_WIN="$(wslpath -w "${ROOT_DIR}/platform/wsl/windows-hosts-section.ps1")"
INGRESS_HOSTS_WIN="$(wslpath -w "${ROOT_DIR}/infra/dns/hosts")"

if ! command -v powershell.exe >/dev/null 2>&1; then
  echo "powershell.exe not found. This helper is intended for WSL." >&2
  exit 1
fi

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${PS_SCRIPT_WIN}" -Action sync -IngressHostsFile "${INGRESS_HOSTS_WIN}"
