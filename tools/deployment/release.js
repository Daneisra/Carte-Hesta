// Offline release format. No transport, activation, secrets or data discovery.
const fs = require('node:fs');
const path = require('node:path');
const { plainPath, within } = require('../../server/storage/paths');
const { readPlain, digest, buildPublic, STATIC_FILES, readIndex, verified } = require('../../server/publication/files');
const BACKEND = [
    'server.js', 'package.json', 'package-lock.json',
    ...['annotations', 'auth', 'health', 'index', 'locations', 'questEvents', 'timeline'].map(n => `server/routes/${n}.js`),
    ...['assetsArchive', 'fileLock', 'logger'].map(n => `server/utils/${n}.js`),
    ...['authConfig', 'jsonStore', 'paths', 'sessions'].map(n => `server/storage/${n}.js`),
    ...['access', 'revoke', 'schema', 'service'].map(n => `server/security/${n}.js`),
    ...['archive', 'files', 'http', 'media', 'mediaTypes', 'projections', 'staticFiles', 'stream'].map(n => `server/publication/${n}.js`),
    ...['locationSchema', 'locationValidation', 'searchFilters'].map(n => `js/shared/${n}.mjs`),
    ...['storage', 'migratePermissions', 'publishMedia', 'buildPublic', 'deployment'].map(n => `tools/${n}.js`),
    ...['release', 'snapshot', 'migration', 'stage'].map(n => `tools/deployment/${n}.js`)
];
const OPS = ['ecosystem.config.cjs', 'nginx.conf', 'nginx-routing.conf', 'logrotate.conf'];
const allowed = () => new Set([...BACKEND.map(p => `app/${p}`), ...STATIC_FILES.map(p => `public/${p}`), 'public/.public-manifest.json', ...OPS.map(p => `ops/${p}`)]);
function absolute(target) { if (!target || !path.isAbsolute(target)) throw Error('Explicit absolute path required'); plainPath(target); return path.resolve(target); }
function separate(...roots) { roots.forEach(absolute); for (const a of roots) for (const b of roots) if (a !== b && (within(a, b) || within(b, a))) throw Error('Overlapping release paths'); if (new Set(roots).size !== roots.length) throw Error('Duplicate roots'); }
function scan(root) {
    absolute(root);
    const result = [];
    function visit(relative) {
        const target = path.join(root, relative); plainPath(target);
        const stat = fs.lstatSync(target);
        if (stat.isDirectory()) { for (const name of fs.readdirSync(target).sort()) visit(relative ? `${relative}/${name}` : name); }
        else if (stat.isFile() && stat.nlink === 1) result.push(relative);
        else throw Error('Only plain files and directories allowed');
    }
    visit(''); return result.sort();
}
function directories(root) {
    scan(root); // Validate links, file types and hard links first.
    const result = [];
    function visit(relative) {
        for (const e of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) if (e.isDirectory()) {
            const name = relative ? `${relative}/${e.name}` : e.name; result.push(name); visit(name);
        }
    }
    visit(''); return result.sort();
}
function copy(source, destination, relative) {
    const bytes = readPlain(path.join(source, relative));
    const target = path.join(destination, relative); plainPath(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: relative.endsWith('.json') ? 0o600 : 0o644 });
}
function build(source, output, revision) {
    source = absolute(source); output = absolute(output); separate(source, output);
    if (!/^[a-f0-9]{40}$/.test(revision || '')) throw Error('Explicit full source revision required');
    if (fs.existsSync(output)) throw Error('Release destination must be new');
    // Read only the reviewed code list; never enumerate assets or load dotenv/npm configuration.
    const pkg = JSON.parse(readPlain(path.join(source, 'package.json')));
    if (Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.optionalDependencies || {}).length) throw Error('Runtime dependency change requires packaging review');
    fs.mkdirSync(output, { mode: 0o700 }); fs.mkdirSync(path.join(output, 'app'));
    for (const relative of BACKEND) copy(source, path.join(output, 'app'), relative);
    buildPublic(source, path.join(output, 'public'));
    for (const relative of OPS) copy(path.join(source, 'ops'), path.join(output, 'ops'), relative);
    const entries = Object.fromEntries(scan(output).map(relative => { const b = readPlain(path.join(output, relative)); return [relative, { size: b.length, sha256: digest(b) }]; }));
    const manifest = { format: 1, permissionsSchema: 1, nodeMajor: 22, version: pkg.version, revision, entries };
    fs.writeFileSync(path.join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return verify(output, revision);
}
function verify(root, expectedRevision, expectedDigest) {
    root = absolute(root);
    const bytes = readPlain(path.join(root, 'release-manifest.json'));
    if (expectedDigest && digest(bytes) !== expectedDigest) throw Error('Release manifest checksum mismatch');
    const m = JSON.parse(bytes);
    if (m.format !== 1 || m.permissionsSchema !== 1 || m.nodeMajor !== 22 || !/^[a-f0-9]{40}$/.test(m.revision || '') || m.revision !== expectedRevision || typeof m.version !== 'string' || !m.entries || Array.isArray(m.entries)) throw Error('Incompatible release metadata or revision');
    const expected = [...allowed()].sort();
    if (JSON.stringify(Object.keys(m.entries).sort()) !== JSON.stringify(expected) || JSON.stringify(scan(root)) !== JSON.stringify([...expected, 'release-manifest.json'].sort())) throw Error('Unexpected or missing release files');
    const expectedDirs = new Set();
    for (const file of expected) { let p = path.posix.dirname(file); while (p !== '.') { expectedDirs.add(p); p = path.posix.dirname(p); } }
    if (JSON.stringify(directories(root)) !== JSON.stringify([...expectedDirs].sort())) throw Error('Unexpected release directory');
    for (const [relative, metadata] of Object.entries(m.entries)) {
        const b = readPlain(path.join(root, relative));
        if (metadata.size !== b.length || metadata.sha256 !== digest(b)) throw Error('Release file integrity failure');
    }
    const pub = readIndex(path.join(root, 'public'), '.public-manifest.json', 'static');
    if (Object.keys(pub.entries).length !== STATIC_FILES.length) throw Error('Public artifact mismatch');
    for (const relative of STATIC_FILES) verified(path.join(root, 'public'), relative, pub.entries[relative]);
    const pkg = JSON.parse(readPlain(path.join(root, 'app/package.json'))), lock = JSON.parse(readPlain(path.join(root, 'app/package-lock.json')));
    if (pkg.version !== m.version || lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw Error('Package version mismatch');
    if (Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.optionalDependencies || {}).length) throw Error('Unreviewed runtime dependencies');
    return { revision: m.revision, version: m.version, sha256: digest(bytes), files: expected.length };
}
module.exports = { BACKEND, OPS, allowed, absolute, separate, scan, directories, copy, build, verify };
