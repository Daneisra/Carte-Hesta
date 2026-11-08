const { test, expect, loginAsSyntheticAdmin } = require('../support/playwright.cjs');
const { observeHomeConfig } = require('../support/homeConfigDiagnostics.cjs');
const { formatAdminSiteConfigChangelog } = require('../../js/ui/adminHome.js');

// Observe the promise of the existing panel method, on both old and corrected code.
// Network completion alone precedes response.json(), rendering and the method's finally block.
async function observeReloadCompletion(page) {
    await page.evaluate(async () => {
        const { HomeAdminPanel } = await import('/js/ui/homeAdminPanel.js');
        const original = HomeAdminPanel.prototype.fetchAdminSiteConfig;
        window.__homeReloadsCompleted = 0;
        HomeAdminPanel.prototype.fetchAdminSiteConfig = async function (...args) {
            try { return await original.apply(this, args); }
            finally { window.__homeReloadsCompleted += 1; }
        };
    });
    return () => expect.poll(() => page.evaluate(() => window.__homeReloadsCompleted)).toBe(1);
}

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

test('un rechargement en vol ne remplace pas une saisie administrateur plus récente', async ({ page }, testInfo) => {
    await loginAsSyntheticAdmin(page);
    const diagnostics = await observeHomeConfig(page, testInfo, { watchWrites: true });
    let release;
    const released = new Promise(resolve => { release = resolve; });
    try {
        const before = (await (await page.request.get('/api/admin/home-config')).json()).config;
        diagnostics.record('before-config', before);
        await page.goto('/');
        await page.locator('#home-admin-entry').click();
        const editor = page.locator('#admin-home-changelog');
        await expect(editor).toHaveValue(formatAdminSiteConfigChangelog(before.changelog));
        const reloadCompleted = await observeReloadCompletion(page);
        let entered;
        const started = new Promise(resolve => { entered = resolve; });
        await page.route('**/api/admin/home-config', async route => {
            if (route.request().method() !== 'GET') return route.fallback();
            entered();
            await released;
            await route.fulfill({ json: { status: 'ok', config: before } });
        });
        await page.locator('#admin-home-reload').click();
        await started;
        const draft = await editor.inputValue() + '\n2026-01-01 | ' + 'X'.repeat(201) + ' | Résumé synthétique';
        await editor.fill(draft);
        await diagnostics.snapshot('draft-before-release');
        const loaded = page.waitForResponse(response => response.url().endsWith('/api/admin/home-config') && response.request().method() === 'GET');
        release();
        await loaded;
        await reloadCompleted();
        await expect(editor).toHaveValue(draft);
        await expect(page.locator('#admin-home-status')).toContainText('modifications plus récentes');
        await diagnostics.snapshot('before-save');
        const sent = page.waitForRequest(request => request.url() === new URL('/api/admin/home-config', page.url()).href && request.method() === 'PATCH');
        await page.locator('#admin-home-save').click();
        const request = await sent;
        expect(request.postDataJSON().config.changelog.at(-1)).toEqual({ date: '2026-01-01', title: 'X'.repeat(201), summary: 'Résumé synthétique' });
        const response = await request.response();
        expect(response.request()).toBe(request);
        expect(response.status()).toBe(400);
        expect((await response.json()).code).toBe('E_CHANGELOG_TITLE_TOO_LONG');
        await expect(editor).toHaveValue(draft);
        expect((await (await page.request.get('/api/admin/home-config')).json()).config.changelog).toEqual(before.changelog);
    } finally { release(); await diagnostics.finish(); }
});

for (const whileSaving of [false, true]) {
    test(whileSaving
        ? 'une lecture tardive conserve le statut de sauvegarde en cours'
        : 'une lecture tardive conserve le message de sauvegarde HTTP 400', async ({ page }, testInfo) => {
        await loginAsSyntheticAdmin(page);
        const diagnostics = await observeHomeConfig(page, testInfo);
        const getStarted = deferred(), releaseGet = deferred();
        const patchStarted = deferred(), releasePatch = deferred();
        try {
            const before = (await (await page.request.get('/api/admin/home-config')).json()).config;
            diagnostics.record('before-config', before);
            await page.goto('/');
            await page.locator('#home-admin-entry').click();
            const editor = page.locator('#admin-home-changelog');
            await expect(editor).toHaveValue(formatAdminSiteConfigChangelog(before.changelog));
            const reloadCompleted = await observeReloadCompletion(page);
            await page.route('**/api/admin/home-config', async route => {
                if (route.request().method() === 'GET') {
                    getStarted.resolve();
                    await releaseGet.promise;
                    return route.fulfill({ json: { status: 'ok', config: before } });
                }
                if (route.request().method() === 'PATCH' && whileSaving) {
                    patchStarted.resolve();
                    await releasePatch.promise;
                }
                return route.fallback();
            });
            await page.locator('#admin-home-reload').click();
            await getStarted.promise;
            const note = { date: '2026-01-01', title: whileSaving ? 'Note valide synthétique R2' : 'X'.repeat(201), summary: 'Résumé synthétique R2' };
            const draft = await editor.inputValue() + `\n${note.date} | ${note.title} | ${note.summary}`;
            await editor.fill(draft);
            await diagnostics.snapshot('before-save');
            const sent = page.waitForRequest(request => request.url() === new URL('/api/admin/home-config', page.url()).href && request.method() === 'PATCH');
            await page.locator('#admin-home-save').click();
            const request = await sent;
            expect(request.postDataJSON().config.changelog.at(-1)).toEqual(note);
            const status = page.locator('#admin-home-status');
            if (whileSaving) {
                await patchStarted.promise;
                await expect(status).toContainText('Enregistrement');
            } else {
                const response = await request.response();
                expect(response.request()).toBe(request);
                expect(response.status()).toBe(400);
                expect((await response.json()).code).toBe('E_CHANGELOG_TITLE_TOO_LONG');
                await expect(status).toContainText('dépasse 200 caractères');
                await expect(status).toHaveClass(/is-error/);
            }
            const saveStatus = await status.textContent();
            releaseGet.resolve();
            await reloadCompleted();
            await expect(editor).toHaveValue(draft);
            await expect(status).toHaveText(saveStatus);
            await diagnostics.snapshot('after-late-get');
            if (whileSaving) {
                await expect(page.locator('#admin-home-save')).toBeDisabled();
                const navigated = page.waitForEvent('domcontentloaded');
                releasePatch.resolve();
                expect((await request.response()).status()).toBe(200);
                await navigated;
                const after = (await (await page.request.get('/api/admin/home-config')).json()).config;
                expect(after.changelog).toContainEqual(note);
                for (const historical of before.changelog) expect(after.changelog).toContainEqual(historical);
            } else {
                await expect(status).toHaveClass(/is-error/);
                expect((await (await page.request.get('/api/admin/home-config')).json()).config).toEqual(before);
            }
        } finally { releaseGet.resolve(); releasePatch.resolve(); await diagnostics.finish(); }
    });
}

test('un rechargement demandé après la saisie recharge la configuration enregistrée', async ({ page }, testInfo) => {
    await loginAsSyntheticAdmin(page);
    const diagnostics = await observeHomeConfig(page, testInfo);
    try {
        const before = (await (await page.request.get('/api/admin/home-config')).json()).config;
        diagnostics.record('before-config', before);
        await page.goto('/');
        await page.locator('#home-admin-entry').click();
        const editor = page.locator('#admin-home-changelog');
        const recorded = formatAdminSiteConfigChangelog(before.changelog);
        await expect(editor).toHaveValue(recorded);
        const reloadCompleted = await observeReloadCompletion(page);
        await editor.fill(recorded + '\n2026-01-01 | Brouillon non enregistré | Test R2');
        await page.locator('#admin-home-reload').click();
        await reloadCompleted();
        await expect(editor).toHaveValue(recorded);
        await expect(page.locator('#admin-home-status')).toContainText('chargee depuis');
        await expect(page.locator('#admin-home-save')).toBeEnabled();
        expect((await (await page.request.get('/api/admin/home-config')).json()).config).toEqual(before);
    } finally { await diagnostics.finish(); }
});
