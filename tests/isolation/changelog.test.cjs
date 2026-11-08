const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createSandbox, removeSandbox } = require('../support/sandbox.cjs');
const { startIsolatedServer } = require('../../tools/devServerWithStub');
const { siteConfig } = require('../fixtures/application.cjs');
const { version } = require('../../package.json');
const { CHANGELOG } = require('../../js/shared/changelog.mjs');
const { entryVersion } = require('../../js/shared/changelogData.mjs');
const { representativeSiteConfig, correctedNote } = require('../fixtures/changelog.cjs');
const request = (app, url, body, admin = false) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: '127.0.0.1', port: app.port, path: url, method: bytes ? 'PATCH' : 'GET', agent: false,
        headers: { ...(bytes || admin ? { Authorization: 'Bearer synthetic-admin-token' } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}) } }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }));
    });
    req.setTimeout(8000, () => req.destroy(Error('Synthetic HTTP deadline'))); req.on('error', reject); req.end(bytes);
});
async function lab(prepare, run) {
    const sandbox = createSandbox(); let app;
    const configFile = path.join(sandbox.data, 'content', 'site-config.json');
    try { prepare(configFile, sandbox); app = await startIsolatedServer(sandbox); await run(app, configFile, sandbox); }
    finally { await app?.stop(); removeSandbox(sandbox.root, sandbox.token); }
}

test('public and admin reads never persist, truncate or replace a legacy editorial history', async () => {
    const history = Array.from({ length: 80 }, (_, i) => ({ date: '2026-01-01', title: `Archive ${i}`, summary: 'Texte intégral '.repeat(100), editorial: { privateMetadata: true } }));
    const original = { ...siteConfig, home: { ...siteConfig.home, retained: 'champ inconnu' }, theme: { custom: true }, changelog: history };
    await lab(file => fs.writeFileSync(file, JSON.stringify(original)), async (app, file) => {
        const before = fs.readFileSync(file);
        for (const url of ['/assets/site-config.json', '/api/changelog?limit=50', '/api/changelog?limit=50&offset=50']) {
            const response = await request(app, url); assert.equal(response.status, 200);
            assert.equal(response.json().version, version);
            assert(!response.text.includes('privateMetadata'));
            assert.deepEqual(fs.readFileSync(file), before);
        }
        const save = await request(app, '/api/admin/home-config', { home: { title: 'Titre changé' }, changelog: [] });
        assert.equal(save.status, 200);
        const after = JSON.parse(fs.readFileSync(file));
        assert.deepEqual(after.changelog, history);
        assert.deepEqual(after.theme, original.theme);
        assert.equal(after.home.retained, original.home.retained);
        assert.equal(after.version, original.version);
        assert.equal(after.home.title, 'Titre changé');
    });
});

test('empty legacy configuration still serves code version and complete canonical history', async () => {
    await lab(file => fs.writeFileSync(file, '{}'), async app => {
        const config = (await request(app, '/assets/site-config.json')).json();
        assert.equal(config.version, version); assert.equal(config.changelog.length, CHANGELOG.length);
        const response = await request(app, '/api/admin/home-config', { home: { title: 'Premier titre' } });
        assert.equal(response.status, 200); assert.equal(response.json().config.version, version);
        assert.deepEqual(response.json().config.changelog, []);
    });
});

test('missing persistent config at runtime never resets it; public code artifact stays available', async () => {
    await lab(() => {}, async (app, file) => {
        fs.unlinkSync(file); // Only this newly created synthetic sandbox.
        assert.equal((await request(app, '/api/changelog')).status, 500);
        assert.equal((await request(app, '/assets/site-config.json')).status, 500);
        assert.equal(fs.existsSync(file), false);
        const html = await request(app, '/changelog/');
        assert.equal(html.status, 200); assert(html.text.includes(`data-app-version>${version}<`));
        assert.equal(fs.existsSync(file), false);
    });
});

test('representative synthetic history survives public/admin reads, unchanged save and correction of 0.17.48', async () => {
    const original = representativeSiteConfig();
    await lab(file => fs.writeFileSync(file, JSON.stringify(original)), async (app, file) => {
        const readPublic = async () => {
            const entries = []; let offset = 0;
            do {
                const response = await request(app, `/api/changelog?limit=50&offset=${offset}`);
                assert.equal(response.status, 200);
                const payload = response.json(); entries.push(...payload.entries);
                if (!payload.hasMore) return entries;
                assert(payload.nextOffset > offset); offset = payload.nextOffset;
            } while (true);
        };
        const readAdmin = async () => {
            const response = await request(app, '/api/admin/home-config', undefined, true);
            assert.equal(response.status, 200); return response.json().config;
        };
        const before = fs.readFileSync(file);
        const firstPublic = await readPublic();
        assert.equal(firstPublic.length, 51);
        assert.equal(firstPublic.filter(entry => !entryVersion(entry)).length, 3);
        for (const entry of original.changelog) assert(firstPublic.some(visible => visible.title === entry.title && visible.summary === entry.summary && visible.date === entry.date));
        assert.deepEqual(firstPublic[0], { date: CHANGELOG[0].date, title: CHANGELOG[0].title, summary: CHANGELOG[0].summary });
        const admin = await readAdmin();
        assert.deepEqual(admin.changelog, original.changelog);
        assert.deepEqual(fs.readFileSync(file), before);
        const unchanged = await request(app, '/api/admin/home-config', { config: admin });
        assert.equal(unchanged.status, 200);
        assert.deepEqual(JSON.parse(fs.readFileSync(file)).changelog, original.changelog);
        assert.deepEqual(await readPublic(), firstPublic);
        const corrected = correctedNote(original);
        const edit = await request(app, '/api/admin/home-config', { config: { ...admin, changelog: admin.changelog.map(entry => entryVersion(entry) === '0.17.48' ? corrected : entry) } });
        assert.equal(edit.status, 200);
        const stored = JSON.parse(fs.readFileSync(file));
        assert.equal(stored.changelog.length, 51);
        assert.deepEqual(stored.changelog.slice(0, 50), original.changelog);
        assert.deepEqual(stored.changelog.at(-1), corrected);
        assert.equal(stored.home.retained, original.home.retained);
        const nextPublic = await readPublic();
        assert.equal(nextPublic.length, firstPublic.length);
        assert.deepEqual(nextPublic.filter(entry => entryVersion(entry) === '0.17.48'), [corrected]);
        assert.equal(nextPublic.filter(entry => !entryVersion(entry)).length, 3);
        const adminAfter = await readAdmin();
        assert.deepEqual(adminAfter.changelog, stored.changelog);
        assert.equal((await request(app, '/api/admin/home-config', { config: adminAfter })).status, 200);
        assert.deepEqual(JSON.parse(fs.readFileSync(file)).changelog, stored.changelog);
        assert.deepEqual(await readPublic(), nextPublic);
    });
});

test('new text bounds reject the entire transaction with explicit HTTP 400 and leave legacy long notes intact', async () => {
    const original = representativeSiteConfig();
    await lab(file => fs.writeFileSync(file, JSON.stringify(original)), async (app, file) => {
        const before = fs.readFileSync(file);
        const title200 = 'é'.repeat(200), summary4000 = '🙂'.repeat(4000);
        for (const [entry, code] of [
            [{ title: title200 + 'é', summary: 'Valide' }, 'E_CHANGELOG_TITLE_TOO_LONG'],
            [{ title: 'Valide', summary: summary4000 + '🙂' }, 'E_CHANGELOG_SUMMARY_TOO_LONG'],
            [{ ...original.changelog[2], summary: original.changelog[2].summary + 'Édition' }, 'E_CHANGELOG_SUMMARY_TOO_LONG']
        ]) {
            const response = await request(app, '/api/admin/site-config', { home: { title: 'Ne doit pas être sauvegardé' }, changelog: [entry] });
            assert.equal(response.status, 400); assert.equal(response.json().code, code);
            assert(response.json().message.includes(code.includes('TITLE') ? '200' : '4 000'));
            assert.deepEqual(fs.readFileSync(file), before);
        }
        const atLimit = { date: '2026-01-04', title: title200, summary: summary4000 };
        assert.equal((await request(app, '/api/admin/site-config', { changelog: [...original.changelog, atLimit] })).status, 200);
        const saved = JSON.parse(fs.readFileSync(file)).changelog;
        assert.deepEqual(saved.slice(0, 50), original.changelog);
        assert.deepEqual(saved.at(-1), atLimit);
    });
});

test('real media routes respect reordered/filtered changelog provenance and all private references', async () => {
    const names = ['old', 'current', 'shared', 'private-field', 'public'];
    const media = name => `/assets/images/changelog-${name}.png`;
    const config = { changelog: [
        { date: '2026-01-01', title: 'Version 0.17.48 - Ancienne synthétique', summary: `${media('old')} ${media('shared')}` },
        { date: '2026-01-02', title: 'Archive non numérotée', summary: media('public'), privateNote: media('private-field') },
        { date: '2026-01-01', title: 'Version 0.17.48 - Correction synthétique', summary: `${media('current')} ${media('shared')}` }
    ] };
    await lab((file, sandbox) => {
        fs.writeFileSync(file, JSON.stringify(config));
        const { PNG } = require('../fixtures/application.cjs');
        const { metadata } = require('../../server/publication/files');
        const indexFile = path.join(sandbox.media, '.published-media.json');
        const index = JSON.parse(fs.readFileSync(indexFile));
        for (const name of names) {
            const relative = media(name).slice(1);
            fs.writeFileSync(path.join(sandbox.media, relative.slice(7)), PNG, { flag: 'wx' });
            index.entries[relative] = metadata(PNG, 'image/png');
        }
        fs.writeFileSync(indexFile, JSON.stringify(index));
    }, async app => {
        for (const name of names) {
            assert.equal((await request(app, media(name))).status, ['current', 'public'].includes(name) ? 200 : 404, name);
            assert.equal((await request(app, media(name), undefined, true)).status, 200, 'administrator:' + name);
        }
    });
});
