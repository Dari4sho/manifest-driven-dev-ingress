#!/usr/bin/env bash
set -euo pipefail

RESOLV_PATH="${1:-/etc/resolv.conf}"
LOCAL_NS="${INGRESS_DNS_LOCAL_NAMESERVER:-127.0.0.1}"
BACKUP_PATH="${RESOLV_PATH}.ingressctl.bak"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (for example: sudo ./platform/wsl/resolv-prepend-localdns.sh)" >&2
  exit 1
fi

if [[ ! -f "${RESOLV_PATH}" ]]; then
  echo "Resolver file not found: ${RESOLV_PATH}" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

cp "${RESOLV_PATH}" "${BACKUP_PATH}"

{
  printf "nameserver %s\n" "${LOCAL_NS}"
  # Keep existing resolver content but avoid duplicate local nameserver lines.
  grep -vE "^[[:space:]]*nameserver[[:space:]]+${LOCAL_NS//./\\.}([[:space:]]|\$)" "${RESOLV_PATH}" || true
} > "${tmp}"

cat "${tmp}" > "${RESOLV_PATH}"

echo "Updated ${RESOLV_PATH}: local DNS ${LOCAL_NS} is now first."
echo "Backup written to ${BACKUP_PATH}"
