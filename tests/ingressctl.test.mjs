import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
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
} from "../lib/ingressctl-lib.mjs";

async function makeStackHarness() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ingressctl-project-test-"));
  const stackDir = path.join(tmp, "stack");
  const fakeBinDir = path.join(tmp, "fake-bin");
  const manifestPath = path.join(tmp, "manifest.json");
  const logPath = path.join(tmp, "docker.log");

  await fsp.mkdir(stackDir, { recursive: true });
  await fsp.mkdir(fakeBinDir, { recursive: true });
  await fsp.writeFile(path.join(stackDir, "compose.yml"), "services: {}\n", "utf8");
  await fsp.writeFile(logPath, "", "utf8");

  const fakeDockerPath = path.join(fakeBinDir, "docker");
  await fsp.writeFile(
    fakeDockerPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "for arg in \"$@\"; do",
      "  printf 'ARG:%s\\n' \"$arg\" >> \"$FAKE_DOCKER_LOG\"",
      "done",
      "printf '%s\\n' '---' >> \"$FAKE_DOCKER_LOG\"",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(fakeDockerPath, 0o755);

  const writeManifest = async (stackActions) => {
    const manifest = {
      name: "stack-actions-test",
      stack: {
        slug: "test-slug",
        compose: {
          workdir: "./stack",
          files: ["compose.yml"],
        },
        routes: [
          {
            name: "app",
            host: "app-{slug}.localhost",
            service: { compose_service: "web", port: 5173 },
          },
        ],
        actions: stackActions,
      },
    };
    await fsp.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  };

  return { tmp, manifestPath, logPath, fakeBinDir, writeManifest };
}

function runIngressctlStack(args, env = {}) {
  return spawnSync(process.execPath, ["bin/ingressctl", "stack", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
}

test("sanitize normalizes strings into kebab-case", () => {
  assert.equal(sanitize("My Repo__Feature/X"), "my-repo-feature-x");
  assert.equal(sanitize("---"), "dev");
});

test("tpl replaces slug/project/name placeholders", () => {
  const out = tpl("app-{slug}-{project}-{name}", {
    slug: "s1",
    project: "p1",
    name: "demo",
  });
  assert.equal(out, "app-s1-p1-demo");
});

test("parseArgs supports positional args and --flags", () => {
  const args = parseArgs([
    "stack",
    "up",
    "--manifest",
    "/tmp/m.json",
    "--slug",
    "x",
    "--dry-run",
  ]);
  assert.deepEqual(args, {
    _: ["stack", "up"],
    manifest: "/tmp/m.json",
    slug: "x",
    "dry-run": "true",
  });
});

test("resolveManifest renders route hosts/urls and compose config", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ingressctl-test-"));
  const manifestsDir = path.join(tmp, "manifests");
  const stackDir = path.join(tmp, "stack");
  await fsp.mkdir(manifestsDir, { recursive: true });
  await fsp.mkdir(stackDir, { recursive: true });
  await fsp.writeFile(path.join(stackDir, "compose.yml"), "services: {}\n", "utf8");
  await fsp.writeFile(path.join(stackDir, "compose.dev.yml"), "services: {}\n", "utf8");

  const manifestPath = path.join(manifestsDir, "demo.json");
  const manifest = {
    schema_version: 2,
    name: "Demo Local",
    stack: {
      slug: "auto",
      compose: {
        workdir: "../stack",
        files: ["compose.yml", "compose.dev.yml"],
        project_name_template: "proj-{slug}",
      },
      services: {
        web: { compose_service: "frontend", port: 3000 },
        api: { compose_service: "api", port: 8000 },
        admin: { url: "http://internal-{project}:9000" },
      },
      env: {
        API_BASE_URL: "http://{route.api.host}{http_port_suffix}",
      },
      routes: [
        {
          name: "app web",
          host: "app-{slug}.localhost",
          service: "web",
        },
        {
          name: "api",
          host: "api-{slug}.localhost",
          service: "api",
        },
        {
          name: "admin",
          host: "admin-{project}.localhost",
          service: "admin",
        },
      ],
    },
  };
  await fsp.writeFile(manifestPath, JSON.stringify(manifest), "utf8");

  const oldCwd = process.cwd();
  process.chdir(tmp);
  try {
    const cfg = resolveManifest(manifestPath, "feature-x");
    assert.equal(cfg.slug, "feature-x");
    assert.equal(cfg.project, "proj-feature-x");
    assert.equal(cfg.workdir, stackDir);
    assert.deepEqual(cfg.files, [
      path.join(stackDir, "compose.yml"),
      path.join(stackDir, "compose.dev.yml"),
    ]);
    assert.equal(cfg.routes[0].name, "app-web");
    assert.equal(cfg.routes[0].host, "app-feature-x.localhost");
    assert.equal(cfg.routes[0].url, "http://proj-feature-x-frontend-1:3000");
    assert.equal(cfg.routes[1].url, "http://proj-feature-x-api-1:8000");
    assert.equal(cfg.routes[2].url, "http://internal-proj-feature-x:9000");
    assert.equal(cfg.envTemplates.API_BASE_URL, "http://{route.api.host}{http_port_suffix}");
  } finally {
    process.chdir(oldCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("renderManifestEnv resolves route and port placeholders", () => {
  const cfg = {
    slug: "feat-a",
    project: "proj-feat-a",
    name: "demo",
    routes: [
      {
        name: "api",
        host: "api-feat-a.localhost",
        url: "http://proj-feat-a-api-1:8000",
      },
      {
        name: "web",
        host: "app-feat-a.localhost",
        url: "http://proj-feat-a-frontend-1:3000",
      },
    ],
    envTemplates: {
      API_BASE_URL: "http://{route.api.host}{http_port_suffix}",
      WEB_INTERNAL: "{route.web.url}",
      META: "{slug}|{project}|{name}|{http_port}|{https_port}",
    },
  };

  const out = renderManifestEnv(cfg, { httpPort: "8080", httpsPort: "4443" });
  assert.deepEqual(out, {
    API_BASE_URL: "http://api-feat-a.localhost:8080",
    WEB_INTERNAL: "http://proj-feat-a-frontend-1:3000",
    META: "feat-a|proj-feat-a|demo|8080|4443",
  });
});

test("buildRouteConfigYaml emits expected router/service blocks", () => {
  const yaml = buildRouteConfigYaml({
    project: "proj-demo",
    routes: [
      {
        name: "api",
        host: "api-demo.localhost",
        entrypoint: "web",
        url: "http://proj-demo-api-1:8000",
      },
      {
        name: "app",
        host: "app-demo.localhost",
        entrypoint: "web",
        url: "http://proj-demo-frontend-1:3000",
      },
    ],
  });

  assert.match(yaml, /api-proj-demo:/);
  assert.match(yaml, /Host\(`api-demo\.localhost`\)/);
  assert.match(yaml, /url: "http:\/\/proj-demo-api-1:8000"/);
  assert.match(yaml, /app-proj-demo:/);
});

test("composeArgs expands compose file list", () => {
  assert.deepEqual(composeArgs(["a.yml", "b.yml"]), ["-f", "a.yml", "-f", "b.yml"]);
});

test("resolveDnsConfig applies defaults", () => {
  const cfg = resolveDnsConfig({});
  assert.equal(cfg.domain, "ingress.test");
  assert.equal(cfg.bindIp, "127.0.0.1");
  assert.equal(cfg.port, 53);
  assert.equal(cfg.upstream, "1.1.1.1 8.8.8.8");
});

test("resolveDnsConfig parses overrides", () => {
  const cfg = resolveDnsConfig({
    domain: "dev.local",
    "bind-ip": "0.0.0.0",
    port: "1053",
  });
  assert.equal(cfg.domain, "dev.local");
  assert.equal(cfg.bindIp, "0.0.0.0");
  assert.equal(cfg.port, 1053);
});

test("buildDnsCorefile renders wildcard templates for domain", () => {
  const corefile = buildDnsCorefile("dev.local", "9.9.9.9");
  assert.match(corefile, /^dev\.local:53/m);
  assert.match(corefile, /^.:53/m);
  assert.match(corefile, /hosts \/etc\/coredns\/hosts/);
  assert.match(corefile, /forward \. 9\.9\.9\.9/);
  assert.match(corefile, /template IN A/);
  assert.match(corefile, /127\.0\.0\.1/);
  assert.match(corefile, /template IN AAAA/);
  assert.match(corefile, /::1/);
});

test("buildDnsHostsContent renders deduped hosts entries", () => {
  const content = buildDnsHostsContent([
    "api-howtio.test",
    "app-howtio.test",
    "api-howtio.test",
    "bad host",
  ]);
  assert.match(content, /^127\.0\.0\.1 /m);
  assert.match(content, /^::1 /m);
  assert.match(content, /api-howtio\.test/);
  assert.match(content, /app-howtio\.test/);
  assert.doesNotMatch(content, /bad host/);
});

test("buildWindowsHostsSection emits managed block", () => {
  const section = buildWindowsHostsSection(["app.demo.test", "api.demo.test", "app.demo.test"]);
  assert.match(section, /IngressctlHostsSectionStart/);
  assert.match(section, /Managed by ingressctl/);
  assert.match(section, /127\.0\.0\.1 app\.demo\.test/);
  assert.match(section, /127\.0\.0\.1 api\.demo\.test/);
  assert.match(section, /IngressctlHostsSectionEnd/);
});

test("replaceManagedSection appends when missing and replaces when present", () => {
  const base = "# sample\n127.0.0.1 localhost\n";
  const s1 = buildWindowsHostsSection(["app.one.test"]);
  const withManaged = replaceManagedSection(base, s1);
  assert.match(withManaged, /app\.one\.test/);

  const s2 = buildWindowsHostsSection(["app.two.test"]);
  const replaced = replaceManagedSection(withManaged, s2);
  assert.match(replaced, /app\.two\.test/);
  assert.doesNotMatch(replaced, /app\.one\.test/);
});

test("resolveManifest supports {domain} placeholder from stack.domain", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ingressctl-test-domain-"));
  const manifestPath = path.join(tmp, "m.json");
  const stackDir = path.join(tmp, "stack");
  await fsp.mkdir(stackDir, { recursive: true });
  await fsp.writeFile(path.join(stackDir, "compose.yml"), "services: {}\n", "utf8");
  await fsp.writeFile(
    manifestPath,
    JSON.stringify({
      name: "demo",
      stack: {
        slug: "demo",
        domain: "ingress.test",
        compose: { workdir: "./stack", files: ["compose.yml"] },
        routes: [{ host: "app-{slug}.{domain}", service: { compose_service: "web", port: 5173 } }],
      },
    }),
    "utf8",
  );

  const oldCwd = process.cwd();
  process.chdir(tmp);
  try {
    const cfg = resolveManifest(manifestPath);
    assert.equal(cfg.domain, "ingress.test");
    assert.equal(cfg.routes[0].host, "app-demo.ingress.test");
  } finally {
    process.chdir(oldCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("resolveManifest supports slug from manifest when not auto", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ingressctl-test-"));
  const manifestPath = path.join(tmp, "m.json");
  const stackDir = path.join(tmp, "stack");
  await fsp.mkdir(stackDir, { recursive: true });
  await fsp.writeFile(path.join(stackDir, "compose.yml"), "services: {}\n", "utf8");
  await fsp.writeFile(
    manifestPath,
    JSON.stringify({
      name: "demo",
      stack: {
        slug: "My Branch",
        compose: { workdir: "./stack", files: ["compose.yml"] },
        routes: [{ host: "app-{slug}.localhost", service: { compose_service: "web", port: 5173 } }],
      },
    }),
    "utf8",
  );

  const oldCwd = process.cwd();
  process.chdir(tmp);
  try {
    const cfg = resolveManifest(manifestPath);
    assert.equal(cfg.slug, "my-branch");
    assert.equal(cfg.routes[0].host, "app-my-branch.localhost");
  } finally {
    process.chdir(oldCwd);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});


test("capture returns empty string when command spawn fails", () => {
  const out = capture("definitely-not-a-real-command", ["arg"]);
  assert.equal(out, "");
});

test("run exits non-zero with explicit message when command spawn fails", () => {
  const script = `import { run } from "./bin/ingressctl-lib.mjs"; run("definitely-not-a-real-command", ["arg"]);`;
  const res = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Failed to run command: definitely-not-a-real-command arg/);
});

test("stack migrate resolves service and command from stack.actions.migrate", async () => {
  const h = await makeStackHarness();
  try {
    await h.writeManifest({
      migrate: {
        service: "api-service",
        command: "echo migrate-default",
      },
    });

    const res = runIngressctlStack(
      ["migrate", "--manifest", h.manifestPath],
      {
        PATH: `${h.fakeBinDir}:${process.env.PATH}`,
        FAKE_DOCKER_LOG: h.logPath,
      },
    );
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const log = await fsp.readFile(h.logPath, "utf8");
    assert.match(log, /ARG:compose/);
    assert.match(log, /ARG:exec/);
    assert.match(log, /ARG:-T/);
    assert.match(log, /ARG:api-service/);
    assert.match(log, /ARG:bash/);
    assert.match(log, /ARG:-lc/);
    assert.match(log, /ARG:echo migrate-default/);
  } finally {
    await fsp.rm(h.tmp, { recursive: true, force: true });
  }
});

test("stack migrate accepts --migrate-service override", async () => {
  const h = await makeStackHarness();
  try {
    await h.writeManifest({
      migrate: {
        service: "api-default",
        command: "echo migrate-override",
      },
    });

    const res = runIngressctlStack(
      ["migrate", "--manifest", h.manifestPath, "--migrate-service", "api-override"],
      {
        PATH: `${h.fakeBinDir}:${process.env.PATH}`,
        FAKE_DOCKER_LOG: h.logPath,
      },
    );
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const log = await fsp.readFile(h.logPath, "utf8");
    assert.match(log, /ARG:api-override/);
    assert.doesNotMatch(log, /ARG:api-default/);
  } finally {
    await fsp.rm(h.tmp, { recursive: true, force: true });
  }
});

test("stack seed resolves service and command from stack.actions.seed", async () => {
  const h = await makeStackHarness();
  try {
    await h.writeManifest({
      seed: {
        service: "seed-service",
        command: "echo seed-default",
      },
    });

    const res = runIngressctlStack(
      ["seed", "--manifest", h.manifestPath],
      {
        PATH: `${h.fakeBinDir}:${process.env.PATH}`,
        FAKE_DOCKER_LOG: h.logPath,
      },
    );
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const log = await fsp.readFile(h.logPath, "utf8");
    assert.match(log, /ARG:seed-service/);
    assert.match(log, /ARG:echo seed-default/);
  } finally {
    await fsp.rm(h.tmp, { recursive: true, force: true });
  }
});

test("stack migrate fails when stack.actions.migrate.service is missing", async () => {
  const h = await makeStackHarness();
  try {
    await h.writeManifest({
      migrate: {
        command: "echo migrate-without-service",
      },
    });

    const res = runIngressctlStack(
      ["migrate", "--manifest", h.manifestPath],
      {
        PATH: `${h.fakeBinDir}:${process.env.PATH}`,
        FAKE_DOCKER_LOG: h.logPath,
      },
    );
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /stack\.actions\.migrate\.service is not configured/);
  } finally {
    await fsp.rm(h.tmp, { recursive: true, force: true });
  }
});
