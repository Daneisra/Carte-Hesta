const fs = require('node:fs');
const path = require('node:path');
const { test: base, expect } = require('@playwright/test');
const { PNG } = require('../fixtures/application.cjs');
const { verifySandbox, SOURCE_ROOT } = require('./sandbox.cjs');

const vendor = new Map([
    ['https://unpkg.com/leaflet/dist/leaflet.js', ['leaflet/dist/leaflet.js', 'application/javascript']],
    ['https://unpkg.com/leaflet/dist/leaflet.css', ['leaflet/dist/leaflet.css', 'text/css']],
    ['https://unpkg.com/leaflet.markercluster/dist/leaflet.markercluster.js', ['leaflet.markercluster/dist/leaflet.markercluster.js', 'application/javascript']],
    ['https://unpkg.com/leaflet.markercluster/dist/MarkerCluster.css', ['leaflet.markercluster/dist/MarkerCluster.css', 'text/css']],
    ['https://unpkg.com/leaflet.markercluster/dist/MarkerCluster.Default.css', ['leaflet.markercluster/dist/MarkerCluster.Default.css', 'text/css']],
    ['https://cdn.jsdelivr.net/npm/dompurify@3.0.3/dist/purify.min.js', ['dompurify/dist/purify.min.js', 'application/javascript']]
]);

async function installBrowserBoundary(context, origin, denied) {
    await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        // The OAuth stub produces only this synthetic default avatar. Never fetch a CDN.
        if (url.href === 'https://cdn.discordapp.com/embed/avatars/0.png') return route.fulfill({ contentType: 'image/png', body: PNG });
        const asset = vendor.get(url.href);
        if (asset) return route.fulfill({ contentType: asset[1], body: fs.readFileSync(path.join(SOURCE_ROOT, 'node_modules', asset[0])) });
        if ((url.hostname === 'unpkg.com' && url.pathname.startsWith('/leaflet/dist/images/')) || (url.hostname === 'img.youtube.com' && url.pathname.startsWith('/vi/'))) {
            return route.fulfill({ contentType: 'image/png', body: PNG });
        }
        if ((url.hostname === 'www.youtube.com' && url.pathname.startsWith('/embed/')) || (url.hostname === 'discord.com' && url.pathname === '/widget')) {
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Integration fictive</title><p>Contenu de test local</p>' });
        }
        denied.push(`${url.origin}${url.pathname}`);
        await route.abort('blockedbyclient');
    });
    await context.addInitScript(() => {
        window.WebSocket = class { constructor() { throw new Error('External sockets are disabled in tests'); } };
        window.RTCPeerConnection = class { constructor() { throw new Error('Peer connections are disabled in tests'); } };
    });
}

const test = base.extend({
    _isolation: [async ({ request, baseURL }, use) => {
        verifySandbox(process.env.CARTE_TEST_ROOT, process.env.CARTE_TEST_TOKEN);
        if (baseURL !== process.env.CARTE_TEST_ORIGIN) throw new Error('Unexpected test origin');
        const response = await request.get('/_test/identity');
        expect((await response.json()).token).toBe(process.env.CARTE_TEST_TOKEN);
        await use();
    }, { auto: true }],
    context: async ({ context, baseURL }, use) => {
        const denied = [];
        await installBrowserBoundary(context, baseURL, denied);
        try { await use(context); }
        finally {
            for (const page of context.pages()) {
                if (!page.isClosed()) await page.close({ runBeforeUnload: false });
            }
        }
        expect(denied, 'Unexpected external browser requests (blocked)').toEqual([]);
    }
});

async function loginAsSyntheticAdmin(page) {
    const response = await page.request.get('/auth/discord/login', { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    const state = new URL(response.headers().location).searchParams.get('state');
    expect((await page.request.get('/auth/discord/callback?code=synthetic-code&state=' + state, { maxRedirects: 0 })).status()).toBe(302);
}
module.exports = { test, expect, installBrowserBoundary, loginAsSyntheticAdmin };
