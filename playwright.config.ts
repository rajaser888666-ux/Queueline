import { defineConfig } from "@playwright/test";

const baseURL = process.env.QL_BASE_URL || "http://localhost:3300";

// Remote deployments from this sandbox go through an authenticating proxy; Chromium needs the credentials explicitly.
function proxyFromEnv() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!raw || baseURL.includes("localhost")) return undefined;
  const u = new URL(raw);
  return {
    server: `${u.protocol}//${u.host}`,
    username: decodeURIComponent(u.username) || undefined,
    password: decodeURIComponent(u.password) || undefined,
    bypass: "localhost,127.0.0.1",
  };
}

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: process.env.QL_OUT || "test-results/artifacts",
  use: {
    baseURL,
    proxy: proxyFromEnv(),
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] },
    acceptDownloads: true,
    viewport: { width: 1280, height: 860 },
  },
});
