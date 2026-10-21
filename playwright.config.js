// @ts-check
const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');
const { verifySandbox } = require('./tests/support/sandbox.cjs');

const root = process.env.CARTE_TEST_ROOT;
const token = process.env.CARTE_TEST_TOKEN;
const origin = process.env.CARTE_TEST_ORIGIN;
if (!root || !token || !origin || !process.env.NODE_OPTIONS?.includes('processBoundary.cjs')) {
  throw new Error('Direct Playwright startup is disabled. Use npm run test:api or npm run test:ui.');
}
verifySandbox(root, token);
const url = new URL(origin);
if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || !url.port) throw new Error('Invalid isolated test origin');
const isCi = Boolean(process.env.CI);

module.exports = defineConfig({
  forbidOnly: isCi,
  maxFailures: process.env.CARTE_TEST_DEBUG === '1' ? 1 : 0,
  retries: isCi ? 1 : 0,
  // Sequential tests avoid existing shared-JSON races; each project gets a fresh app.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(root, 'results', 'artifacts'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(root, 'results', 'results.json') }],
    ['html', { outputFolder: path.join(root, 'results', 'html'), open: 'never' }],
    ['junit', { outputFile: path.join(root, 'results', 'junit.xml') }]
  ],
  use: {
    baseURL: origin, serviceWorkers: 'block',
    proxy: { server: process.env.CARTE_TEST_PROXY, bypass: '127.0.0.1' },
    trace: 'retain-on-failure', screenshot: 'only-on-failure', video: isCi ? 'retain-on-failure' : 'off',
    launchOptions: { args: ['--disable-background-networking', '--disable-component-update', '--disable-domain-reliability', '--no-pings', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] }
  },
  projects: [
    { name: 'api', testDir: 'tests/api' },
    { name: 'chromium', testDir: 'tests/ui', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testDir: 'tests/ui', use: {
      ...devices['Desktop Firefox'],
      launchOptions: {
        args: [],
        firefoxUserPrefs: {
          'media.peerconnection.enabled': false, 'toolkit.telemetry.enabled': false,
          // Keep MOZ_DISABLE_NONLOCAL_CONNECTIONS; stop the native updater at its source.
          'app.update.disabledForTesting': true, 'app.update.checkInstallTime': false
        }
      }
    } }
  ]
  // No webServer / reuseExistingServer: the controller verifies its new server's token and PID.
});
