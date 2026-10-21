const fs = require('node:fs');
const path = require('node:path');
const { JsonStore, names, validate } = require('../../server/storage/jsonStore');
const { plainPath, within } = require('../../server/storage/paths');
const { readPlain, digest, mediaPath } = require('../../server/publication/files');
const { absolute, separate } = require('./release');
const { verifySnapshot, syncTree } = require('./snapshot');
const { main: preparePermissions } = require('../migratePermissions');
const historical = names.filter(n => n !== 'permissions');
async function stageHistorical(plan, destination, snapshot, expectedSnapshot) {
    if (plan?.format !== 1 || plan.sourcePermissionsSchema !== 0 || plan.writersStopped !== true || !plan.files || JSON.stringify(Object.keys(plan.files).sort()) !== JSON.stringify([...historical].sort())) throw Error('Explicit verified nine-store mapping, source schema 0 and writer stop required');
    if (!/^[a-f0-9]{64}$/.test(expectedSnapshot || '')) throw Error('Independent verified backup checksum required');
    verifySnapshot(snapshot, expectedSnapshot);
    destination = absolute(destination); separate(destination, absolute(snapshot));
    const sourceRoot = absolute(plan.sourceRoot); separate(sourceRoot, destination);
    if (fs.existsSync(destination)) throw Error('Migration destination must be new; resume requires review');
    const snapshotManifest = JSON.parse(readPlain(path.join(snapshot, 'snapshot-manifest.json')));
    const payloads = {};
    for (const name of historical) {
        const entry = plan.files[name];
        const source = absolute(entry?.source);
        if (!within(sourceRoot, source)) throw Error('Historical source escapes reviewed root');
        if (fs.existsSync(path.join(path.dirname(source), 'permissions.json'))) throw Error('Existing permission registry must be preserved, not replaced by a historical migration');
        if (source === destination || source.startsWith(destination + path.sep)) throw Error('Source overlaps destination');
        if (!snapshotManifest.entries[entry.backupEntry] || snapshotManifest.entries[entry.backupEntry].sha256 !== entry.sha256) throw Error('Source is not covered by the verified snapshot');
        const bytes = readPlain(source);
        if (digest(bytes) !== entry.sha256) throw Error('Historical source fingerprint mismatch');
        validate(name, JSON.parse(bytes)); payloads[name] = bytes;
    }
    fs.mkdirSync(destination, { mode: 0o700 });
    for (const part of ['private', 'content', 'locks', 'transactions']) fs.mkdirSync(path.join(destination, part), { mode: 0o700 });
    const store = new JsonStore(destination);
    for (const name of historical) {
        const fd = fs.openSync(store.file(name), 'wx', 0o600);
        try { fs.writeFileSync(fd, payloads[name]); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    syncTree(destination);
    await checkData(destination, { historicalOnly: true });
    return { copiedStores: historical.length, permissionsCreated: false, historicalBytesUnchanged: true };
}
async function checkData(directory, { historicalOnly = false } = {}) {
    directory = absolute(directory);
    const store = new JsonStore(directory);
    await store.acquire();
    try {
        plainPath(store.journalPath);
        if (fs.existsSync(store.journalPath)) throw Error('Pending transaction blocks migration');
        const fingerprints = {};
        for (const name of historicalOnly ? historical : names) {
            const { text } = await store.raw(name); fingerprints[name] = digest(Buffer.from(text));
        }
        return { stores: Object.keys(fingerprints).length, fingerprints };
    } finally { await store.close(); }
}
async function prepareAndVerify(env) {
    const before = await checkData(env.CARTE_DATA_DIR, { historicalOnly: true });
    const result = await preparePermissions(['prepare-v1'], env);
    const after = await checkData(env.CARTE_DATA_DIR);
    for (const name of historical) if (before.fingerprints[name] !== after.fingerprints[name]) throw Error('Historical bytes changed');
    return { ...result, historicalStoresPreserved: historical.length, checkedStores: after.stores };
}
async function stageMedia(plan, destination, snapshot, expectedSnapshot) {
    if (plan?.format !== 1 || plan.writersStopped !== true || plan.sourceMediaIndexVersion !== 0 || !Array.isArray(plan.files)) throw Error('Explicit legacy media plan required');
    if (!/^[a-f0-9]{64}$/.test(expectedSnapshot || '')) throw Error('Verified backup checksum required');
    verifySnapshot(snapshot, expectedSnapshot);
    destination = absolute(destination); separate(destination, absolute(snapshot));
    const sourceRoot = absolute(plan.sourceRoot); separate(sourceRoot, destination);
    if (fs.existsSync(path.join(sourceRoot, '.published-media.json'))) throw Error('Existing media index requires preservation and separate review');
    if (fs.existsSync(destination)) throw Error('Media destination must be new');
    if (plan.files.length > 4096) throw Error('Media plan exceeds reviewed file count');
    const manifest = JSON.parse(readPlain(path.join(snapshot, 'snapshot-manifest.json'))), paths = new Set(), copies = [];
    let total = 0;
    for (const entry of plan.files) {
        mediaPath(entry.relative);
        if (paths.has(entry.relative)) throw Error('Duplicate media destination'); paths.add(entry.relative);
        const source = absolute(entry.source);
        if (!within(sourceRoot, source)) throw Error('Media source escapes reviewed root');
        separate(source, destination);
        if (manifest.entries[entry.backupEntry]?.sha256 !== entry.sha256) throw Error('Media not covered by snapshot');
        const bytes = readPlain(source);
        total += bytes.length; if (total > 512 * 1024 * 1024) throw Error('Media plan exceeds reviewed memory bound');
        if (digest(bytes) !== entry.sha256) throw Error('Media fingerprint mismatch');
        copies.push({ relative: entry.relative.slice('assets/'.length), bytes });
    }
    fs.mkdirSync(destination, { mode: 0o700 });
    for (const { relative, bytes } of copies) {
        const target = path.join(destination, relative); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        const fd = fs.openSync(target, 'wx', 0o600);
        try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        if (digest(readPlain(target)) !== digest(bytes)) throw Error('Staged media differs');
    }
    syncTree(destination);
    // Technical approval remains a separate offline operation. No image becomes public here.
    return { copiedFiles: copies.length, mediaIndexCreated: false, publicationGranted: false };
}
module.exports = { historical, stageHistorical, checkData, prepareAndVerify, stageMedia };
