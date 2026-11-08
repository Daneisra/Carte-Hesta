const { test, expect } = require('../support/playwright.cjs');
const { version: APP_VERSION } = require('../../package.json');
const { CHANGELOG } = require('../../js/shared/changelog.mjs');
const adminHeaders = { Authorization: 'Bearer synthetic-admin-token' };

test.describe('Changelog - API et administration', () => {
    test('version du code et notes canoniques malgré une ancienne configuration', async ({ request }) => {
        const config = await (await request.get('/assets/site-config.json')).json();
        expect(config.version).toBe(APP_VERSION);
        expect(config.changelog[0].title).toBe(CHANGELOG[0].title);
        expect(config.changelog.some(entry => entry.title === 'Changement synthétique A')).toBeTruthy();
        const response = await request.get('/api/changelog');
        expect(response.status()).toBe(200);
        const payload = await response.json();
        expect(payload.version).toBe(APP_VERSION);
        expect(payload.source).toBe('code+config');
        expect(payload.entries).toHaveLength(6);
        expect(payload.total).toBe(config.changelog.length);
        expect(payload.hasMore).toBe(true);
        expect(payload.nextOffset).toBe(6);
        expect((await request.post('/api/changelog')).status()).toBe(405);
        expect((await request.get('/api/admin/site-config')).status()).toBe(401);
    });

    test('limites bornées, valeurs invalides et lecture paginée complète', async ({ request }) => {
        const config = await (await request.get('/assets/site-config.json')).json();
        for (const [value, expected] of [['1', 1], ['3', 3], ['12', 12], ['50', 50], ['100', 50], ['-2', 1], ['0', 6], ['oops', 6], ['Infinity', 6], ['2.8', 2]]) {
            const response = await request.get('/api/changelog?limit=' + value);
            expect(response.status()).toBe(200);
            expect((await response.json()).entries).toHaveLength(Math.min(expected, config.changelog.length));
        }
        const entries = [];
        let offset = 0;
        do {
            const page = await (await request.get(`/api/changelog?limit=12&offset=${offset}`)).json();
            entries.push(...page.entries);
            if (!page.hasMore) break;
            expect(page.nextOffset).toBeGreaterThan(offset);
            offset = page.nextOffset;
        } while (true);
        expect(entries).toEqual(config.changelog);
        expect((await (await request.get('/api/changelog?offset=999999')).json()).entries).toEqual([]);
        expect((await (await request.get('/api/changelog?limit=1&offset=-2')).json()).entries).toEqual(config.changelog.slice(0, 1));
    });

    test('sauvegarde administrateur additive au-delà de 50 notes et PATCH partiel compatible', async ({ request }) => {
        const before = await (await request.get('/api/admin/home-config', { headers: adminHeaders })).json();
        const history = Array.from({ length: 65 }, (_, i) => ({ date: '2026-01-01', title: `Archive de validation ${i}`, summary: 'Texte éditorial '.repeat(40).trim() }));
        const save = await request.put('/api/admin/home-config', { headers: adminHeaders, data: { config: { ...before.config, changelog: history, version: '999.0.0' } } });
        expect(save.status()).toBe(200);
        const saved = (await save.json()).config;
        expect(saved.version).toBe(APP_VERSION);
        for (const entry of [...before.config.changelog, ...history]) expect(saved.changelog).toContainEqual(entry);
        const patch = await request.patch('/api/admin/site-config', { headers: adminHeaders, data: { legal: { footerNote: 'Note synthétique temporaire' }, changelog: [] } });
        expect(patch.status()).toBe(200);
        const after = (await patch.json()).config;
        expect(after.home).toEqual(before.config.home);
        expect(after.changelog).toEqual(saved.changelog);
        const publicNotes = (await (await request.get('/assets/site-config.json')).json()).changelog;
        expect(publicNotes.length).toBeGreaterThan(65);
        for (const entry of history) expect(publicNotes).toContainEqual(entry);
        // Restaurer le champ éditorial du laboratoire ; les archives de test restent additives.
        expect((await request.patch('/api/admin/site-config', { headers: adminHeaders, data: { legal: before.config.legal } })).status()).toBe(200);
    });
});
