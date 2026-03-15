import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DYNAMIC_DIR = path.join(ROOT_DIR, 'infra', 'traefik', 'dynamic');
export const STATE_DIR = path.join(ROOT_DIR, '.ingressctl', 'stacks');

export function fail(msg) {
  console.error(msg);
  process.exit(1);
}

export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd ?? ROOT_DIR,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  if ((res.status ?? 1) !== 0) process.exit(res.status ?? 1);
}

export function capture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: opts.cwd ?? ROOT_DIR,
    env: { ...process.env, ...(opts.env ?? {}) },
    encoding: 'utf8',
  });
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

export function tpl(str, vars) {
  // Lightweight template expansion used across manifest fields.
  return String(str).replace(/\{slug\}/g, vars.slug).replace(/\{project\}/g, vars.project).replace(/\{name\}/g, vars.name ?? '');
}

export function renderManifestEnv(cfg, ports) {
  // Optional manifest.env allows project-specific runtime values without hardcoding
  // app assumptions into ingressctl.
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
  const workdir = path.resolve(manifestDir, m.compose?.workdir ?? '.');
  // Slug can be explicitly passed, fixed in manifest, or auto-derived from repo/worktree.
  const slug = slugOverride || (m.slug && m.slug !== 'auto' ? sanitize(m.slug) : deriveSlug(workdir));
  const projectTemplate = m.compose?.project_name_template ?? '{slug}';
  // Compose project controls network/container names and can differ from slug.
  const project = sanitize(tpl(projectTemplate, { slug, project: slug, name }));

  const files = (m.compose?.files ?? ['compose.yml']).map((f) => path.resolve(workdir, f));
  const envFiles = (m.compose?.env_files ?? []).map((f) => path.resolve(workdir, f));

  if (!Array.isArray(m.routes) || m.routes.length === 0) fail('Manifest routes[] is required');

  const routes = m.routes.map((r, idx) => {
    const rname = sanitize(r.name ?? `route-${idx + 1}`);
    const host = tpl(r.host, { slug, project, name });
    if (!host) fail(`Route ${rname} missing host`);

    // Keep source compose service metadata for env templating and diagnostics.
    const composeService = r.service?.compose_service ?? r.service?.name ?? '';
    let url;
    if (r.service?.type === 'url' || r.service?.url) {
      url = tpl(r.service.url ?? r.service.url_template, { slug, project, name });
    } else {
      const svc = composeService;
      const port = r.service?.port;
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

  const envTemplates = m.env && typeof m.env === 'object' ? m.env : {};
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

export function writeRouteFile(cfg) {
  // File-provider config consumed by the shared Traefik instance.
  fs.mkdirSync(DYNAMIC_DIR, { recursive: true });
  const file = path.join(DYNAMIC_DIR, `${cfg.project}.yml`);
  const y = buildRouteConfigYaml(cfg);
  fs.writeFileSync(file, y, 'utf8');
  return file;
}

export function writeState(cfg, routeFile) {
  // Local bookkeeping so stacks can be listed and inspected.
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
    run('bash', ['-lc', 'docker network inspect dev-ingress >/dev/null 2>&1 || docker network create dev-ingress >/dev/null'], { env });
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

  const cfg = resolveManifest(manifest, args.slug);
  const httpPort = process.env.TRAEFIK_HTTP_PORT ?? '80';
  const httpsPort = process.env.TRAEFIK_HTTPS_PORT ?? '443';
  const suffix = httpPort === '80' ? '' : `:${httpPort}`;

  // Core env passed to compose; project-specific env is merged from manifest.env below.
  const env = {
    COMPOSE_PROJECT_NAME: cfg.project,
    TRAEFIK_HTTP_PORT: httpPort,
    TRAEFIK_HTTPS_PORT: httpsPort,
  };
  // Manifest-provided env is only applied when not explicitly set by caller env.
  const manifestEnv = renderManifestEnv(cfg, { httpPort, httpsPort });
  for (const [k, v] of Object.entries(manifestEnv)) {
    if (!(k in process.env)) env[k] = v;
  }

  for (const ef of cfg.envFiles) loadEnvFile(ef);

  const cargs = ['compose', ...composeArgs(cfg.files)];

  if (action === 'up') {
    if (!capture('docker', ['network', 'inspect', 'dev-ingress'])) fail("Global ingress network missing. Run 'ingressctl ingress up' first.");
    run('docker', [...cargs, 'up', '-d', '--build'], { cwd: cfg.workdir, env });
    // Register stack routes in Traefik after compose services are up.
    const routeFile = writeRouteFile(cfg);
    writeState(cfg, routeFile);
    console.log(`Stack up: ${cfg.project}`);
    for (const r of cfg.routes) console.log(`- http://${r.host}${suffix}`);
    return;
  }

  if (action === 'down') {
    run('docker', [...cargs, 'down', '--remove-orphans'], { cwd: cfg.workdir, env });
    // Remove dynamic route file so Traefik stops routing to this stack.
    const routeFile = path.join(DYNAMIC_DIR, `${cfg.project}.yml`);
    if (fs.existsSync(routeFile)) fs.unlinkSync(routeFile);
    removeState(cfg.project);
    console.log(`Stack down: ${cfg.project}`);
    return;
  }

  fail('Usage: ingressctl stack up|down|ls');
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const [scope, action] = args._;

  if (scope === 'ingress') cmdIngress(action);
  else if (scope === 'stack') cmdStack(action, args);
  else {
    fail(`Usage:\n  ingressctl ingress up|down|status\n  ingressctl stack up --manifest <file> [--slug <slug>]\n  ingressctl stack down --manifest <file> [--slug <slug>]\n  ingressctl stack ls`);
  }
}
