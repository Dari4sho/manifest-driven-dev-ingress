# WSL quickstart for this repository only (not project-specific wiring).
# Assumes Docker is running inside WSL and you use the default DNS domain: ingress.test.

# 1) Open global ingress repo
cd /home/d4s/workspace/_dev/manifest-driven-dev-ingress

# 2) Start DNS + ingress
# Keep domain/port explicit so CoreDNS and checks are unambiguous.
./bin/ingressctl dns up --domain ingress.test --port 53
./bin/ingressctl ingress up

# 3) (WSL) prepend local DNS while preserving existing resolver entries
# Do this after DNS is up so 127.0.0.1:53 can answer immediately.
sudo ./platform/wsl/resolv-prepend-localdns.sh

# 4) Start demo stacks (base + parallel variants)
make -C demo up
./demo/scripts/dev-demo-parallel up

# 5) Sync Windows hosts managed section (UAC prompt expected)
# This adds concrete hosts for active stacks (no wildcard support in hosts file).
# Run after stacks are up so all currently active hosts are discovered.
./platform/wsl/windows-hosts-sync.sh
# or: make dns-win-sync

# 6) Run demo readiness checks
./demo/scripts/dev-demo-parallel check

# 7) Resolve slug and print URLs
BASE="$(./bin/ingressctl stack slug --manifest ./demo/project-local.json)"
echo "Base slug: $BASE"
echo "http://app.${BASE}.test/"
echo "http://api.${BASE}.test/"
echo "http://app.${BASE}-a.test/"
echo "http://api.${BASE}-a.test/"
echo "http://app.${BASE}-b.test/"
echo "http://api.${BASE}-b.test/"

# 8) Manual checks from WSL
curl -i "http://app.${BASE}.test/"
curl -i "http://api.${BASE}.test/"
curl -i "http://api.${BASE}.test/healthz"

# 9) DNS checks (WSL direct to CoreDNS)
dig +short @127.0.0.1 -p 53 "app.${BASE}.test" A
dig +short @127.0.0.1 -p 53 "api.${BASE}.test" A
dig +short @127.0.0.1 -p 53 "app.${BASE}-a.test" A
dig +short @127.0.0.1 -p 53 "api.${BASE}-a.test" A
dig +short @127.0.0.1 -p 53 "app.${BASE}-b.test" A
dig +short @127.0.0.1 -p 53 "api.${BASE}-b.test" A

# 10) Cleanup (when done)
./demo/scripts/dev-demo-parallel down
make -C demo down
./platform/wsl/windows-hosts-clear.sh      # or: make dns-win-clear
./bin/ingressctl dns down --domain ingress.test --port 53
./bin/ingressctl ingress down
