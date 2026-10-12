import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.TSB_BROWSER_PORT ?? '4271')
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('TSB_BROWSER_PORT must be an integer between 1024 and 65535')
}
const root = import.meta.dirname
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: `${root}/tests/e2e`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } }],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    cwd: root,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
