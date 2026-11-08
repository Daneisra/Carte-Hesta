const { test, expect, loginAsSyntheticAdmin, installBrowserBoundary } = require('../support/playwright.cjs');
const { locations } = require('../fixtures/application.cjs');

test('le routage Playwright bloque les deux URL externes testées puis permet une navigation locale', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
        serviceWorkers: 'block',
        proxy: { server: process.env.CARTE_TEST_PROXY, bypass: '127.0.0.1' }
    });
    try {
        const denied = [];
        await installBrowserBoundary(context, baseURL, denied);
        const page = await context.newPage();
        const urls = ['https://aus5.mozilla.org/update/3/SystemAddons/synthetic/update.xml', 'https://example.invalid/synthetic'];
        for (const url of urls) await expect(page.goto(url)).rejects.toThrow();
        expect(denied).toEqual(urls);
        expect(browser.isConnected()).toBe(true);
        const response = await page.goto('/');
        expect(response.headers()['x-carte-test-run']).toBe(process.env.CARTE_TEST_TOKEN);
        expect(process.env.MOZ_DISABLE_NONLOCAL_CONNECTIONS).toBe('1');
    } finally { await context.close(); }
});

test('la carte utilise le processus isolé, les bibliothèques locales et un média synthétique valide', async ({ page }) => {
    await loginAsSyntheticAdmin(page);
    const response = await page.goto('/map/');
    expect(response.headers()['x-carte-test-run']).toBe(process.env.CARTE_TEST_TOKEN);
    await expect(page.locator('.location')).toHaveCount(Object.values(locations).flat().length);
    await expect.poll(() => page.locator('.leaflet-image-layer').evaluate(image => image.complete && image.naturalWidth)).toBe(160);
    expect(await page.evaluate(() => ({ leaflet: window.L.version, cluster: typeof window.L.markerClusterGroup, purifier: window.DOMPurify.version })))
        .toEqual({ leaflet: '1.9.4', cluster: 'function', purifier: '3.0.3' });
});

test('la carte anonyme ne reçoit que les champs explicitement publiés', async ({ page }) => {
    const response = await page.request.get('/assets/locations.json');
    expect(response.status()).toBe(200);
    const places = Object.values(await response.json()).flat();
    expect(places).toHaveLength(Object.values(locations).flat().length);
    for (const place of places) { expect(place.lore).toBeUndefined(); expect(place.pnjs).toBeUndefined(); }
    await page.goto('/map/');
    await expect(page.locator('.location')).toHaveCount(places.length);
});
