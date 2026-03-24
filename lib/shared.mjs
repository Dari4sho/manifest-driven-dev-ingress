import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DYNAMIC_DIR = path.join(ROOT_DIR, 'infra', 'traefik', 'dynamic');
export const STATE_DIR = path.join(ROOT_DIR, '.ingressctl', 'stacks');
export const DNS_DIR = path.join(ROOT_DIR, 'infra', 'dns');
export const DNS_COREFILE = path.join(DNS_DIR, 'Corefile');
export const DNS_HOSTS_FILE = path.join(DNS_DIR, 'hosts');

// Set DEBUG_INGRESSCTL=1 to print command execution traces.
function debug(...args) {
  if (process.env.DEBUG_INGRESSCTL === '1') {
    console.log('[ingressctl:debug]', ...args);
  }
}

export function fail(msg) {
  console.error(msg);
  process.exit(1);
}

export function run(cmd, args, opts = {}) {
  debug('run', cmd, args.join(' '), 'cwd=', opts.cwd ?? ROOT_DIR);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd ?? ROOT_DIR,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  if (res.error) {
    console.error(`Failed to run command: ${cmd} ${args.join(' ')}`);
    console.error(res.error.message);
    process.exit(1);
  }
  if ((res.status ?? 1) !== 0) process.exit(res.status ?? 1);
}

// Run a command and capture stdout for probe/check style flows.
// Returns trimmed stdout on success; returns an empty string on non-zero exit
// or spawn errors so callers can treat it as a simple truthy/falsy existence check.
export function capture(cmd, args, opts = {}) {
  debug('capture', cmd, args.join(' '), 'cwd=', opts.cwd ?? ROOT_DIR);
  const res = spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: opts.cwd ?? ROOT_DIR,
    env: { ...process.env, ...(opts.env ?? {}) },
    encoding: 'utf8',
  });
  if (res.error) {
    console.error(`Failed to run command: ${cmd} ${args.join(' ')}`);
    console.error(res.error.message);
    return '';
  }
  if ((res.status ?? 1) !== 0) return '';
  return res.stdout.trim();
}

export function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}

export function loadDefaultEnv() {
  // Core-only defaults (ingress ports, dashboard host, etc.).
  loadEnvFile(path.join(ROOT_DIR, 'infra', 'traefik', '.env'));
  // Optional DNS defaults for wildcard domain routing.
  loadEnvFile(path.join(ROOT_DIR, 'infra', 'dns', '.env'));
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const k = a.slice(2);
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) out[k] = 'true';
    else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

export function parseBool(raw, fallback = false) {
  if (raw == null || raw === '') return fallback;
  const v = String(raw).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
}

export function composeArgs(files) {
  const out = [];
  for (const f of files) out.push('-f', f);
  return out;
}

export function sleepMs(ms) {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  if (secs === 0) return;
  spawnSync('bash', ['-lc', `sleep ${secs}`], { stdio: 'ignore' });
}

export function waitForComposeServiceRunning(cargs, service, cfg, env, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const out = capture('docker', [...cargs, 'ps', '--status', 'running', '--services', service], { cwd: cfg.workdir, env });
    if (out.split(/\r?\n/).map((s) => s.trim()).includes(service)) return true;
    sleepMs(1000);
  }
  return false;
}
