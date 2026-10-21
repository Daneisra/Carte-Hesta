// Disposable, marked code staging only. Never accepts an existing app/public/data directory.
const fs = require('node:fs');
const path = require('node:path');
const { readPlain, digest } = require('../../server/publication/files');
const { absolute, separate, scan, directories, verify } = require('./release');
const MARKER = '.carte-code-stage.json';
function syncStage(release, destination, revision, checksum) {
    release = absolute(release); destination = absolute(destination); separate(release, destination);
    const result = verify(release, revision, checksum);
    const expectedHashes = JSON.parse(readPlain(path.join(release, 'release-manifest.json'))).entries;
    expectedHashes['release-manifest.json'] = { sha256: result.sha256 };
    const expectedFiles = scan(release);
    const expectedDirs = new Set();
    for (const file of expectedFiles) {
        let parent = path.posix.dirname(file);
        while (parent !== '.') { expectedDirs.add(parent); parent = path.posix.dirname(parent); }
    }
    if (!fs.existsSync(destination)) {
        fs.mkdirSync(destination, { mode: 0o700 });
        fs.writeFileSync(path.join(destination, MARKER), JSON.stringify({ format: 1, destination, purpose: 'disposable-code-only' }), { flag: 'wx', mode: 0o600 });
    }
    const marker = JSON.parse(readPlain(path.join(destination, MARKER)));
    if (marker.format !== 1 || marker.destination !== destination || marker.purpose !== 'disposable-code-only') throw Error('Unmarked or relocated stage refused');
    const old = scan(destination).filter(p => p !== MARKER);
    if (directories(destination).some(d => !expectedDirs.has(d))) throw Error('Unexpected staged directory');
    // Validate every file BEFORE deletion. Unexpected private/sensitive files require manual quarantine.
    for (const name of old) if (!expectedFiles.includes(name) && !(/^(app\/(?:server|js)\/|public\/(?:js|map|timeline|planning|changelog|geek-unchained)\/)[\w/-]+\.(?:js|mjs|html|css)$/.test(name))) throw Error('Unexpected staged data: synchronization refused');
    for (const name of old.filter(p => !expectedFiles.includes(p))) fs.unlinkSync(path.join(destination, name));
    for (const name of expectedFiles) {
        const target = path.join(destination, name), bytes = readPlain(path.join(release, name));
        if (digest(bytes) !== expectedHashes[name].sha256) throw Error('Release changed during staging');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target) && digest(readPlain(target)) === digest(bytes)) continue;
        // Stage is offline and disposable. Atomic replacement never touches persistent stores.
        const temp = target + '.stage-tmp';
        fs.writeFileSync(temp, bytes, { flag: 'wx', mode: name.endsWith('.json') ? 0o600 : 0o644 });
        fs.renameSync(temp, target);
    }
    const files = scan(destination).filter(p => p !== MARKER);
    if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) throw Error('Stage differs from release');
    for (const name of files) if (digest(readPlain(path.join(destination, name))) !== expectedHashes[name].sha256) throw Error('Staged integrity mismatch');
    verify(release, revision, result.sha256);
    return { ...result, disposableStage: true };
}
module.exports = { syncStage, MARKER };
