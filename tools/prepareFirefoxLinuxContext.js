#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSandbox, assertPlainPath, SOURCE_ROOT } = require('../tests/support/sandbox.cjs');

function prepare({ e1 = false } = {}) {
    const sandbox = createSandbox();
    const context = path.join(sandbox.root, 'linux-context');
    fs.mkdirSync(context);
    const manifest = [];
    function copy(from, relative, synthetic) {
        assertPlainPath(from);
        const target = path.join(context, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(from, target, fs.constants.COPYFILE_EXCL);
        manifest.push({ path: relative.split(path.sep).join('/'), synthetic, sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') });
    }
    function visit(directory, relative, application) {
        assertPlainPath(directory);
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const nested = path.join(relative, entry.name);
            const from = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(from, nested, application);
            else if (entry.isFile() && (application || /\.(?:js|mjs|cjs|md)$/.test(entry.name))) copy(from, nested, application && nested.startsWith(`assets${path.sep}`) && !nested.endsWith('.css'));
            else if (!entry.isFile()) throw Error('Unexpected Linux context entry');
        }
    }
    // The app tree was already built by the lot A positive list; its JSON/media are generated fixtures.
    visit(sandbox.app, '', true);
    // Reconstruct the source positive list, using staged public files only (never original assets).
    for (const entry of JSON.parse(fs.readFileSync(path.join(sandbox.root, 'copied-code.json'), 'utf8'))) {
        const staged = path.join(sandbox.publicDir, entry);
        if (fs.existsSync(staged) && !fs.existsSync(path.join(context, entry))) copy(staged, entry, false);
    }
    visit(path.join(SOURCE_ROOT, 'tests'), 'tests', false);
    for (const relative of ['package-lock.json', 'playwright.config.js', 'tools/storage.js', 'tools/migratePermissions.js', 'tools/buildPublic.js', 'tools/publishMedia.js', 'tools/runIsolatedTests.js', 'tools/devServerWithStub.js', 'tools/diagnoseFirefox.js', 'tools/prepareFirefoxLinuxContext.js']) copy(path.join(SOURCE_ROOT, relative), relative, false);
    // E1 tools and configurations are code-only positive lists, never persistent assets.
    const { BACKEND, OPS } = require('./deployment/release');
    const { EXTRA, verify, verifyLocalDependencies } = require('./verifyLinuxContext');
    for (const relative of [...BACKEND, ...EXTRA.filter(n => !['Dockerfile', 'tools/deployment/legacyTrackedPaths.json'].includes(n))]) {
        if (!fs.existsSync(path.join(context, relative))) copy(path.join(SOURCE_ROOT, relative), relative, false);
    }
    // The independent context has no real Git index/debt. Do not export historical asset filenames.
    const syntheticDebtPath = 'tools/deployment/legacyTrackedPaths.json';
    const syntheticDebt = Buffer.from('[]\n');
    fs.writeFileSync(path.join(context, syntheticDebtPath), syntheticDebt, { flag: 'wx', mode: 0o600 });
    manifest.push({ path: syntheticDebtPath, synthetic: true, sha256: crypto.createHash('sha256').update(syntheticDebt).digest('hex') });
    for (const relative of OPS) copy(path.join(SOURCE_ROOT, 'ops', relative), path.join('ops', relative), false);
    copy(path.join(SOURCE_ROOT, e1 ? 'tests/deployment/Dockerfile' : 'tests/firefox/Dockerfile'), 'Dockerfile', false);
    fs.writeFileSync(path.join(context, 'context-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    const manifestSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(context, 'context-manifest.json'))).digest('hex');
    verify(context, manifestSha256);
    const dependencies = verifyLocalDependencies(context, manifest);
    console.log(JSON.stringify({ context, marker: path.join(sandbox.root, '.carte-test-sandbox.json'), files: manifest.length, manifestSha256, productionDataCopied: false, localDependencyEdges: dependencies.localEdges }, null, 2));
    return { sandbox, context, manifest, manifestSha256, dependencies };
}
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 1 || args[0] !== '--e1')) throw Error('Use no arguments or --e1');
    prepare({ e1: args[0] === '--e1' });
}
module.exports = { prepare };
