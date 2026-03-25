#!/usr/bin/env bash
set -euo pipefail

ROOT_CA_PATH="${1:-}"
if [[ -z "$ROOT_CA_PATH" ]]; then
  echo "Usage: $0 <root-ca-pem-path>" >&2
  exit 1
fi

if [[ ! -f "$ROOT_CA_PATH" ]]; then
  echo "Root CA file not found: $ROOT_CA_PATH" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PS1="$SCRIPT_DIR/windows-cert-trust.ps1"

if [[ ! -f "$PS1" ]]; then
  echo "Missing script: $PS1" >&2
  exit 1
fi

PS1_WIN="$(wslpath -w "$PS1")"
ROOT_CA_WIN="$(wslpath -w "$ROOT_CA_PATH")"

if command -v powershell.exe >/dev/null 2>&1; then
  POWERSHELL_BIN="powershell.exe"
elif [[ -x "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" ]]; then
  POWERSHELL_BIN="/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
elif command -v pwsh.exe >/dev/null 2>&1; then
  POWERSHELL_BIN="pwsh.exe"
else
  echo "No Windows PowerShell executable found from WSL (tried: powershell.exe, /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe, pwsh.exe)." >&2
  echo "Run manually from Windows if needed: Import-Certificate -FilePath '<rootCA.pem>' -CertStoreLocation Cert:\\CurrentUser\\Root" >&2
  exit 1
fi

"$POWERSHELL_BIN" -NoProfile -ExecutionPolicy Bypass -File "$PS1_WIN" -RootCAPath "$ROOT_CA_WIN"
