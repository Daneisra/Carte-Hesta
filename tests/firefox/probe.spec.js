const { instrument } = require('./instrumentation.cjs');
const probe = instrument();
if (process.env.CARTE_FIREFOX_CHANNEL_REF === 'on') process.channel?.ref();
const { test, expect } = require('../support/playwright.cjs');
for (let i = 0; i < Number(process.env.CARTE_FIREFOX_ATTEMPTS); i += 1) {
    test(`synthetic page ${i + 1}`, async ({ page, browser }) => {
        probe.observe(browser);
        await page.goto('/');
        await expect(page.locator('h1')).toHaveText('Firefox synthetic probe');
    });
}
