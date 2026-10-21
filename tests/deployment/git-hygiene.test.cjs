const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createSandbox, removeSandbox, SOURCE_ROOT } = require('../support/sandbox.cjs');
const { classify, parseIndex, readIndex, auditIndex } = require('../../tools/auditTrackedPaths');
const { prepare, category, localMetadata } = require('../../tools/prepareGitCleanup');
const LEGACY = require('../../tools/deployment/legacyTrackedPaths.json');
// Independent of the live debt register: remains meaningful after real untracking clears it.
const FAKE_PATHS = ['assets/users.json', 'assets/groups.json', 'assets/annotations.json', 'assets/planning.json',
    'assets/locations.json', 'assets/types.json', 'assets/timeline.json', 'assets/site-config.json',
    'assets/logs/locations-audit.jsonl', 'assets/audio/Fictitious [A] & (B).mp3', 'assets/images/Fictitious Village.png'];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');

test('path gate rejects Windows case aliases, nested private roots, dumps and rotated logs', () => {
    const paths = ['ASSETS/private.png', 'Assets/audio/new.mp3', '.AWS/credentials', 'Nested/.SSH/config', 'Data/blob.txt', 'app/secrets/token.txt', 'copies/backups/archive.txt', 'dump.sqlite3', 'dump.sql', 'backup.tgz', 'node-out.log.1', 'node-out.log.1.gz', 'old.jsonl.2', 'src/personal-avatar.jpg', 'notes/private.pdf', '../outside', '/absolute', 'C:/outside', 'assets\\users.json'];
    assert.deepEqual(classify(paths).forbidden, paths);
    assert.equal(classify(['assets/hesta-identity.css', 'assets/fixtures/README.md', 'assets/fixtures/locations_sample.json', 'assets/fixtures/types_sample.json', '.env.example', 'tools/deployment/legacyTrackedPaths.json']).cleanForRelease, true);
});

test('index gate detects links, submodules and unresolved stages without reading Git blobs', () => {
    const oid = '1'.repeat(40);
    const entries = parseIndex(Buffer.from(`120000 ${oid} 0\tassets/hesta-identity.css\0` + `160000 ${oid} 0\tdependency\0` + `100644 ${oid} 2\tserver.js\0`));
    const result = auditIndex(entries);
    assert.equal(result.unsafeEntries.length, 3); assert.equal(result.cleanForRelease, false);
    assert.equal(auditIndex(parseIndex(Buffer.from(`100644 ${oid} 0\tserver.js\0`))).cleanForRelease, true);
    assert.throws(() => parseIndex(Buffer.from('malformed\0')), /metadata/);
});

test('removal classification refuses code and unreviewed paths and preserves the approved sources', () => {
    assert.equal(new Set(LEGACY).size, LEGACY.length);
    for (const name of [...LEGACY, ...FAKE_PATHS]) assert(category(name));
    for (const name of ['server.js', 'assets/hesta-identity.css', 'assets/fixtures/types_sample.json', 'assets/new-private.json', 'assets/icons/code.js']) assert.throws(() => category(name), /review/);
});

test('explicit cached removal is exercised only on a synthetic repository with its own private backup, without commit or remote', async () => {
    const s = createSandbox();
    try {
        const repo = path.join(s.root, 'synthetic-git'); fs.mkdirSync(repo);
        const env = { PATH: process.env.PATH, Path: process.env.Path, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
            HOME: path.join(s.root, 'home'), USERPROFILE: path.join(s.root, 'home'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(s.root, 'empty.gitconfig'), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
        fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
        const git = args => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: repo, env, windowsHide: true, encoding: 'utf8' });
        git(['init', '--quiet']); assert.equal(git(['remote']).trim(), '');
        const write = (name, bytes) => { const target = path.join(repo, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }); };
        for (const name of FAKE_PATHS) write(name, Buffer.from('SYNTHETIC-ONLY:' + name));
        const keep = ['server.js', 'assets/hesta-identity.css', 'assets/fixtures/README.md', 'assets/fixtures/locations_sample.json', 'assets/fixtures/types_sample.json'];
        for (const name of keep) write(name, name.endsWith('.json') ? '{}' : 'SYNTHETIC CODE/EXAMPLE');
        const nul = path.join(s.root, 'synthetic-initial.nul'); fs.writeFileSync(nul, [...FAKE_PATHS, ...keep].join('\0') + '\0');
        git(['--literal-pathspecs', 'add', `--pathspec-from-file=${nul}`, '--pathspec-file-nul']); // Fake bytes only, no commit.
        write('.gitignore', fs.readFileSync(path.join(SOURCE_ROOT, '.gitignore'))); git(['add', '--', '.gitignore']); keep.push('.gitignore');
        const backup = path.join(s.root, 'synthetic-private-backup'); fs.mkdirSync(backup, { mode: 0o700 });
        const metadata = {}, hashes = {};
        for (const [i, name] of FAKE_PATHS.entries()) { metadata[name] = localMetadata(repo, name); hashes[name] = hash(fs.readFileSync(path.join(repo, name))); fs.copyFileSync(path.join(repo, name), path.join(backup, `${i}.fixture`), fs.constants.COPYFILE_EXCL); }
        fs.mkdirSync(path.join(repo, 'test-results')); const output = path.join(repo, 'test-results', 'plan');
        const indexBefore = hash(fs.readFileSync(path.join(repo, '.git/index')));
        const result = prepare(repo, output, { env, legacy: FAKE_PATHS });
        assert.equal(result.proposedRemovals, FAKE_PATHS.length); assert.equal(result.indexChanged, false); assert.equal(result.backupVerified, false);
        assert.equal(hash(fs.readFileSync(path.join(repo, '.git/index'))), indexBefore);
        const command = JSON.parse(fs.readFileSync(path.join(output, 'simulation.json'))).commandNotExecuted;
        assert(command.args.includes('--cached')); assert(command.args.includes('--literal-pathspecs')); assert(!command.args.includes('--force'));
        git(command.args);
        const after = readIndex(repo, env); assert.equal(auditIndex(after).cleanForRelease, true); assert.deepEqual(after.map(e => e.path).sort(), keep.sort());
        for (const [i, name] of FAKE_PATHS.entries()) { assert.deepEqual(localMetadata(repo, name), metadata[name]); assert.equal(hash(fs.readFileSync(path.join(repo, name))), hashes[name]); assert.equal(hash(fs.readFileSync(path.join(backup, `${i}.fixture`))), hashes[name]); }
        const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], { cwd: repo, env, input: Buffer.from([...FAKE_PATHS, ...keep].join('\0') + '\0') }).toString('utf8').split('\0').filter(Boolean);
        for (const name of FAKE_PATHS) assert(ignored.includes(name), name);
        for (const name of keep) assert(!ignored.includes(name), name);
        assert.equal(git(['remote']).trim(), '');
        assert(!fs.existsSync(path.join(repo, '.git/refs/heads/master'))); // No synthetic commit either.
    } finally { removeSandbox(s.root, s.token); }
});
