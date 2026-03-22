import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DYNAMIC_DIR = path.join(ROOT_DIR, 'infra', 'traefik', 'dynamic');
export const STATE_DIR = path.join(ROOT_DIR, '.ingressctl', 'stacks');

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
}

export function sanitize(value) {
  const s = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  return s || 'dev';
}

export function deriveSlug(baseDir) {
  let repo = path.basename(baseDir);
  try {
    repo = execSync('git rev-parse --show-toplevel', { cwd: baseDir, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim().split(path.sep).pop();
  } catch {}
  let branch = '';
  try {
    branch = execSync('git branch --show-current', { cwd: baseDir, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch {}
  const worktree = path.basename(baseDir);
  const raw = branch ? (branch === repo ? repo : `${repo}-${branch}`) : (worktree === repo ? repo : `${repo}-${worktree}`);
  let slug = sanitize(raw);
  if (slug.length > 40) {
    const h = execSync(`printf '%s' ${JSON.stringify(raw)} | sha1sum | cut -c1-6`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', shell: '/bin/bash' }).trim();
    slug = `${slug.slice(0, 33)}-${h}`;
  }
  return slug;
}

// Lightweight template expansion used across manifest fields.
export function tpl(str, vars) {
  return String(str).replace(/\{slug\}/g, vars.slug).replace(/\{project\}/g, vars.project).replace(/\{name\}/g, vars.name ?? '');
}

// Optional manifest.env allows project-specific runtime values without hardcoding
// app assumptions into ingressctl.
export function renderManifestEnv(cfg, ports) {
  const routeByName = Object.fromEntries(cfg.routes.map((r) => [r.name, r]));
  const vars = {
    slug: cfg.slug,
    project: cfg.project,
    name: cfg.name,
    http_port: ports.httpPort,
    https_port: ports.httpsPort,
    http_port_suffix: ports.httpPort === '80' ? '' : `:${ports.httpPort}`,
    https_port_suffix: ports.httpsPort === '443' ? '' : `:${ports.httpsPort}`,
  };

  const out = {};
  for (const [k, rawVal] of Object.entries(cfg.envTemplates ?? {})) {
    let v = tpl(String(rawVal), vars);
    v = v
      .replace(/\{http_port\}/g, vars.http_port)
      .replace(/\{https_port\}/g, vars.https_port)
      .replace(/\{http_port_suffix\}/g, vars.http_port_suffix)
      .replace(/\{https_port_suffix\}/g, vars.https_port_suffix)
      .replace(/\{route\.([a-z0-9-]+)\.host\}/g, (_, n) => routeByName[n]?.host ?? '')
      .replace(/\{route\.([a-z0-9-]+)\.url\}/g, (_, n) => routeByName[n]?.url ?? '');
    out[k] = v;
  }

  return out;
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

export function resolveManifest(manifestPath, slugOverride) {
  const abs = path.resolve(process.cwd(), manifestPath);
  if (!fs.existsSync(abs)) fail(`Manifest not found: ${abs}`);
  const raw = fs.readFileSync(abs, 'utf8');
  let m;
  try {
    m = JSON.parse(raw);
  } catch (e) {
    fail(`Manifest must be valid JSON: ${abs}`);
  }

  const manifestDir = path.dirname(abs);
  const name = sanitize(m.name ?? path.basename(abs, '.json'));
  const stack = m.stack && typeof m.stack === 'object' ? m.stack : m;
  const compose = stack.compose && typeof stack.compose === 'object' ? stack.compose : {};
  const workdir = path.resolve(manifestDir, compose.workdir ?? '.');
  // Slug can be explicitly passed, fixed in manifest, or auto-derived from repo/worktree.
  const fixedSlug = stack.slug ?? m.slug;
  const slug = slugOverride || (fixedSlug && fixedSlug !== 'auto' ? sanitize(fixedSlug) : deriveSlug(workdir));
  const projectTemplate = compose.project_name_template ?? '{slug}';
  // Compose project controls network/container names and can differ from slug.
  const project = sanitize(tpl(projectTemplate, { slug, project: slug, name }));

  const files = (compose.files ?? ['compose.yml']).map((f) => path.resolve(workdir, f));
  const envFiles = (compose.env_files ?? []).map((f) => path.resolve(workdir, f));

  const serviceDefs = stack.services && typeof stack.services === 'object' ? stack.services : {};
  const routesRaw = Array.isArray(stack.routes) ? stack.routes : [];
  if (routesRaw.length === 0) fail('Manifest stack.routes[] is required');

  const routes = routesRaw.map((r, idx) => {
    const rname = sanitize(r.name ?? `route-${idx + 1}`);
    const host = tpl(r.host, { slug, project, name });
    if (!host) fail(`Route ${rname} missing host`);

    const routeService = typeof r.service === 'string' ? serviceDefs[r.service] : r.service;
    if (!routeService) {
      if (typeof r.service === 'string') fail(`Route ${rname} references unknown stack.services key: ${r.service}`);
      fail(`Route ${rname} missing service definition`);
    }

    // Keep source compose service metadata for env templating and diagnostics.
    const composeService = routeService?.compose_service ?? routeService?.name ?? '';
    let url;
    if (routeService?.type === 'url' || routeService?.url) {
      url = tpl(routeService.url ?? routeService.url_template, { slug, project, name });
    } else {
      const svc = composeService;
      const port = routeService?.port;
      if (!svc || !port) fail(`Route ${rname} needs service.compose_service and service.port`);
      url = `http://${project}-${svc}-1:${port}`;
    }

    return {
      name: rname,
      host,
      entrypoint: r.entrypoint ?? 'web',
      composeService,
      url,
    };
  });

  const envTemplates = stack.env && typeof stack.env === 'object' ? stack.env : {};
  return { manifestPath: abs, name, workdir, slug, project, files, envFiles, routes, envTemplates };
}

export function buildRouteConfigYaml(cfg) {
  let y = 'http:\n  routers:\n';
  for (const r of cfg.routes) {
    const rn = `${r.name}-${cfg.project}`;
    const sn = `${r.name}-${cfg.project}`;
    y += `    ${rn}:\n`;
    y += `      rule: 'Host(\`${r.host}\`)'\n`;
    y += `      entryPoints:\n        - ${r.entrypoint}\n`;
    y += `      service: ${sn}\n`;
  }
  y += '\n  services:\n';
  for (const r of cfg.routes) {
    const sn = `${r.name}-${cfg.project}`;
    y += `    ${sn}:\n`;
    y += `      loadBalancer:\n`;
    y += `        servers:\n`;
    y += `          - url: \"${r.url}\"\n`;
  }
  return y;
}

// File-provider config consumed by the shared Traefik instance.
export function writeRouteFile(cfg) {
  fs.mkdirSync(DYNAMIC_DIR, { recursive: true });
  const file = path.join(DYNAMIC_DIR, `${cfg.project}.yml`);
  const y = buildRouteConfigYaml(cfg);
  fs.writeFileSync(file, y, 'utf8');
  return file;
}

// Local bookkeeping so stacks can be listed and inspected.
export function writeState(cfg, routeFile) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const sf = path.join(STATE_DIR, `${cfg.project}.json`);
  fs.writeFileSync(sf, JSON.stringify({
    project: cfg.project,
    slug: cfg.slug,
    manifest: cfg.manifestPath,
    workdir: cfg.workdir,
    routes: cfg.routes,
    route_file: routeFile,
    updated_at: new Date().toISOString(),
  }, null, 2));
}

export function removeState(project) {
  const sf = path.join(STATE_DIR, `${project}.json`);
  if (fs.existsSync(sf)) fs.unlinkSync(sf);
}

export function composeArgs(files) {
  const out = [];
  for (const f of files) out.push('-f', f);
  return out;
}

export function cmdIngress(action) {
  loadDefaultEnv();
  const httpPort = process.env.TRAEFIK_HTTP_PORT ?? '80';
  const httpsPort = process.env.TRAEFIK_HTTPS_PORT ?? '443';
  const env = { TRAEFIK_HTTP_PORT: httpPort, TRAEFIK_HTTPS_PORT: httpsPort };

  if (action === 'up') {
    // Keep dashboard route static so it survives stack registration churn.
    fs.mkdirSync(DYNAMIC_DIR, { recursive: true });
    const dashboard = path.join(DYNAMIC_DIR, 'dashboard.yml');
    if (!fs.existsSync(dashboard)) {
      fs.writeFileSync(dashboard, "http:\n  routers:\n    traefik-dashboard:\n      rule: 'Host(`traefik.localhost`)'\n      entryPoints:\n        - web\n      service: api@internal\n", 'utf8');
    }
    // Ensure the shared ingress network exists: inspect returns output when present,
    // and an empty string on failure/missing network, so create it only when needed.
    if (!capture('docker', ['network', 'inspect', 'dev-ingress'], { env })) {
      run('docker', ['network', 'create', 'dev-ingress'], { env });
    }
    run('docker', ['compose', '-p', 'local-ingress', '-f', path.join(ROOT_DIR, 'infra/traefik/compose.yml'), 'up', '-d'], { env });
    const suffix = httpPort === '80' ? '' : `:${httpPort}`;
    console.log(`Ingress up: http://traefik.localhost${suffix}`);
    return;
  }

  if (action === 'down') {
    run('docker', ['compose', '-p', 'local-ingress', '-f', path.join(ROOT_DIR, 'infra/traefik/compose.yml'), 'down'], { env });
    console.log('Ingress down');
    return;
  }

  if (action === 'status') {
    const status = capture('docker', ['ps', '--filter', 'name=local-ingress-traefik-1', '--format', '{{.Status}}']);
    if (!status) console.log('Ingress status: down');
    else console.log(`Ingress status: up (${status})`);
    return;
  }

  fail('Usage: ingressctl ingress up|down|status');
}

function parseSlugArg(args) {
  return args.slug || process.env.INGRESS_STACK_SLUG || '';
}

function buildStackComposeContext(manifest, slugOverride) {
  const cfg = resolveManifest(manifest, slugOverride || undefined);
  const httpPort = process.env.TRAEFIK_HTTP_PORT ?? '80';
  const httpsPort = process.env.TRAEFIK_HTTPS_PORT ?? '443';
  const env = {
    COMPOSE_PROJECT_NAME: cfg.project,
    TRAEFIK_HTTP_PORT: httpPort,
    TRAEFIK_HTTPS_PORT: httpsPort,
  };
  const manifestEnv = renderManifestEnv(cfg, { httpPort, httpsPort });
  for (const [k, v] of Object.entries(manifestEnv)) {
    if (!(k in process.env)) env[k] = v;
  }
  for (const ef of cfg.envFiles) loadEnvFile(ef);
  const cargs = ['compose', ...composeArgs(cfg.files)];
  const raw = JSON.parse(fs.readFileSync(cfg.manifestPath, 'utf8'));
  const stack = raw.stack && typeof raw.stack === 'object' ? raw.stack : raw;
  const stackActions = stack.actions && typeof stack.actions === 'object' ? stack.actions : {};
  return { cfg, env, cargs, stackActions };
}

function parseBool(raw, fallback = false) {
  if (raw == null || raw === '') return fallback;
  const v = String(raw).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
}

function parseActionNode(stackActions, actionName) {
  const node = stackActions?.[actionName];
  if (!node || typeof node !== 'object') return { service: '', command: '' };
  return {
    service: node.service != null ? String(node.service) : '',
    command: node.command != null ? String(node.command) : '',
  };
}

function parseActionService(actionName, args, actionNode) {
  const argName = `${actionName}-service`;
  const envName = `INGRESS_${actionName.toUpperCase()}_SERVICE`;
  return String(args[argName] ?? process.env[envName] ?? actionNode.service ?? '').trim();
}

function sleepMs(ms) {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  if (secs === 0) return;
  spawnSync('bash', ['-lc', `sleep ${secs}`], { stdio: 'ignore' });
}

function waitForComposeServiceRunning(cargs, service, cfg, env, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const out = capture('docker', [...cargs, 'ps', '--status', 'running', '--services', service], { cwd: cfg.workdir, env });
    if (out.split(/\r?\n/).map((s) => s.trim()).includes(service)) return true;
    sleepMs(1000);
  }
  return false;
}

export function cmdStack(action, args) {
  const manifest = args.manifest;
  if (!manifest && action !== 'ls') fail('Missing --manifest <path>');
  loadDefaultEnv();

  if (action === 'ls') {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const files = fs.readdirSync(STATE_DIR).filter((f) => f.endsWith('.json')).sort();
    if (files.length === 0) {
      console.log('No registered stacks.');
      return;
    }
    for (const f of files) {
      const s = JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8'));
      console.log(`${s.project} (slug=${s.slug})`);
      console.log(`  manifest: ${s.manifest}`);
      for (const r of s.routes) console.log(`  route: ${r.host} -> ${r.url}`);
    }
    return;
  }

  const slugOverride = parseSlugArg(args);
  const rest = args._.slice(2);
  const { cfg, env, cargs, stackActions } = buildStackComposeContext(manifest, slugOverride);
  const httpPort = process.env.TRAEFIK_HTTP_PORT ?? '80';
  const suffix = httpPort === '80' ? '' : `:${httpPort}`;

  if (action === 'slug') {
    console.log(cfg.slug);
    return;
  }

  if (action === 'up') {
    cmdIngress('up');
    run('docker', [...cargs, 'up', '-d', '--build'], { cwd: cfg.workdir, env });
    const routeFile = writeRouteFile(cfg);
    writeState(cfg, routeFile);
    console.log(`Stack up: ${cfg.project}`);
    for (const r of cfg.routes) console.log(`- http://${r.host}${suffix}`);

    const migrateAction = parseActionNode(stackActions, 'migrate');
    const migrateService = parseActionService('migrate', args, migrateAction);
    const autoMigrate = parseBool(args['auto-migrate'] ?? process.env.INGRESS_AUTO_MIGRATE, parseBool(stackActions?.up?.migrate?.enabled, false));
    const skipMigrate = parseBool(args['skip-migrate'] ?? process.env.INGRESS_SKIP_MIGRATIONS, false);
    const migrateCmd = migrateAction.command;
    if (autoMigrate && !skipMigrate && migrateCmd) {
      if (!migrateService) fail('Missing migrate service. Set stack.actions.migrate.service or --migrate-service <compose_service>.');
      if (!waitForComposeServiceRunning(cargs, migrateService, cfg, env, 45000)) {
        fail(`Timed out waiting for service '${migrateService}' to be running before migrations.`);
      }
      console.log(`Running migrate command for stack: ${cfg.project}`);
      run('docker', [...cargs, 'exec', '-T', migrateService, 'bash', '-lc', String(migrateCmd)], { cwd: cfg.workdir, env });
    } else if (skipMigrate) {
      console.log('Skipping migrations (INGRESS_SKIP_MIGRATIONS=1 / --skip-migrate)');
    }
    return;
  }

  if (action === 'down') {
    run('docker', [...cargs, 'down', '--remove-orphans'], { cwd: cfg.workdir, env });
    const routeFile = path.join(DYNAMIC_DIR, `${cfg.project}.yml`);
    if (fs.existsSync(routeFile)) fs.unlinkSync(routeFile);
    removeState(cfg.project);
    console.log(`Stack down: ${cfg.project}`);
    return;
  }

  if (action === 'logs') {
    const service = rest[0];
    if (!service) run('docker', [...cargs, 'logs', '-f'], { cwd: cfg.workdir, env });
    else run('docker', [...cargs, 'logs', '-f', '--tail=200', service], { cwd: cfg.workdir, env });
    return;
  }

  if (action === 'migrate') {
    const migrateAction = parseActionNode(stackActions, 'migrate');
    const migrateService = parseActionService('migrate', args, migrateAction);
    const migrateCmd = migrateAction.command;
    if (!migrateCmd) fail('Manifest stack.actions.migrate.command is not configured');
    if (!migrateService) fail('Manifest stack.actions.migrate.service is not configured (or pass --migrate-service).');
    run('docker', [...cargs, 'exec', '-T', migrateService, 'bash', '-lc', String(migrateCmd)], { cwd: cfg.workdir, env });
    return;
  }

  if (action === 'seed') {
    const seedAction = parseActionNode(stackActions, 'seed');
    const seedService = parseActionService('seed', args, seedAction);
    const seedCmd = seedAction.command;
    if (!seedCmd) fail('Manifest stack.actions.seed.command is not configured');
    if (!seedService) fail('Manifest stack.actions.seed.service is not configured (or pass --seed-service).');
    run('docker', [...cargs, 'exec', '-T', seedService, 'bash', '-lc', String(seedCmd)], { cwd: cfg.workdir, env });
    return;
  }

  fail('Usage: ingressctl stack up|down|logs [service]|migrate|seed|slug --manifest <file> [--slug <slug>] [--auto-migrate true|false] [--skip-migrate true|false]\n       ingressctl stack ls');
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const [scope, action] = args._;

  if (scope === 'ingress') cmdIngress(action);
  else if (scope === 'stack') cmdStack(action, args);
  else {
    fail(`Usage:\n  ingressctl ingress up|down|status\n  ingressctl stack up|down|logs [service]|migrate|seed|slug --manifest <file> [--slug <slug>]\n  ingressctl stack ls`);
  }
}
