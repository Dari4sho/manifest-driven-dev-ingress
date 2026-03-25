import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT_DIR,
  TLS_DIR,
  TLS_CERT_FILE,
  TLS_KEY_FILE,
  TLS_ROOT_CA_FILE,
  TLS_HOSTS_FILE,
  TLS_DYNAMIC_FILE,
  fail,
  loadDefaultEnv,
  parseBool,
  capture,
  run,
} from './shared.mjs';
import { collectRegisteredRouteHosts, detectWsl, resolveDnsConfig } from './dns.mjs';

function ensureTlsDirWritable() {
  fs.mkdirSync(TLS_DIR, { recursive: true });
  try {
    fs.accessSync(TLS_DIR, fs.constants.W_OK);
  } catch {
    fail(
      `TLS directory is not writable: ${TLS_DIR}\n`
      + 'This commonly happens after running ingressctl with sudo.\n'
      + `Fix: sudo chown -R "$(id -u):$(id -g)" "${TLS_DIR}"`,
    );
  }
}

function isValidHostname(host) {
  if (typeof host !== 'string') return false;
  const h = host.trim().toLowerCase();
  if (!h || h.length > 253) return false;
  if (!/^[a-z0-9.*-]+(\.[a-z0-9-]+)+$/.test(h) && h !== 'localhost') return false;
  if (h.startsWith('*.')) {
    const rest = h.slice(2);
    return rest.split('.').every((label) => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
  }
  return h.split('.').every((label) => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

function splitHostList(raw) {
  return String(raw ?? '')
    .split(/[,\s]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function ensureMkcertInstalled() {
  if (!capture('bash', ['-lc', 'command -v mkcert >/dev/null 2>&1 && echo ok'])) {
    fail(
      'mkcert is required for local TLS.\n'
      + 'Install mkcert, then rerun: ingressctl tls init\n'
      + '- Ubuntu/WSL: sudo apt-get update && sudo apt-get install -y mkcert libnss3-tools\n'
      + '- macOS (Homebrew): brew install mkcert nss\n'
      + '- Windows (winget): winget install FiloSottile.mkcert',
    );
  }
}

function readTrackedTlsHosts() {
  if (!fs.existsSync(TLS_HOSTS_FILE)) return [];
  return splitHostList(fs.readFileSync(TLS_HOSTS_FILE, 'utf8')).filter(isValidHostname);
}

function buildTlsHostList(args = {}) {
  const dns = resolveDnsConfig(args);
  const includeWildcard = parseBool(args['with-wildcard'] ?? process.env.INGRESS_TLS_WILDCARD, true);
  const explicitHosts = splitHostList(args.hosts ?? process.env.INGRESS_TLS_HOSTS);
  const stackHosts = collectRegisteredRouteHosts();
  const hosts = new Set(['localhost', 'traefik.localhost', ...stackHosts, ...explicitHosts]);
  hosts.add(dns.domain);
  if (includeWildcard) hosts.add(`*.${dns.domain}`);
  return [...hosts].map((h) => h.toLowerCase()).filter(isValidHostname).sort();
}

function writeTlsDynamicConfig() {
  fs.mkdirSync(path.dirname(TLS_DYNAMIC_FILE), { recursive: true });
  const yml = `# generated-at: ${new Date().toISOString()}
tls:
  stores:
    default:
      defaultCertificate:
        certFile: /etc/traefik/tls/local-cert.pem
        keyFile: /etc/traefik/tls/local-key.pem
  certificates:
    - certFile: /etc/traefik/tls/local-cert.pem
      keyFile: /etc/traefik/tls/local-key.pem
`;
  fs.writeFileSync(TLS_DYNAMIC_FILE, yml, 'utf8');
}

function resolveMkcertRootCaPath() {
  const caroot = capture('mkcert', ['-CAROOT']);
  if (!caroot) return '';
  const src = path.join(caroot, 'rootCA.pem');
  if (!fs.existsSync(src)) return '';
  return src;
}

function copyRootCa() {
  const src = resolveMkcertRootCaPath();
  if (!src) return '';
  fs.mkdirSync(TLS_DIR, { recursive: true });
  try {
    fs.copyFileSync(src, TLS_ROOT_CA_FILE);
    return TLS_ROOT_CA_FILE;
  } catch (e) {
    // This often happens after running ingressctl with sudo once (root-owned tls dir).
    console.warn(`Warning: could not copy root CA to ${TLS_ROOT_CA_FILE}: ${e?.code ?? e?.message ?? e}`);
    return '';
  }
}

function generateTlsCertificate(hosts, installCa) {
  ensureMkcertInstalled();
  ensureTlsDirWritable();
  // Ensure dynamic file exists even before first cert issue.
  writeTlsDynamicConfig();
  if (installCa) run('mkcert', ['-install']);
  const uniqueHosts = [...new Set(hosts)];
  if (uniqueHosts.length === 0) fail('No TLS hosts resolved. Start a stack or pass --hosts "<host1 host2>".');
  run('mkcert', ['-cert-file', TLS_CERT_FILE, '-key-file', TLS_KEY_FILE, ...uniqueHosts]);
  fs.writeFileSync(TLS_HOSTS_FILE, `${uniqueHosts.join('\n')}\n`, 'utf8');
  // Rewrite dynamic config after cert/key update so Traefik file provider
  // receives a fresh change event and reloads the default certificate.
  writeTlsDynamicConfig();
  copyRootCa();
}

function runWindowsTrustHelper(rootCaPath) {
  const script = path.join(ROOT_DIR, 'platform', 'wsl', 'windows-cert-trust.sh');
  if (!fs.existsSync(script)) fail(`Missing helper script: ${script}`);
  run('bash', [script, rootCaPath]);
}

function runTrustHook(hookCmd, rootCaPath) {
  const cmd = String(hookCmd || '').trim();
  if (!cmd) return;
  run('bash', ['-lc', cmd], {
    env: {
      INGRESS_TLS_ROOT_CA: rootCaPath || '',
      INGRESSCTL_ROOT_DIR: ROOT_DIR,
    },
  });
}

function resolveTrustAdapter(args = {}) {
  return String(args['trust-adapter'] ?? process.env.INGRESS_TLS_TRUST_ADAPTER ?? 'auto').trim().toLowerCase();
}

function runTrustAdapter(adapter, rootCaPath) {
  if (adapter === 'off' || adapter === 'none') return false;
  if (adapter === 'auto') {
    if (!detectWsl()) return false;
    if (!rootCaPath) fail('Unable to locate mkcert root CA for trust adapter execution.');
    runWindowsTrustHelper(rootCaPath);
    return true;
  }
  if (adapter === 'wsl-windows') {
    if (!detectWsl()) fail('trust-adapter=wsl-windows is only supported from WSL.');
    if (!rootCaPath) fail('Unable to locate mkcert root CA for trust adapter execution.');
    runWindowsTrustHelper(rootCaPath);
    return true;
  }
  fail(`Unsupported trust adapter: ${adapter}. Supported: auto, off, wsl-windows`);
}

function printTlsStatus() {
  const certExists = fs.existsSync(TLS_CERT_FILE);
  const keyExists = fs.existsSync(TLS_KEY_FILE);
  const caExists = fs.existsSync(TLS_ROOT_CA_FILE);
  const hosts = readTrackedTlsHosts();
  console.log(`TLS status: cert=${certExists ? 'present' : 'missing'}, key=${keyExists ? 'present' : 'missing'}, rootCA=${caExists ? 'present' : 'missing'}`);
  if (hosts.length) {
    console.log(`TLS hosts (${hosts.length}):`);
    for (const h of hosts) console.log(`- ${h}`);
  } else {
    console.log('TLS hosts: none tracked');
  }
}

export function cmdTls(action, args = {}) {
  loadDefaultEnv();

  if (action === 'init') {
    const hosts = buildTlsHostList(args);
    const installCa = parseBool(args.install ?? process.env.INGRESS_TLS_INSTALL_CA, true);
    generateTlsCertificate(hosts, installCa);
    console.log(`TLS initialized: cert=${TLS_CERT_FILE}`);
    console.log(`TLS hosts generated: ${hosts.length}`);
    return;
  }

  if (action === 'refresh') {
    const preserveHosts = parseBool(args['preserve-hosts'] ?? process.env.INGRESS_TLS_PRESERVE_HOSTS, false);
    const hosts = preserveHosts ? readTrackedTlsHosts() : buildTlsHostList(args);
    if (hosts.length === 0) fail('No TLS hosts available to refresh.');
    generateTlsCertificate(hosts, false);
    console.log(`TLS refreshed: cert=${TLS_CERT_FILE} (hosts=${hosts.length})`);
    return;
  }

  if (action === 'trust') {
    ensureMkcertInstalled();
    run('mkcert', ['-install']);
    const rootCa = resolveMkcertRootCaPath();
    copyRootCa();

    const trustHook = args['trust-hook'] ?? process.env.INGRESS_TLS_TRUST_HOOK;
    const trustAdapter = resolveTrustAdapter(args);
    let adapterRan = false;

    if (trustHook) {
      runTrustHook(trustHook, rootCa);
      adapterRan = true;
    } else {
      adapterRan = runTrustAdapter(trustAdapter, rootCa);
    }

    if (adapterRan) console.log('TLS trust updated for local machine and platform adapter.');
    else console.log('TLS trust updated for local machine.');
    return;
  }

  if (action === 'status') {
    printTlsStatus();
    return;
  }

  if (action === 'clean') {
    ensureTlsDirWritable();
    const uninstallCa = parseBool(args['uninstall-ca'] ?? process.env.INGRESS_TLS_UNINSTALL_CA, false);
    for (const f of [TLS_CERT_FILE, TLS_KEY_FILE, TLS_HOSTS_FILE, TLS_ROOT_CA_FILE, TLS_DYNAMIC_FILE]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    if (uninstallCa) {
      ensureMkcertInstalled();
      run('mkcert', ['-uninstall']);
    }
    console.log('TLS artifacts removed.');
    return;
  }

  fail('Usage: ingressctl tls init|refresh|trust|status|clean [--hosts "<host...>"] [--with-wildcard true|false] [--domain <domain>] [--install true|false] [--preserve-hosts true|false] [--trust-adapter <auto|off|wsl-windows>] [--trust-hook "<cmd>"] [--uninstall-ca true|false]');
}
