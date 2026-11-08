const { test, expect, loginAsSyntheticAdmin } = require('../support/playwright.cjs');
const { representativeSiteConfig, correctedNote } = require('../fixtures/changelog.cjs');
const { version: APP_VERSION } = require('../../package.json');
const { CHANGELOG } = require('../../js/shared/changelog.mjs');
const { observeHomeConfig } = require('../support/homeConfigDiagnostics.cjs');
const { formatAdminSiteConfigChangelog } = require('../../js/ui/adminHome.js');

test.describe('Versioning et repli du changelog - UI', () => {
    test('le repli affiche uniquement la dernière correction de 0.17.48 et conserve les notes non numérotées', async ({ page }) => {
        const config = representativeSiteConfig();
        const corrected = correctedNote(config); config.changelog.push(corrected);
        await page.route('**/api/changelog**', route => route.fulfill({ status: 503, body: '' }));
        await page.route('**/assets/site-config.json', route => route.fulfill({ json: config }));
        await page.goto('/changelog/');
        await expect(page.locator('.changelog-entry')).toHaveCount(51);
        const variant = page.locator('.changelog-entry').filter({ hasText: 'Version 0.17.48' });
        await expect(variant).toHaveCount(1);
        await expect(variant).toContainText(corrected.summary);
        await expect(page.locator('#changelog-list')).toContainText('Archive synthétique C sans titre');
        await page.goto('/');
        await expect(page.locator('.home-changelog-item').filter({ hasText: 'Version 0.17.48' })).toHaveCount(1);
        await expect(page.locator('#home-changelog-list')).toContainText(corrected.summary);
    });

    test('l’administration montre le rejet explicite des nouveaux textes trop longs sans sauvegarder', async ({ page }, testInfo) => {
        await loginAsSyntheticAdmin(page);
        const diagnostics = await observeHomeConfig(page, testInfo);
        try {
            const before = (await (await page.request.get('/api/admin/home-config')).json()).config;
            diagnostics.record('before-config', before);
            await page.goto('/');
            await page.locator('#home-admin-entry').click();
            const editor = page.locator('#admin-home-changelog');
            await expect(editor).toHaveValue(formatAdminSiteConfigChangelog(before.changelog));
            const note = { date: '2026-01-01', title: 'X'.repeat(201), summary: 'Résumé synthétique' };
            const draft = await editor.inputValue() + `\n${note.date} | ${note.title} | ${note.summary}`;
            await editor.fill(draft);
            await expect(editor).toHaveValue(draft);
            await diagnostics.snapshot('before-save');
            const sent = page.waitForRequest(request => request.url() === new URL('/api/admin/home-config', page.url()).href && request.method() === 'PATCH');
            await page.locator('#admin-home-save').click();
            const request = await sent;
            expect(request.postDataJSON().config.changelog).toContainEqual(note);
            expect([...request.postDataJSON().config.changelog.at(-1).title]).toHaveLength(201);
            const response = await request.response();
            expect(response.request()).toBe(request);
            expect(response.status()).toBe(400);
            expect((await response.json()).code).toBe('E_CHANGELOG_TITLE_TOO_LONG');
            await expect(page.locator('#admin-home-status')).toContainText('dépasse 200 caractères');
            await expect(editor).toHaveValue(draft);
            expect((await (await page.request.get('/api/admin/home-config')).json()).config.changelog).toEqual(before.changelog);
        } finally { await diagnostics.finish(); }
    });

    for (const path of ['/', '/changelog/', '/planning/', '/geek-unchained/']) {
        test(`version du code sur ${path}, même sans API ni configuration`, async ({ page }) => {
            await page.route('**/assets/site-config.json', route => route.fulfill({ status: 503, body: 'Indisponible' }));
            await page.route('**/api/changelog**', route => route.fulfill({ status: 503, body: 'Indisponible' }));
            await page.goto(path);
            const versions = page.locator('[data-app-version]');
            expect(await versions.count()).toBeGreaterThan(0);
            for (const node of await versions.all()) await expect(node).toHaveText(APP_VERSION);
            await expect(page.locator('meta[name="application-version"]')).toHaveAttribute('content', APP_VERSION);
            if (path === '/changelog/') {
                await expect(page.locator('.changelog-entry')).toHaveCount(CHANGELOG.length);
                await expect(page.locator('#changelog-source')).toHaveText('Code');
                await expect(page.locator('.changelog-entry').first()).toContainText('Date à confirmer');
                await expect(page.locator('.changelog-entry').first()).toContainText('en préparation');
            }
            if (path === '/') {
                await expect(page.locator('.home-changelog-item')).toHaveCount(3);
                await expect(page.locator('.home-changelog-item').first()).toContainText(APP_VERSION);
                await expect(page.locator('#home-changelog-status')).toHaveText('Repli local');
            }
        });
    }

    test('repli sur une configuration ancienne sans laisser sa version remplacer celle du code', async ({ page }) => {
        await page.route('**/api/changelog**', route => route.fulfill({ status: 500, body: '' }));
        await page.route('**/assets/site-config.json', route => route.fulfill({ json: { version: '0.0.1', changelog: [{ date: '2026-01-01', title: 'Archive personnalisée', summary: 'Contenu conservé' }] } }));
        await page.goto('/changelog/');
        await expect(page.locator('#changelog-version')).toHaveText(APP_VERSION);
        await expect(page.locator('#changelog-version-footer')).toHaveText(APP_VERSION);
        await expect(page.locator('#changelog-list')).toContainText('Archive personnalisée');
        await expect(page.locator('#changelog-list')).toContainText(CHANGELOG[0].title);
        await expect(page.locator('#changelog-source')).toHaveText('Code + Config');
        await page.goto('/');
        await expect(page.locator('#home-version')).toHaveText(APP_VERSION);
        await expect(page.locator('.home-changelog-item').first()).toContainText(CHANGELOG[0].title);
    });

    test('réponse API incomplète et configuration vide déclenchent le repli canonique', async ({ page }) => {
        await page.route('**/api/changelog**', route => route.fulfill({ json: { status: 'ok', entries: [{}] } }));
        await page.route('**/assets/site-config.json', route => route.fulfill({ json: {} }));
        await page.goto('/changelog/');
        await expect(page.locator('.changelog-entry')).toHaveCount(CHANGELOG.length);
        await expect(page.locator('#changelog-status')).toContainText('repli local');
        await expect(page.locator('#changelog-version')).toHaveText(APP_VERSION);
        await page.goto('/');
        await expect(page.locator('.home-changelog-item')).toHaveCount(3);
        await expect(page.locator('#home-changelog-status')).toHaveText('Repli local');
    });

    test('la page complète charge les entrées après la première page de 50', async ({ page }) => {
        const entries = Array.from({ length: 73 }, (_, i) => ({ date: '2026-01-01', title: `Note paginée ${i}`, summary: 'Test complet' }));
        await page.route('**/api/changelog**', route => {
            const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
            const next = offset + 50;
            return route.fulfill({ json: { entries: entries.slice(offset, next), source: 'code+config', hasMore: next < entries.length, nextOffset: next < entries.length ? next : null } });
        });
        await page.goto('/changelog/');
        await expect(page.locator('.changelog-entry')).toHaveCount(73);
        await expect(page.locator('.changelog-entry').last()).toContainText('Note paginée 72');
        await expect(page.locator('#changelog-version')).toHaveText(APP_VERSION);
    });
});
