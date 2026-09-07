// @vitest-environment node

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

function text(relativePath: string) {
  const target = path.join(root, relativePath);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
}

function json(relativePath: string) {
  const value = text(relativePath);
  return value ? JSON.parse(value) : {};
}

// @spec SEC-API-001, SEC-API-002
describe("deployed security headers", () => {
  it("defines the restrictive CSP and global browser protections", () => {
    const config = text("next.config.ts");
    expect(config).toContain("Content-Security-Policy");
    expect(config).toContain("default-src 'self'");
    expect(config).toContain("X-Frame-Options");
    expect(config).toContain("DENY");
    expect(config).toContain("X-Content-Type-Options");
    expect(config).toContain("nosniff");
    expect(config).toContain("Referrer-Policy");
    expect(config).toContain("no-referrer");
    expect(config).toContain("Permissions-Policy");
  });
});

// @spec SEC-UI-001
it("contains no analytics or remote browser scripts", () => {
  const appFiles = fs.existsSync(path.join(root, "app"))
    ? fs.readdirSync(path.join(root, "app"), { recursive: true })
    : [];
  const source = appFiles
    .filter((file) => typeof file === "string" && /\.(tsx?|jsx?)$/.test(file))
    .map((file) => text(path.join("app", String(file))))
    .join("\n");
  expect(source).not.toMatch(
    /google-analytics|gtag|segment|mixpanel|<script[^>]+src=/i,
  );
});

// @spec PWA-PROC-001
it("defines an installable application manifest", () => {
  const manifest = text("app/manifest.ts");
  expect(manifest).toContain('display: "standalone"');
  expect(manifest).toContain("start_url");
  expect(manifest).toContain("192x192");
  expect(manifest).toContain("512x512");
});

// @spec PWA-PROC-002, PWA-PROC-003, PWA-PROC-004
it("defines safe service-worker runtime caching", () => {
  const worker = text("app/sw.ts");
  expect(worker).toContain("CacheFirst");
  expect(worker).toContain("NetworkFirst");
  expect(worker).toContain("/api/conditions");
  expect(worker).not.toMatch(
    /\/api\/trip.*(?:CacheFirst|NetworkFirst|StaleWhileRevalidate)/s,
  );
  expect(worker).not.toMatch(
    /\/api\/actions.*(?:CacheFirst|NetworkFirst|StaleWhileRevalidate)/s,
  );
});

// @spec PWA-UI-006
it("does not force service-worker activation over dirty forms", () => {
  const registration = text("lib/offline/register-service-worker.ts");
  expect(registration).toContain("isFormDirty");
  expect(registration).not.toContain("skipWaiting()");
});

// @spec PWA-PROC-007
it("removes stale service workers instead of caching the app in development", () => {
  const registration = text("lib/offline/register-service-worker.ts");

  expect(registration).toContain('process.env.NODE_ENV !== "production"');
  expect(registration).toContain("navigator.serviceWorker.getRegistrations()");
  expect(registration).toContain("registration.unregister()");
  expect(registration).toContain("window.location.reload()");
  expect(registration).toContain(
    'navigator.serviceWorker.register("/sw-prod.js")',
  );
  expect(registration).toContain('caches.open("public-v1")');
});

// @spec OPS-PROC-001
it("requires a supported Pixi release", () => {
  expect(text("pyproject.toml")).toContain('requires-pixi = ">=0.69,<1"');
});

// @spec OPS-PROC-002
it("exposes the approved Pixi task surface", () => {
  const config = text("pyproject.toml");
  for (const task of [
    "install-web",
    "dev",
    "format-web",
    "lint-web",
    "typecheck",
    "test-python",
    "test-web",
    "test-e2e",
    "build",
    "deploy-preview",
  ]) {
    expect(config).toContain(task);
  }
});

// @spec OPS-PROC-003, OPS-PROC-004
it("locks web dependencies and pins the Vercel Node runtime", () => {
  expect(fs.existsSync(path.join(root, "package-lock.json"))).toBe(true);
  expect(json("package.json").engines).toEqual({ node: "24.x" });
  expect(json("package.json").scripts.build).toBeTruthy();
});

// @spec OPS-PROC-005
it("keeps storage credentials server-only and fails closed in production", () => {
  const config = text("lib/trips/repository.ts");
  expect(config).toContain("UPSTASH_REDIS_REST_URL");
  expect(config).toContain("UPSTASH_REDIS_REST_TOKEN");
  expect(config).toContain('NODE_ENV === "production"');
  expect(text("package.json")).not.toContain("NEXT_PUBLIC_UPSTASH");
});

// @spec OPS-PROC-006, OPS-PROC-007
it("separates preview deployment from explicitly approved production", () => {
  const pixi = text("pyproject.toml");
  expect(pixi).toMatch(/deploy-preview[^\n]*vercel[^\n]*--no-wait/);
  expect(pixi).not.toMatch(/deploy-preview[^\n]*--prod/);
  expect(pixi).not.toContain("deploy-production");
});

// @spec OPS-PROC-008
it("defines the complete preview acceptance gate", () => {
  const packageScripts = json("package.json").scripts ?? {};
  expect(packageScripts).toEqual(
    expect.objectContaining({
      format: expect.any(String),
      lint: expect.any(String),
      typecheck: expect.any(String),
      test: expect.any(String),
      "test:e2e": expect.any(String),
      build: expect.any(String),
    }),
  );
  expect(text("pyproject.toml")).toContain("test-python");
});
