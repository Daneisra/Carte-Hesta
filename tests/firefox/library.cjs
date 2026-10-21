const assert = require('node:assert/strict');
const { instrument } = require('./instrumentation.cjs');
const probe = instrument();
const { firefox } = require('playwright');
const { installBrowserBoundary } = require('../support/playwright.cjs');

async function main() {
    const result = { mode: 'library', attempts: [], pid: process.pid, ipc: Boolean(process.send) };
    if (process.env.CARTE_FIREFOX_CHANNEL_REF === 'on') process.channel?.ref();
    let browser;
    try {
        browser = await firefox.launch({
            headless: true, args: [],
            firefoxUserPrefs: {
                'media.peerconnection.enabled': false, 'toolkit.telemetry.enabled': false,
                'app.update.disabledForTesting': true, 'app.update.checkInstallTime': false
            }
        });
        probe.observe(browser);
        for (let i = 0; i < Number(process.env.CARTE_FIREFOX_ATTEMPTS); i += 1) {
            let context;
            const entry = { index: i + 1 };
            try {
                probe.record('explicit-context-create', { index: i + 1 });
                context = await browser.newContext({
                    viewport: { width: 1280, height: 720 }, serviceWorkers: 'block',
                    proxy: { server: process.env.CARTE_TEST_PROXY, bypass: '127.0.0.1' }
                });
                context.on('close', () => probe.record('context-close', { index: i + 1 }));
                const denied = [];
                await installBrowserBoundary(context, process.env.CARTE_TEST_ORIGIN, denied);
                const page = await context.newPage();
                page.on('close', () => probe.record('page-close', { index: i + 1 }));
                page.on('crash', () => probe.record('page-crash', { index: i + 1 }));
                await page.goto(process.env.CARTE_TEST_ORIGIN);
                assert.equal(await page.locator('h1').textContent(), 'Firefox synthetic probe');
                assert.deepEqual(denied, []);
                entry.status = 'passed';
                probe.record('explicit-page-close', { index: i + 1 });
                await page.close({ runBeforeUnload: false });
            } catch (error) { entry.status = 'failed'; entry.error = error.stack; }
            finally {
                if (context) { probe.record('explicit-context-close', { index: i + 1 }); await context.close(); }
                result.attempts.push(entry);
            }
        }
    } finally {
        if (browser) { probe.record('explicit-browser-close'); await browser.close(); result.browserDisconnected = !browser.isConnected(); }
        process.channel?.unref();
        require('node:fs').writeFileSync(require('node:path').join(process.env.CARTE_TEST_ROOT, 'results', 'library.json'), JSON.stringify(result, null, 2));
    }
    const passed = result.attempts.filter(entry => entry.status === 'passed').length;
    console.log(`[firefox-probe] ${passed}/${result.attempts.length}, IPC=${result.ipc}`);
    process.channel?.unref();
    process.exitCode = passed === result.attempts.length ? 0 : 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
