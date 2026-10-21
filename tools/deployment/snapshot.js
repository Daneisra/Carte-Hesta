// Private offline snapshots; operators must stop ALL writers externally first.
// Acknowledgement and hash stability do not prove that external processes were stopped.
const fs = require('node:fs');
const path = require('node:path');
const { readPlain, digest } = require('../../server/publication/files');
const { absolute, separate, scan, directories } = require('./release');
const LABELS = ['legacy', 'app', 'public', 'data', 'media', 'logs', 'config', 'secrets'];
function privateRelative(name) {
    if (typeof name !== 'string' || !name || path.posix.isAbsolute(name) || /[\\<>:"|?*\x00-\x1f\x7f]/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Invalid private snapshot path');
}
function syncTree(root) {
    if (process.platform === 'win32') return;
    for (const d of [...directories(root).reverse(), '']) { const fd = fs.openSync(path.join(root, d), 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
}
function inventory(roots) {
    const entries = {};
    let size = 0;
    for (const [label, root] of Object.entries(roots)) {
        if (!LABELS.includes(label)) throw Error('Unapproved snapshot root label');
        for (const relative of scan(root)) {
            if (/(^|\/)(writer\.lock|pending\.json)$/.test(relative)) throw Error('Live/stale lease or transaction requires offline review');
            const target = path.join(root, relative), b = readPlain(target);
            size += b.length;
            if (size > 512 * 1024 * 1024) throw Error('Snapshot exceeds reviewed 512 MiB limit');
            const st = fs.statSync(target);
            entries[`${label}/${relative}`] = { size: b.length, sha256: digest(b), mode: st.mode & 0o777, uid: st.uid, gid: st.gid };
            if (Object.keys(entries).length > 4096) throw Error('Snapshot exceeds reviewed file count');
        }
    }
    return entries;
}
function capture(roots, destination, { writersStopped = false } = {}) {
    if (writersStopped !== true || !roots || !Object.keys(roots).length) throw Error('Explicit offline writer-stop acknowledgement required');
    destination = absolute(destination); const values = Object.values(roots).map(absolute); separate(destination, ...values);
    if (fs.existsSync(destination)) throw Error('Snapshot destination must be new');
    const before = inventory(roots);
    const dirs = Object.entries(roots).flatMap(([label, root]) => [label, ...directories(root).map(d => `${label}/${d}`)]).sort();
    fs.mkdirSync(destination, { mode: 0o700 });
    for (const d of dirs) fs.mkdirSync(path.join(destination, d), { recursive: true, mode: 0o700 });
    for (const [name, entry] of Object.entries(before)) {
        const [label, ...tail] = name.split('/'); const relative = tail.join('/');
        const b = readPlain(path.join(roots[label], relative));
        if (digest(b) !== entry.sha256) throw Error('Source changed during snapshot');
        const target = path.join(destination, name);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        const fd = fs.openSync(target, 'wx', 0o600);
        try { fs.writeFileSync(fd, b); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    const afterDirs = Object.entries(roots).flatMap(([label, root]) => [label, ...directories(root).map(d => `${label}/${d}`)]).sort();
    if (JSON.stringify(inventory(roots)) !== JSON.stringify(before) || JSON.stringify(afterDirs) !== JSON.stringify(dirs)) throw Error('Snapshot is not stable');
    const manifest = { format: 1, roots: Object.keys(roots).sort(), directories: dirs, entries: before };
    syncTree(destination);
    const manifestHandle = fs.openSync(path.join(destination, 'snapshot-manifest.json'), 'wx', 0o600);
    try { fs.writeFileSync(manifestHandle, JSON.stringify(manifest, null, 2) + '\n'); fs.fsyncSync(manifestHandle); } finally { fs.closeSync(manifestHandle); }
    syncTree(destination);
    return verifySnapshot(destination);
}
function verifySnapshot(root, expectedDigest) {
    root = absolute(root);
    if (process.platform !== 'win32') {
        for (const relative of ['', ...directories(root), ...scan(root)]) if (fs.statSync(path.join(root, relative)).mode & 0o077) throw Error('Snapshot requires private POSIX permissions');
    }
    const bytes = readPlain(path.join(root, 'snapshot-manifest.json'));
    if (expectedDigest && digest(bytes) !== expectedDigest) throw Error('Snapshot manifest checksum mismatch');
    const m = JSON.parse(bytes);
    if (m.format !== 1 || !Array.isArray(m.roots) || !m.roots.length || m.roots.some(label => !LABELS.includes(label)) || new Set(m.roots).size !== m.roots.length || !m.entries || Array.isArray(m.entries)) throw Error('Unsupported snapshot');
    const names = Object.keys(m.entries).sort();
    if (!Array.isArray(m.directories)) throw Error('Missing snapshot directory inventory');
    for (const d of m.directories) { privateRelative(d); if (!m.roots.includes(d.split('/')[0])) throw Error('Unknown snapshot directory'); }
    if (JSON.stringify(directories(root)) !== JSON.stringify(m.directories)) throw Error('Snapshot directories differ');
    for (const name of names) {
        privateRelative(name);
        if (!m.roots.includes(name.split('/')[0])) throw Error('Unknown snapshot label');
        const b = readPlain(path.join(root, name)), e = m.entries[name];
        if (!e || e.sha256 !== digest(b) || e.size !== b.length || !Number.isSafeInteger(e.mode) || e.mode < 0 || e.mode > 0o777) throw Error('Snapshot integrity failure');
    }
    if (JSON.stringify(scan(root)) !== JSON.stringify([...names, 'snapshot-manifest.json'].sort())) throw Error('Unexpected snapshot content');
    return { sha256: digest(bytes), files: names.length, roots: m.roots };
}
function restore(root, destination, expectedDigest) {
    if (!/^[a-f0-9]{64}$/.test(expectedDigest || '')) throw Error('Independent expected snapshot checksum required');
    verifySnapshot(root, expectedDigest);
    destination = absolute(destination); separate(absolute(root), destination);
    if (fs.existsSync(destination)) throw Error('Restore never replaces an existing directory');
    const manifest = JSON.parse(readPlain(path.join(root, 'snapshot-manifest.json')));
    fs.mkdirSync(destination, { mode: 0o700 });
    for (const relative of manifest.directories) fs.mkdirSync(path.join(destination, relative), { recursive: true, mode: 0o700 });
    // Restore into quarantine, private modes only. Ownership/serving modes require explicit host review.
    for (const relative of Object.keys(manifest.entries)) {
        const target = path.join(destination, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        const fd = fs.openSync(target, 'wx', 0o600);
        try { fs.writeFileSync(fd, readPlain(path.join(root, relative))); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    const restored = inventory(Object.fromEntries(manifest.roots.map(label => [label, path.join(destination, label)])));
    for (const [name, e] of Object.entries(manifest.entries)) if (restored[name]?.sha256 !== e.sha256) throw Error('Restored bytes differ');
    syncTree(destination);
    return { files: Object.keys(restored).length, privateQuarantine: true };
}
module.exports = { inventory, capture, verifySnapshot, restore, syncTree };
