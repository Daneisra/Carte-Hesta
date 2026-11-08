#!/usr/bin/env node
// Read-only: source code and package metadata only, never persistent configuration.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const { CHANGELOG } = require('../js/shared/changelog.mjs');
const { entryVersion } = require('../js/shared/changelogData.mjs');
const { versionModule } = require('../server/publication/files');
const PAGES = require('../server/publication/staticFiles').filter(name => name.endsWith('.html'));
const compare = (a, b) => {
    const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
    return 0;
};
function validateRelease(pkg, lock, notes, { baseline = [], ready = false } = {}) {
    const version = pkg.version;
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || '')) throw Error('Version applicative invalide');
    if (lock.version !== version || lock.packages?.['']?.version !== version) throw Error('Versions package/lock incohérentes');
    if (!Array.isArray(notes) || !notes.length || entryVersion(notes[0]) !== version) throw Error('La version applicative doit avoir sa note en tête');
    const seen = new Set();
    for (const entry of notes) {
        if (!entry.title || !entry.summary) throw Error('Note incomplète');
        const number = entryVersion(entry);
        const inTitle = entry.title.match(/^Version (\d+\.\d+\.\d+)(?:\s|$)/u)?.[1];
        if (entry.version && inTitle !== entry.version) throw Error('Version et titre de note incohérents');
        if (number) {
            if (compare(number, version) > 0) throw Error('Note annonçant une version inexistante');
            if (seen.has(number)) throw Error('Version canonique dupliquée');
            seen.add(number);
        }
        if (entry.status === 'draft') {
            if (ready) throw Error('E_RELEASE_NOT_READY : publication/fusion refusée, version en draft ; confirmer la date réelle et finaliser les notes avant fusion vers main. Le contrôle de préparation release:check accepte un draft.');
            if (number !== version || entry.date !== '') throw Error('E_RELEASE_DRAFT_INVALID : une préparation doit correspondre à la version du code et rester sans date définitive.');
        } else if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date || '') || !Number.isFinite(Date.parse(entry.date)) || new Date(entry.date).toISOString().slice(0, 10) !== entry.date) throw Error('Date historique invalide');
    }
    for (const old of baseline.filter(entry => entry.status !== 'draft')) {
        if (!notes.some(entry => entry.date === old.date && entry.title === old.title && entry.summary === old.summary)) throw Error(`Historique retiré ou modifié : ${old.title}`);
    }
    return { version, entries: notes.length, status: notes[0].status || 'documented' };
}
function baselineAt(root, revision) {
    const show = file => execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    try {
        return JSON.parse(show('js/shared/changelog.mjs').match(/export const CHANGELOG = ([\s\S]*?);\s*$/u)[1]);
    } catch (error) {
        // Transition depuis main avant cette centralisation : seules les notes du code.
        let source;
        try { source = show('server.js'); } catch { throw Error('Base Git introuvable : contrôle de conservation impossible'); }
        const expression = source.match(/const DEFAULT_SITE_CONFIG = ([\s\S]*?);\r?\n/u)?.[1];
        if (!expression || source.includes("require('./js/shared/changelog.mjs')")) throw Error('Historique de base illisible');
        return vm.runInNewContext(`(${expression})`, Object.create(null), { timeout: 1000 }).changelog;
    }
}
function main(args = process.argv.slice(2)) {
    if (args.some(arg => arg !== '--ready' && !/^--base=[a-zA-Z0-9~^./_-]+$/.test(arg))) throw Error('Arguments : --ready et --base=REVISION');
    const root = path.resolve(__dirname, '..');
    const read = name => fs.readFileSync(path.join(root, name), 'utf8');
    const base = args.find(arg => arg.startsWith('--base='))?.slice(7);
    const result = validateRelease(JSON.parse(read('package.json')), JSON.parse(read('package-lock.json')), CHANGELOG, { baseline: base ? baselineAt(root, base) : [], ready: args.includes('--ready') });
    if (read('js/shared/appVersion.mjs') !== versionModule(result.version).toString('utf8')) throw Error('Version navigateur obsolète : exécuter npm run version:sync');
    for (const page of PAGES) {
        const html = read(page);
        if (!html.includes('<meta name="application-version" content="">') || !html.includes('src="/js/version.js"')) throw Error(`Métadonnées de version absentes : ${page}`);
        if (/\b\d+\.\d+\.\d+\b/.test(html.replace(/https?:[^"\s]+/g, ''))) throw Error(`Version HTML codée en dur : ${page}`);
        for (const match of html.matchAll(/<(?:span|strong)\b[^>]*\bid="[^"]*version[^"]*"[^>]*>/g)) if (!match[0].includes('data-app-version')) throw Error(`Affichage de version non centralisé : ${page}`);
    }
    console.log(`Version ${result.version} : ${result.entries} notes, état ${result.status}; cohérence et conservation vérifiées${base ? ` depuis ${base}` : ''}.`);
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { validateRelease, baselineAt, PAGES };
