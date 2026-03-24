# DNS Setup (Wildcard Domain)

This repository can run a local wildcard DNS server via CoreDNS:

```bash
./bin/ingressctl dns up
./bin/ingressctl dns status
./bin/ingressctl dns doctor
```

Default domain is `*.ingress.test` (configurable via `INGRESS_DNS_DOMAIN`).
Non-ingress DNS is forwarded upstream (configurable via `INGRESS_DNS_UPSTREAM`).
Additionally, route hosts from active stacks are resolved dynamically from ingressctl state files.

## Why this exists

`*.localhost` does not resolve consistently across all resolvers/tools (especially Node.js/CLI on some systems).

Using a dedicated wildcard domain (`*.ingress.test`) plus local DNS gives consistent resolution for:

- browsers
- Node.js processes
- CLI/API tools

You can use project-scoped host patterns such as:

- `app.howtio.test`
- `api.howtio.test`
- `app.someproject.test`
- `api-someproject.test`

As long as those hosts are produced by active stack manifests, local DNS will resolve them to loopback.

## OS Resolver Requirement

Running CoreDNS is only half of the setup.
Your OS resolver must route the chosen domain to `127.0.0.1`.

## macOS (recommended)

Create `/etc/resolver/ingress.test`:

```bash
sudo mkdir -p /etc/resolver
cat <<'EOF' | sudo tee /etc/resolver/ingress.test >/dev/null
nameserver 127.0.0.1
EOF
```

Validate:

```bash
dscacheutil -q host -a name app-demo.ingress.test
```

## Linux (systemd-resolved)

Use route-only domain forwarding for your chosen domain.
Configuration varies by distro/network manager; typical `systemd-resolved` setups use `resolvectl`.

Example pattern:

```bash
# Inspect interface names first
resolvectl status

# Then route only the ingress domain to local DNS for a selected interface
sudo resolvectl dns <iface> 127.0.0.1
sudo resolvectl domain <iface> '~ingress.test'
```

Validate:

```bash
getent hosts app-demo.ingress.test
```

If your distro manages DNS through NetworkManager or another resolver layer, apply equivalent domain-routing there.

## WSL (recommended approach)

Do not disable WSL resolver auto-generation by default.
Keep dynamic DNS from Windows/Tailscale/VPN, and only prepend local CoreDNS to `/etc/resolv.conf`.

1. Ensure DNS container is started on port `53` (default):

```bash
./bin/ingressctl dns up
./bin/ingressctl dns status
```

2. Prepend `127.0.0.1` to `/etc/resolv.conf` while preserving existing nameserver/search entries:

```bash
sudo ./platform/wsl/resolv-prepend-localdns.sh
```

This script is idempotent and keeps a backup at `/etc/resolv.conf.ingressctl.bak`.

3. Validate:

```bash
getent hosts app-demo.ingress.test
dig +short app-demo.ingress.test
```

Expected: `127.0.0.1` (and/or `::1`).

Rollback:

```bash
sudo cp /etc/resolv.conf.ingressctl.bak /etc/resolv.conf
```

If WSL rewrites resolv.conf on restart, rerun the helper command.

### Optional: also sync Windows hosts dynamically

If you want Windows browsers/apps to resolve the same active stack hosts immediately, sync a managed section into the Windows hosts file from WSL:

```bash
./platform/wsl/windows-hosts-sync.sh
```

Clear it later:

```bash
./platform/wsl/windows-hosts-clear.sh
```

This does not support wildcard records (Windows hosts limitation), but ingressctl keeps concrete route hosts up to date from active stack state.

## Notes

- `/etc/hosts` cannot express wildcard entries, so it is not a scalable replacement for this.
- You can still use `*.localhost` routes when DNS is not configured, but non-browser tools may need host-header workarounds.
- Keep this DNS layer optional and explicit. Do not auto-modify system DNS settings from `ingressctl`.
