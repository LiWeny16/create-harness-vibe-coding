import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '..', '..');
const port = Number(process.env.WF_UI_E2E_PORT || 43173);
const token = process.env.WF_UI_E2E_TOKEN || 'playwright-m1-red';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 960 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/start-wf-ui-server.mjs',
    cwd: configDir,
    env: {
      WF_UI_E2E_PORT: String(port),
      WF_UI_E2E_TOKEN: token,
      WF_UI_E2E_PROJECT_ROOT: repoRoot,
    },
    url: `http://127.0.0.1:${port}/api/health?token=${encodeURIComponent(token)}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
