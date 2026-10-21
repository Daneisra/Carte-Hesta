const { test, expect, loginAsSyntheticAdmin } = require('../support/playwright.cjs');
const { locations } = require('../fixtures/application.cjs');

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
