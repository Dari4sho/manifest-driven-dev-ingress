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
  renderManifestEnv,
  buildRouteConfigYaml,
  composeArgs,
  capture,
} from "../bin/ingressctl-lib.mjs";

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
    name: "Demo Local",
    slug: "auto",
    compose: {
      workdir: "../stack",
      files: ["compose.yml", "compose.dev.yml"],
      project_name_template: "proj-{slug}",
    },
    env: {
      API_BASE_URL: "http://{route.api.host}{http_port_suffix}",
    },
    routes: [
      {
        name: "app web",
        host: "app-{slug}.localhost",
        service: { compose_service: "frontend", port: 3000 },
      },
      {
        name: "api",
        host: "api-{slug}.localhost",
        service: { compose_service: "api", port: 8000 },
      },
      {
        name: "admin",
        host: "admin-{project}.localhost",
        service: { url: "http://internal-{project}:9000" },
      },
    ],
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
      slug: "My Branch",
      compose: { workdir: "./stack", files: ["compose.yml"] },
      routes: [{ host: "app-{slug}.localhost", service: { compose_service: "web", port: 5173 } }],
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
