import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT_DIR,
  STATE_DIR,
  DNS_DIR,
  DNS_COREFILE,
  DNS_HOSTS_FILE,
  capture,
  fail,
  loadDefaultEnv,
  run,
} from './shared.mjs';

export const WIN_HOSTS_PATH_DEFAULT = '/mnt/c/Windows/System32/drivers/etc/hosts';
export const WIN_HOSTS_MARKER_START = '# IngressctlHostsSectionStart';
export const WIN_HOSTS_MARKER_END = '# IngressctlHostsSectionEnd';

function isValidHostname(host) {
  if (typeof host !== 'string') return false;
  const h = host.trim().toLowerCase();
  if (!h || h.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(h)) return false;
  return h.split('.').every((label) => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

export function collectRegisteredRouteHosts() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const out = new Set();
  const files = fs.readdirSync(STATE_DIR).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8'));
      for (const r of Array.isArray(s.routes) ? s.routes : []) {
        if (isValidHostname(r?.host)) out.add(String(r.host).toLowerCase());
      }
    } catch {}
  }
  return [...out].sort();
}

export function buildDnsHostsContent(hosts) {
  const valid = [...new Set((Array.isArray(hosts) ? hosts : []).map((h) => String(h).trim().toLowerCase()).filter(isValidHostname))].sort();
  if (valid.length === 0) return '';
  return `127.0.0.1 ${valid.join(' ')}\n::1 ${valid.join(' ')}\n`;
}

export function writeDnsHostsFile() {
  fs.mkdirSync(DNS_DIR, { recursive: true });
  fs.writeFileSync(DNS_HOSTS_FILE, buildDnsHostsContent(collectRegisteredRouteHosts()), 'utf8');
}

export function detectWsl() {
  if (process.env.WSL_DISTRO_NAME) return true;
  const rel = capture('uname', ['-r']);
  return /microsoft/i.test(rel);
}

export function buildWindowsHostsSection(hosts) {
  const valid = [...new Set((Array.isArray(hosts) ? hosts : []).map((h) => String(h).trim().toLowerCase()).filter(isValidHostname))].sort();
  const lines = [
    WIN_HOSTS_MARKER_START,
    '# Managed by ingressctl. Do not edit manually.',
  ];
  for (const h of valid) lines.push(`127.0.0.1 ${h}`);
  lines.push(WIN_HOSTS_MARKER_END);
  return lines.join('\n');
}

export function replaceManagedSection(content, section) {
  const start = content.indexOf(WIN_HOSTS_MARKER_START);
  const end = content.indexOf(WIN_HOSTS_MARKER_END);
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  if (start >= 0 && end > start) {
    const afterEndIdx = end + WIN_HOSTS_MARKER_END.length;
    const before = normalized.slice(0, start).replace(/\n*$/, '\n');
    const after = normalized.slice(afterEndIdx).replace(/^\n*/, '\n');
    return `${before}${section}${after}`;
  }
  return `${normalized}\n${section}\n`;
}

export function syncWindowsHostsFile(args = {}) {
  const explicitPath = args['windows-hosts-path'] ?? process.env.INGRESS_WINDOWS_HOSTS_PATH;
  const hostsPath = String(explicitPath || WIN_HOSTS_PATH_DEFAULT).trim();
  if (!hostsPath) fail('Windows hosts path is empty.');
  if (!fs.existsSync(hostsPath)) fail(`Windows hosts file not found: ${hostsPath}`);

  const section = buildWindowsHostsSection(collectRegisteredRouteHosts());
  const current = fs.readFileSync(hostsPath, 'utf8');
  const next = replaceManagedSection(current, section);
  try {
    if (next !== current) fs.writeFileSync(hostsPath, next, 'utf8');
  } catch (e) {
    fail(`Unable to write Windows hosts file (${hostsPath}): ${e?.code ?? e?.message ?? e}\nTip (WSL): use platform/wsl/windows-hosts-sync.sh to run elevated PowerShell update.`);
  }
  const count = collectRegisteredRouteHosts().length;
  console.log(`Windows hosts synced: ${hostsPath} (hosts=${count})`);
}

export function clearWindowsHostsSection(args = {}) {
  const explicitPath = args['windows-hosts-path'] ?? process.env.INGRESS_WINDOWS_HOSTS_PATH;
  const hostsPath = String(explicitPath || WIN_HOSTS_PATH_DEFAULT).trim();
  if (!hostsPath) fail('Windows hosts path is empty.');
  if (!fs.existsSync(hostsPath)) fail(`Windows hosts file not found: ${hostsPath}`);
  const current = fs.readFileSync(hostsPath, 'utf8');
  const start = current.indexOf(WIN_HOSTS_MARKER_START);
  const end = current.indexOf(WIN_HOSTS_MARKER_END);
  if (start < 0 || end <= start) {
    console.log('Windows hosts section already absent.');
    return;
  }
  const afterEndIdx = end + WIN_HOSTS_MARKER_END.length;
  const before = current.slice(0, start).replace(/\n*$/, '\n');
  const after = current.slice(afterEndIdx).replace(/^\n*/, '\n');
  try {
    fs.writeFileSync(hostsPath, `${before}${after}`, 'utf8');
  } catch (e) {
    fail(`Unable to update Windows hosts file (${hostsPath}): ${e?.code ?? e?.message ?? e}\nTip (WSL): use platform/wsl/windows-hosts-clear.sh to run elevated PowerShell update.`);
  }
  console.log(`Windows hosts section removed: ${hostsPath}`);
}

function ensureValidDnsDomain(raw) {
  const domain = String(raw || '').trim().toLowerCase().replace(/\.+/g, '.').replace(/^\.+|\.+$/g, '');
  if (!domain) fail('DNS domain cannot be empty. Set INGRESS_DNS_DOMAIN or pass --domain <domain>.');
  if (!/^[a-z0-9.-]+$/.test(domain)) fail(`Invalid DNS domain: ${raw}`);
  if (!domain.includes('.')) fail(`DNS domain must contain at least one dot: ${domain}`);
  if (domain.startsWith('-') || domain.endsWith('-')) fail(`Invalid DNS domain label boundary: ${domain}`);
  return domain;
}

function parseDnsPort(raw, fallback = 53) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) fail(`Invalid DNS port: ${raw}`);
  return n;
}

export function resolveDnsConfig(args = {}) {
  const domain = ensureValidDnsDomain(args.domain ?? process.env.INGRESS_DNS_DOMAIN ?? 'ingress.test');
  const bindIp = String(args['bind-ip'] ?? process.env.INGRESS_DNS_BIND_IP ?? '127.0.0.1').trim();
  if (!bindIp) fail('DNS bind IP cannot be empty.');
  const port = parseDnsPort(args.port ?? process.env.INGRESS_DNS_PORT, 53);
  const upstream = String(args.upstream ?? process.env.INGRESS_DNS_UPSTREAM ?? '1.1.1.1 8.8.8.8').trim();
  if (!upstream) fail('DNS upstream cannot be empty.');
  return { domain, bindIp, port, upstream };
}

export function buildDnsCorefile(domain, upstream = '1.1.1.1 8.8.8.8') {
  const d = ensureValidDnsDomain(domain);
  const u = String(upstream).trim();
  if (!u) fail('DNS upstream cannot be empty.');
  return `.:53 {
  errors
  log
  hosts /etc/coredns/hosts {
    ttl 60
    reload 2s
    fallthrough
  }
  forward . ${u}
  cache 30
}

${d}:53 {
  errors
  log
  template IN A {
    answer "{{ .Name }} 60 IN A 127.0.0.1"
  }
  template IN AAAA {
    answer "{{ .Name }} 60 IN AAAA ::1"
  }
}
`;
}

function writeDnsCorefile(domain, upstream) {
  fs.mkdirSync(DNS_DIR, { recursive: true });
  fs.writeFileSync(DNS_COREFILE, buildDnsCorefile(domain, upstream), 'utf8');
}

function cmdDnsDoctor(args) {
  const cfg = resolveDnsConfig(args);
  const probe = `probe.${cfg.domain}`;
  const getentOut = capture('getent', ['hosts', probe]);
  const digOut = capture('bash', ['-lc', `command -v dig >/dev/null 2>&1 && dig +short @${cfg.bindIp} -p ${cfg.port} ${probe} A || true`]);

  console.log(`DNS config: domain=${cfg.domain}, bind=${cfg.bindIp}:${cfg.port}`);
  if (getentOut) {
    console.log(`OS resolver check: ok (${getentOut.split(/\r?\n/)[0]})`);
  } else {
    console.log('OS resolver check: unresolved (configure your OS resolver for this domain)');
  }
  if (digOut) {
    console.log(`Direct DNS server check: ok (${digOut.split(/\r?\n/).filter(Boolean).join(', ')})`);
  } else {
    console.log('Direct DNS server check: unavailable or unresolved (install dig or ensure DNS container is up)');
  }
}

export function cmdDns(action, args = {}) {
  loadDefaultEnv();
  const cfg = resolveDnsConfig(args);
  const env = {
    INGRESS_DNS_DOMAIN: cfg.domain,
    INGRESS_DNS_BIND_IP: cfg.bindIp,
    INGRESS_DNS_PORT: String(cfg.port),
    INGRESS_DNS_UPSTREAM: cfg.upstream,
  };

  if (action === 'up') {
    writeDnsHostsFile();
    writeDnsCorefile(cfg.domain, cfg.upstream);
    run('docker', ['compose', '-p', 'local-ingress-dns', '-f', path.join(ROOT_DIR, 'infra/dns/compose.yml'), 'up', '-d'], { env });
    const hostsCount = collectRegisteredRouteHosts().length;
    console.log(`DNS up: *.${cfg.domain} -> 127.0.0.1 (listening on ${cfg.bindIp}:${cfg.port}, upstream=${cfg.upstream}, registered-hosts=${hostsCount})`);
    return;
  }

  if (action === 'down') {
    run('docker', ['compose', '-p', 'local-ingress-dns', '-f', path.join(ROOT_DIR, 'infra/dns/compose.yml'), 'down'], { env });
    console.log('DNS down');
    return;
  }

  if (action === 'status') {
    const status = capture('docker', ['ps', '--filter', 'name=local-ingress-dns-coredns-1', '--format', '{{.Status}}']);
    if (!status) console.log(`DNS status: down (domain=*.${cfg.domain})`);
    else console.log(`DNS status: up (${status}) domain=*.${cfg.domain} bind=${cfg.bindIp}:${cfg.port} upstream=${cfg.upstream}`);
    return;
  }

  if (action === 'doctor') {
    cmdDnsDoctor(args);
    return;
  }

  if (action === 'windows-sync') {
    if (!detectWsl()) fail('windows-sync is intended for WSL environments.');
    syncWindowsHostsFile(args);
    return;
  }

  if (action === 'windows-clear') {
    if (!detectWsl()) fail('windows-clear is intended for WSL environments.');
    clearWindowsHostsSection(args);
    return;
  }

  fail('Usage: ingressctl dns up|down|status|doctor|windows-sync|windows-clear [--domain <domain>] [--bind-ip <ip>] [--port <port>] [--upstream "<dns...>"] [--windows-hosts-path <path>]');
}
