import fs from 'node:fs';
import path from 'node:path';
import {
  DYNAMIC_DIR,
  STATE_DIR,
  composeArgs,
  loadDefaultEnv,
  parseBool,
  loadEnvFile,
  run,
  fail,
  waitForComposeServiceRunning,
} from './shared.mjs';
import { cmdIngress } from './ingress.mjs';
import { resolveManifest, renderManifestEnv, writeRouteFile, writeState, removeState } from './manifest.mjs';
import { detectWsl, syncWindowsHostsFile, writeDnsHostsFile } from './dns.mjs';
import { cmdTls } from './tls.mjs';

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
  const autoWinHostsSync = parseBool(args['with-windows-hosts'] ?? process.env.INGRESS_WINDOWS_HOSTS_SYNC, false);
  const autoTlsRefresh = parseBool(args['with-tls'] ?? process.env.INGRESS_TLS_AUTO, false);
  const httpPort = process.env.TRAEFIK_HTTP_PORT ?? '80';
  const httpsPort = process.env.TRAEFIK_HTTPS_PORT ?? '443';
  const suffix = httpPort === '80' ? '' : `:${httpPort}`;
  const secureSuffix = httpsPort === '443' ? '' : `:${httpsPort}`;

  if (action === 'slug') {
    console.log(cfg.slug);
    return;
  }

  if (action === 'up') {
    cmdIngress('up', args);
    run('docker', [...cargs, 'up', '-d', '--build'], { cwd: cfg.workdir, env });
    const routeFile = writeRouteFile(cfg);
    writeState(cfg, routeFile);
    writeDnsHostsFile();
    if (autoTlsRefresh) cmdTls('refresh', args);
    if (autoWinHostsSync && detectWsl()) syncWindowsHostsFile(args);
    console.log(`Stack up: ${cfg.project}`);
    for (const r of cfg.routes) {
      console.log(`- http://${r.host}${suffix}`);
      if (r.tls !== false) console.log(`- https://${r.host}${secureSuffix}`);
    }

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
    writeDnsHostsFile();
    if (autoTlsRefresh) cmdTls('refresh', args);
    if (autoWinHostsSync && detectWsl()) syncWindowsHostsFile(args);
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

  fail('Usage: ingressctl stack up|down|logs [service]|migrate|seed|slug --manifest <file> [--slug <slug>] [--auto-migrate true|false] [--skip-migrate true|false] [--with-tls true|false]\n       ingressctl stack ls');
}
