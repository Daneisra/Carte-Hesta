const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createSandbox, removeSandbox } = require('../support/sandbox.cjs');
const { plan, manifest, compare, coverage } = require('../../tools/localBackupManifest');
async function lab(run) { const s = createSandbox(); try { await run(s); } finally { removeSandbox(s.root, s.token); } }
function fixture(s) {
    const root = path.join(s.root, 'synthetic-full-checkout'); fs.mkdirSync(root);
    const files = { '.env': 'FAKE_SECRET=synthetic-only\n', '.git/index': 'FAKE-GIT-INDEX', '.git/objects/aa/synthetic': 'FAKE-GIT-OBJECT', '.git/lfs/objects/aa/synthetic': 'FAKE-LFS-BYTES', 'assets/users.json': '[{"id":"synthetic-user"}]', 'assets/images/Fictitious [A] & B.png': 'FAKE-MEDIA', 'server/new-untracked.cjs': '// fictional untracked code', 'modified.js': '// fictional working changes' };
    for (const [name, text] of Object.entries(files)) { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); }
    fs.mkdirSync(path.join(root, 'empty-directory'));
    return root;
}
function copy(source, target) {
    assert(!fs.existsSync(target));
    if (process.platform === 'win32') {
        const result = spawnSync(path.join(process.env.SystemRoot, 'System32/robocopy.exe'), [source, target, '/E', '/COPY:DAT', '/DCOPY:DAT', '/XJ', '/R:0', '/W:0', '/NP', '/NFL', '/NDL', '/NJH', '/NJS'], { stdio: 'ignore', windowsHide: true });
        assert(result.status >= 0 && result.status < 8, 'Native synthetic Robocopy must succeed');
    } else fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
}
test('full local backup plan reads metadata only and includes ignored/untracked/Git/LFS/empty directories', async () => lab(s => {
    const root = fixture(s), original = fs.readFileSync;
    fs.readFileSync = function(target, ...args) { if (typeof target === 'string' && target.startsWith(root + path.sep)) throw Error('Fixture content must not be read during plan'); return original.call(this, target, ...args); };
    try { const p = plan(root, path.join(s.root, 'planned-copy')); assert.equal(p.files, 8); assert.equal(p.contentsRead, false); assert.equal(p.copied, false); assert(p.minimumBackupAndRestoreBytes >= 2 * p.bytes); }
    finally { fs.readFileSync = original; }
}));
test('native Windows copy and isolated restore retain synthetic bytes, modified/untracked paths, Git and LFS; hashes cover a file beyond 25 MiB', async () => lab(async s => {
    const root = fixture(s); fs.writeFileSync(path.join(root, 'large-synthetic.bin'), Buffer.alloc(26 * 1024 * 1024, 0x61));
    const controls = path.join(s.root, 'private-controls'); fs.mkdirSync(controls, { mode: 0o700 });
    const options = { privacyCheck: () => {} }; // Injected ONLY for the owned synthetic laboratory; CLI never exposes this.
    const file = n => path.join(controls, n + '.json');
    const before = await manifest(root, file('before'), options); assert.equal(before.files, 9);
    const backup = path.join(s.root, 'fake-backup-tree'); copy(root, backup); await manifest(backup, file('backup'), options);
    const restored = path.join(s.root, 'fake-restore-tree'); copy(backup, restored); await manifest(restored, file('restored'), options);
    await manifest(root, file('source-after'), options);
    assert(compare(file('before'), file('backup')).matched); assert(compare(file('before'), file('restored')).matched); assert(compare(file('before'), file('source-after'), true).matched);
    const required = path.join(controls, 'required.json'); fs.writeFileSync(required, JSON.stringify(['assets/users.json', 'assets/images/Fictitious [A] & B.png', '.env', 'server/new-untracked.cjs', '.git/index']));
    assert.equal(coverage(file('backup'), required).present, 5); assert.equal(coverage(file('restored'), required).present, 5);
    fs.appendFileSync(path.join(restored, 'assets/users.json'), ' '); await manifest(restored, file('changed'), options);
    assert.throws(() => compare(file('before'), file('changed')), /MISMATCH/);
    await assert.rejects(manifest(root, file('before'), options), /EXISTS/);
    assert.throws(() => plan(root, path.join(root, 'bad-backup')), /OVERLAP/);
}));
test('backup refuses links, hard links, missing coverage, external Git references and existing destinations', async () => lab(async s => {
    const root = fixture(s), out = path.join(s.root, 'future-copy'); fs.mkdirSync(out);
    assert.throws(() => plan(root, out), /DESTINATION_EXISTS/);
    const lock = path.join(root, '.git/index.lock'); fs.writeFileSync(lock, 'synthetic'); assert.throws(() => plan(root, path.join(s.root, 'new-copy')), /GIT_REVIEW/); fs.unlinkSync(lock);
    const link = path.join(root, 'junction'); fs.symlinkSync(s.data, link, process.platform === 'win32' ? 'junction' : 'dir'); assert.throws(() => plan(root, path.join(s.root, 'new-copy')), /LINK_OR_SPECIAL/); fs.unlinkSync(link);
    const hard = path.join(root, 'hardlink'); fs.linkSync(path.join(root, 'modified.js'), hard); assert.throws(() => plan(root, path.join(s.root, 'new-copy')), /LINK_OR_SPECIAL/); fs.unlinkSync(hard);
    const output = path.join(s.root, 'synthetic-manifest.json'); await manifest(root, output, { privacyCheck: () => {} });
    const required = path.join(s.root, 'required.json'); fs.writeFileSync(required, '["missing-synthetic-file"]'); assert.throws(() => coverage(output, required), /COVERAGE/);
    fs.mkdirSync(path.join(root, '.git/objects/info')); fs.writeFileSync(path.join(root, '.git/objects/info/alternates'), 'fake'); assert.throws(() => plan(root, path.join(s.root, 'new-copy')), /GIT_REVIEW/);
}));
