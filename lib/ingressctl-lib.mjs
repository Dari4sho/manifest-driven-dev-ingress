import { fail, parseArgs, capture, composeArgs, run } from './shared.mjs';
import {
  sanitize,
  tpl,
  resolveManifest,
  renderManifestEnv,
  buildRouteConfigYaml,
} from './manifest.mjs';
import {
  resolveDnsConfig,
  buildDnsCorefile,
  buildDnsHostsContent,
  buildWindowsHostsSection,
  replaceManagedSection,
  cmdDns,
} from './dns.mjs';
import { cmdIngress } from './ingress.mjs';
import { cmdStack } from './stack.mjs';

export {
  sanitize,
  tpl,
  parseArgs,
  resolveManifest,
  resolveDnsConfig,
  buildDnsCorefile,
  buildDnsHostsContent,
  buildWindowsHostsSection,
  replaceManagedSection,
  renderManifestEnv,
  buildRouteConfigYaml,
  composeArgs,
  capture,
  run,
  cmdIngress,
  cmdDns,
  cmdStack,
};

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const [scope, action] = args._;

  if (scope === 'ingress') cmdIngress(action, args);
  else if (scope === 'dns') cmdDns(action, args);
  else if (scope === 'stack') cmdStack(action, args);
  else {
    fail(`Usage:\n  ingressctl ingress up|down|status [--with-dns true|false]\n  ingressctl dns up|down|status|doctor|windows-sync|windows-clear [--domain <domain>] [--bind-ip <ip>] [--port <port>] [--upstream "<dns...>"] [--windows-hosts-path <path>]\n  ingressctl stack up|down|logs [service]|migrate|seed|slug --manifest <file> [--slug <slug>] [--with-windows-hosts true|false]\n  ingressctl stack ls`);
  }
}
