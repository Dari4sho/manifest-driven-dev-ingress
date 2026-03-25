import fs from 'node:fs';
import path from 'node:path';
import { DYNAMIC_DIR, ROOT_DIR, capture, loadDefaultEnv, parseBool, run, fail } from './shared.mjs';
import { cmdDns } from './dns.mjs';

export function cmdIngress(action, args = {}) {
  loadDefaultEnv();
  const httpPort = process.env.TRAEFIK_HTTP_PORT ?? '80';
  const httpsPort = process.env.TRAEFIK_HTTPS_PORT ?? '443';
  const env = { TRAEFIK_HTTP_PORT: httpPort, TRAEFIK_HTTPS_PORT: httpsPort };
  const withDns = parseBool(args['with-dns'] ?? process.env.INGRESS_DNS_AUTO, false);

  if (action === 'up') {
    // Keep dashboard route static so it survives stack registration churn.
    fs.mkdirSync(DYNAMIC_DIR, { recursive: true });
    const dashboard = path.join(DYNAMIC_DIR, 'dashboard.yml');
    if (!fs.existsSync(dashboard)) {
      fs.writeFileSync(
        dashboard,
        "http:\n  routers:\n    traefik-dashboard:\n      rule: 'Host(`traefik.localhost`)'\n      entryPoints:\n        - web\n      service: api@internal\n    traefik-dashboard-secure:\n      rule: 'Host(`traefik.localhost`)'\n      entryPoints:\n        - websecure\n      service: api@internal\n      tls: {}\n",
        'utf8',
      );
    }
    // Ensure the shared ingress network exists.
    if (!capture('docker', ['network', 'inspect', 'dev-ingress'], { env })) {
      run('docker', ['network', 'create', 'dev-ingress'], { env });
    }
    if (withDns) cmdDns('up', args);
    run('docker', ['compose', '-p', 'local-ingress', '-f', path.join(ROOT_DIR, 'infra/traefik/compose.yml'), 'up', '-d'], { env });
    const suffix = httpPort === '80' ? '' : `:${httpPort}`;
    console.log(`Ingress up: http://traefik.localhost${suffix}`);
    return;
  }

  if (action === 'down') {
    run('docker', ['compose', '-p', 'local-ingress', '-f', path.join(ROOT_DIR, 'infra/traefik/compose.yml'), 'down'], { env });
    if (withDns) cmdDns('down', args);
    console.log('Ingress down');
    return;
  }

  if (action === 'status') {
    const status = capture('docker', ['ps', '--filter', 'name=local-ingress-traefik-1', '--format', '{{.Status}}']);
    if (!status) console.log('Ingress status: down');
    else console.log(`Ingress status: up (${status})`);
    return;
  }

  fail('Usage: ingressctl ingress up|down|status [--with-dns true|false]');
}
