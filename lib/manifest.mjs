import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { DYNAMIC_DIR, STATE_DIR, fail } from './shared.mjs';

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
  return String(str).replace(/\{([a-z0-9_]+)\}/gi, (_, key) => {
    if (Object.hasOwn(vars, key)) return String(vars[key] ?? '');
    return `{${key}}`;
  });
}

function normalizeHostDomain(raw) {
  const domain = String(raw || '').trim().toLowerCase().replace(/\.+/g, '.').replace(/^\.+|\.+$/g, '');
  if (!domain) fail('Host domain cannot be empty. Set stack.domain or INGRESS_DOMAIN.');
  if (!/^[a-z0-9.-]+$/.test(domain)) fail(`Invalid host domain: ${raw}`);
  return domain;
}

// Optional manifest.env allows project-specific runtime values without hardcoding
// app assumptions into ingressctl.
export function renderManifestEnv(cfg, ports) {
  const routeByName = Object.fromEntries(cfg.routes.map((r) => [r.name, r]));
  const vars = {
    slug: cfg.slug,
    project: cfg.project,
    name: cfg.name,
    domain: cfg.domain,
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
  const domain = normalizeHostDomain(stack.domain ?? m.domain ?? process.env.INGRESS_DOMAIN ?? 'localhost');
  const projectTemplate = compose.project_name_template ?? '{slug}';
  // Compose project controls network/container names and can differ from slug.
  const project = sanitize(tpl(projectTemplate, { slug, project: slug, name, domain }));

  const files = (compose.files ?? ['compose.yml']).map((f) => path.resolve(workdir, f));
  const envFiles = (compose.env_files ?? []).map((f) => path.resolve(workdir, f));

  const serviceDefs = stack.services && typeof stack.services === 'object' ? stack.services : {};
  const routesRaw = Array.isArray(stack.routes) ? stack.routes : [];
  if (routesRaw.length === 0) fail('Manifest stack.routes[] is required');

  const routes = routesRaw.map((r, idx) => {
    const rname = sanitize(r.name ?? `route-${idx + 1}`);
    const host = tpl(r.host, { slug, project, name, domain });
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
      url = tpl(routeService.url ?? routeService.url_template, { slug, project, name, domain });
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
  return { manifestPath: abs, name, workdir, slug, project, domain, files, envFiles, routes, envTemplates };
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
