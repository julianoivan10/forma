import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a REAL local chain (Anvil + deployed contracts) and a production build.
 * Transactions are really mined; the test wallet is an injected EIP-1193 provider that forwards to Anvil.
 *   1. pnpm anvil            (separate terminal)
 *   2. pnpm deploy:local
 *   3. pnpm e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { NEXT_PUBLIC_ENABLE_ANVIL: "true", NEXT_PUBLIC_APP_ENV: "development" },
  },
});
