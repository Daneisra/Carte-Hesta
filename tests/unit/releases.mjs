import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CHANGELOG } from '../../js/shared/changelog.mjs';
import { mergeChangelog, normalizeEntries, entryVersion } from '../../js/shared/changelogData.mjs';
import { loadChangelog } from '../../js/shared/changelogClient.mjs';
import { APP_VERSION } from '../../js/shared/appVersion.mjs';
import { normalizeAdminSiteConfig, parseAdminChangelog, formatAdminSiteConfigChangelog, validateAdminSiteConfigDraft, fetchAdminSiteConfig, markAdminSiteConfigDirty, renderAdminSiteConfig, setAdminHomeStatus } from '../../js/ui/adminHome.js';
const require = createRequire(import.meta.url);
const { validateRelease } = require('../../tools/checkRelease');
const { applyConfigPatch, appendChangelog } = require('../../server/siteConfigHistory');
const { representativeSiteConfig, correctedNote, draftNote } = require('../fixtures/changelog.cjs');
const pkg = require('../../package.json'), lock = require('../../package-lock.json');
const reply = payload => ({ ok: true, json: async () => payload });
const fail = () => { throw Error('API indisponible'); };
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const editorContext = () => {
    const classes = new Set();
    const ctx = { isAdmin: () => true, adminSiteConfig: normalizeAdminSiteConfig(representativeSiteConfig()),
        adminSiteConfigSource: 'api', adminSiteConfigDirty: false, logTelemetryEvent() {},
        adminDom: { homeSaveButton: {}, homeChangelog: { value: '' }, homeStatus: { classList: {
            remove(name) { classes.delete(name); },
            toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
            contains(name) { return classes.has(name); }
        } } } };
    renderAdminSiteConfig(ctx);
    return ctx;
};
export const releaseTests = [
    { name: 'late reads preserve save error, pending and success statuses as well as the draft', async run() {
        const previousFetch = globalThis.fetch;
        try {
            for (const [pendingSave, message, editAfterRead] of [
                [false, 'HTTP 400 : titre trop long', true], [true, 'Enregistrement en cours', true], [false, 'Enregistrement réussi', true],
                [false, 'HTTP 400 : titre trop long', false], [true, 'Enregistrement en cours', false]
            ]) {
                const ctx = editorContext(), pending = deferred();
                globalThis.fetch = () => pending.promise;
                const edit = () => {
                    ctx.adminDom.homeChangelog.value = '2026-01-01 | Brouillon récent | Conservé';
                    markAdminSiteConfigDirty(ctx);
                };
                if (!editAfterRead) edit();
                const loading = fetchAdminSiteConfig(ctx);
                if (editAfterRead) edit();
                ctx.adminSiteConfigPending = pendingSave;
                setAdminHomeStatus(ctx, message, message.startsWith('HTTP 400'));
                pending.resolve(reply({ config: { changelog: [{ title: 'Ancienne lecture' }] } }));
                await loading;
                assert.equal(ctx.adminDom.homeChangelog.value, '2026-01-01 | Brouillon récent | Conservé');
                assert.equal(ctx.adminDom.homeStatus.textContent, message);
                assert.equal(ctx.adminSiteConfigPending, pendingSave);
                assert.equal(ctx.adminSiteConfigDirty, true);
                if (message.startsWith('HTTP 400')) assert(ctx.adminDom.homeStatus.classList.contains('is-error'));
            }
        } finally { globalThis.fetch = previousFetch; }
    } },
    { name: 'late admin reads preserve edits even after a save cleared the dirty flag', async run() {
        const previousFetch = globalThis.fetch;
        try {
            for (const [dirtyAfterEdit, readOk] of [[true, true], [false, true], [true, false]]) {
                const ctx = editorContext(), pending = deferred();
                const original = ctx.adminSiteConfig;
                globalThis.fetch = () => pending.promise;
                const loading = fetchAdminSiteConfig(ctx);
                const draft = ctx.adminDom.homeChangelog.value + '\n2026-01-01 | Saisie récente | Conservée';
                ctx.adminDom.homeChangelog.value = draft;
                markAdminSiteConfigDirty(ctx);
                ctx.adminSiteConfigDirty = dirtyAfterEdit;
                pending.resolve(readOk ? reply({ config: { changelog: [{ title: 'Réponse ancienne' }] } }) : { ok: false, status: 503 });
                await loading;
                assert.equal(ctx.adminDom.homeChangelog.value, draft);
                assert.equal(ctx.adminSiteConfig, original);
                assert.equal(ctx.adminSiteConfigDirty, dirtyAfterEdit);
                assert.match(ctx.adminDom.homeStatus.textContent, /modifications plus récentes/);
            }
        } finally { globalThis.fetch = previousFetch; }
    } },
    { name: 'fallback admin reads preserve edits made while the fallback is in flight', async run() {
        const previousFetch = globalThis.fetch;
        try {
            for (const fallbackOk of [true, false]) {
                const ctx = editorContext(), pending = deferred(), entered = deferred();
                const original = ctx.adminSiteConfig;
                globalThis.fetch = async url => {
                    if (url === '/api/admin/home-config') return { ok: false, status: 503 };
                    assert.equal(url, '/assets/site-config.json'); entered.resolve(); return pending.promise;
                };
                const loading = fetchAdminSiteConfig(ctx);
                await entered.promise;
                ctx.adminDom.homeChangelog.value = '2026-01-01 | Brouillon récent | Conservé';
                markAdminSiteConfigDirty(ctx);
                pending.resolve(fallbackOk ? reply({ changelog: [{ title: 'Ancien repli' }] }) : { ok: false, status: 503 });
                await loading;
                assert.equal(ctx.adminDom.homeChangelog.value, '2026-01-01 | Brouillon récent | Conservé');
                assert.equal(ctx.adminSiteConfig, original);
                assert.equal(ctx.adminSiteConfigSource, 'api');
                assert.equal(ctx.adminSiteConfigDirty, true);
            }
        } finally { globalThis.fetch = previousFetch; }
    } },
    { name: 'admin reads without intervening edits still populate the form', async run() {
        const previousFetch = globalThis.fetch;
        try {
            for (const editBeforeReload of [false, true]) {
                const ctx = editorContext();
                if (editBeforeReload) {
                    ctx.adminDom.homeChangelog.value = '2026-01-01 | Ancienne saisie | À recharger';
                    markAdminSiteConfigDirty(ctx);
                }
                globalThis.fetch = async () => reply({ config: { changelog: [{ title: 'Nouvelle lecture', summary: 'Acceptée' }] } });
                await fetchAdminSiteConfig(ctx);
                assert.equal(ctx.adminDom.homeChangelog.value, '| Nouvelle lecture | Acceptée');
                assert.equal(ctx.adminSiteConfigDirty, false);
            }
        } finally { globalThis.fetch = previousFetch; }
    } },
    { name: 'release gate rejects version/lock mismatch, missing or future notes and lost history', run() {
        assert.equal(validateRelease(pkg, lock, CHANGELOG).version, pkg.version);
        assert.equal(APP_VERSION, pkg.version);
        assert.throws(() => validateRelease(pkg, { ...lock, version: '0.0.1' }, CHANGELOG));
        assert.throws(() => validateRelease(pkg, lock, CHANGELOG.slice(1)));
        assert.throws(() => validateRelease(pkg, lock, [...CHANGELOG, { version: '999.0.0', title: 'Version 999.0.0 - fictive', summary: 'test', date: '2026-01-01' }]));
        assert.throws(() => validateRelease(pkg, lock, CHANGELOG.slice(0, -1), { baseline: CHANGELOG }));
        assert.throws(() => validateRelease(pkg, lock, [{ ...CHANGELOG[0], status: 'draft', date: '' }, ...CHANGELOG.slice(1)], { ready: true }), /E_RELEASE_NOT_READY/);
        assert.throws(() => validateRelease(pkg, lock, [{ ...CHANGELOG[0], status: 'draft', date: '2026-11-08' }, ...CHANGELOG.slice(1)]));
    } },
    { name: 'canonical notes supplement legacy editorial history without replacing variants or truncating', run() {
        const old = Array.from({ length: 80 }, (_, i) => ({ date: '2026-01-01', title: `Archive ${i}`, summary: `Texte ${i}` }));
        old.push({ date: '2026-09-25', title: 'Version 0.17.49 - Titre éditorial conservé', summary: 'Texte éditorial conservé' });
        const before = JSON.stringify(old), merged = mergeChangelog(old);
        assert.equal(JSON.stringify(old), before);
        for (const entry of old) assert(merged.some(item => JSON.stringify(item) === JSON.stringify(entry)));
        assert.equal(merged.filter(entry => entry.title.startsWith('Version 0.17.49')).length, 1);
        assert(merged[0].title.includes(pkg.version));
        assert.equal(mergeChangelog([]).length, CHANGELOG.length);
        assert.deepEqual(normalizeEntries([{}, null, { title: '' }]), []);
    } },
    { name: 'API loader follows all pages and never invents Git synchronization', async run() {
        const calls = [];
        const result = await loadChangelog({ complete: true, fetcher: async url => {
            calls.push(url);
            return reply(calls.length === 1 ? { source: 'config', entries: [{ title: 'A' }], hasMore: true, nextOffset: 1 } : { source: 'config', entries: [{ title: 'B' }], hasMore: false });
        } });
        assert.deepEqual(result.entries.map(entry => entry.title), ['A', 'B']);
        assert(calls[1].endsWith('offset=1'));
        assert.equal(result.source, 'code+config');
        const legacy = await loadChangelog({ fetcher: async () => reply({ source: 'git', entries: [{ title: 'Note statique' }] }) });
        assert.equal(legacy.source, 'code');
    } },
    { name: 'latest saved variant wins publicly, without changing the journal or unnumbered notes', run() {
        const config = representativeSiteConfig();
        const old = structuredClone(config.changelog);
        const correction = correctedNote(config);
        const stored = appendChangelog(config.changelog, [correction]);
        const visible = mergeChangelog(stored);
        assert.equal(draftNote.status, 'draft');
        assert.equal(draftNote.date, '');
        assert.deepEqual(config.changelog, old);
        assert.equal(stored.length, 51);
        assert.equal(stored.filter(entry => entryVersion(entry) === '0.17.48').length, 2);
        assert.deepEqual(visible.filter(entry => entryVersion(entry) === '0.17.48'), [correction]);
        assert.equal(visible.filter(entry => !entryVersion(entry)).length, 3);
        assert.equal(visible.filter(entry => entryVersion(entry) === draftNote.version).length, 1);
        assert.deepEqual(appendChangelog(stored, stored), stored);
    } },
    { name: 'same-date public notes sort by numeric version descending and preserve unnumbered order', run() {
        const entries = ['0.17.9', '0.17.11', '0.17.48'].map(version => ({ date: '2026-11-01', title: `Version ${version} - synthétique`, summary: 'Synthèse fictive' }));
        entries.push({ date: '2026-11-01', title: 'Archive B', summary: 'B' }, { date: '2026-11-01', title: 'Archive A', summary: 'A' });
        const visible = mergeChangelog(entries).filter(entry => entry.date === '2026-11-01');
        assert.deepEqual(visible.slice(0, 3).map(entryVersion), ['0.17.48', '0.17.11', '0.17.9']);
        assert.deepEqual(visible.slice(3).map(entry => entry.title), ['Archive B', 'Archive A']);
    } },
    { name: 'new text limits accept 200/4000 Unicode characters, reject excess and exempt unchanged long history', run() {
        const atLimit = { date: '2026-01-01', title: 'é'.repeat(200), summary: '🙂'.repeat(4000) };
        assert.deepEqual(appendChangelog([], [atLimit]), [atLimit]);
        for (const [entry, code] of [
            [{ ...atLimit, title: 'é'.repeat(201) }, 'E_CHANGELOG_TITLE_TOO_LONG'],
            [{ ...atLimit, summary: '🙂'.repeat(4001) }, 'E_CHANGELOG_SUMMARY_TOO_LONG']
        ]) assert.throws(() => appendChangelog([], [entry]), error => error.status === 400 && error.code === code);
        const history = representativeSiteConfig().changelog;
        const submitted = normalizeAdminSiteConfig({ changelog: history }).changelog;
        assert.deepEqual(appendChangelog(history, submitted), history);
        assert.equal(history.at(-1).title, '');
        const modifiedLong = { ...history[2], summary: history[2].summary + 'correction' };
        assert.throws(() => appendChangelog(history, [modifiedLong]), /4 000/);
        assert.deepEqual(appendChangelog([], [atLimit, atLimit]), [atLimit]);
    } },
    { name: 'loader recovers from API errors, empty payloads and missing/incomplete legacy config', async run() {
        for (const payload of [{}, { entries: [] }, { entries: [{}] }]) {
            const result = await loadChangelog({ config: { version: '0.0.1', changelog: [{ title: 'Archive persistée' }] }, fetcher: async () => reply(payload) });
            assert(result.fallback);
            assert(result.entries.some(entry => entry.title === 'Archive persistée'));
            assert(result.entries[0].title.includes(pkg.version));
        }
        for (const config of [undefined, {}, { changelog: null }, { changelog: [] }]) {
            const result = await loadChangelog({ config, fetcher: fail });
            assert.equal(result.entries.length, CHANGELOG.length);
            assert(result.fallback);
        }
        let call = 0;
        const result = await loadChangelog({ fetcher: async () => ++call === 1 ? { ok: false, status: 503 } : reply({ changelog: [{ title: 'Repli configuration' }] }) });
        assert(result.entries.some(entry => entry.title === 'Repli configuration'));
    } },
    { name: 'failed pagination discards partial result in favor of complete local fallback', async run() {
        for (const nextOffset of [0, -1, '50', 999]) {
            const result = await loadChangelog({ complete: true, config: {}, fetcher: async () => reply({ entries: [{ title: 'Partiel' }], hasMore: true, nextOffset }) });
            assert(result.fallback);
            assert.equal(result.entries.length, CHANGELOG.length);
        }
    } },
    { name: 'admin editor round-trips more than 50 notes and accepts empty supplemental notes', run() {
        const entries = Array.from({ length: 80 }, (_, i) => ({ date: '2026-01-01', title: `Archive ${i}`, summary: 'Texte avec | séparateur' }));
        assert.deepEqual(parseAdminChangelog(formatAdminSiteConfigChangelog(entries)), entries);
        const config = normalizeAdminSiteConfig({ version: '0.0.1', changelog: [] });
        assert.equal(config.version, pkg.version);
        assert.deepEqual(validateAdminSiteConfigDraft(config), []);
    } },
    { name: 'admin save preserves raw historical metadata, long text and unrelated fields on partial submissions', run() {
        const history = Array.from({ length: 80 }, (_, i) => ({ date: '2026-01-01', title: `Note ${i}`, summary: 'Texte '.repeat(100), editorial: { preserved: true } }));
        const existing = { version: '0.17.49', theme: { custom: true }, home: { title: 'Original', unknown: 'conservé' }, changelog: history };
        const submitted = { version: '999.0.0', home: { title: 'Nouveau' }, changelog: [history[0]] };
        const saved = applyConfigPatch(existing, submitted, submitted);
        assert.equal(saved.version, '0.17.49');
        assert.deepEqual(saved.theme, existing.theme);
        assert.deepEqual(saved.home, { title: 'Nouveau', unknown: 'conservé' });
        assert.deepEqual(saved.changelog, history);
        assert.deepEqual(applyConfigPatch(existing, { changelog: [] }, { changelog: [] }).changelog, history);
    } }
];
