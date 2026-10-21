const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JsonStore, initialize, names } = require('../../server/storage/jsonStore');
const { configuration, loadExplicitSecrets } = require('../../server/storage/paths');
const { createSessions } = require('../../server/storage/sessions');
const { authConfiguration } = require('../../server/storage/authConfig');
const { main: storageCommand } = require('../../tools/storage');
if (!process.env.CARTE_TEST_ROOT || process.env.CARTE_TEST_PROCESS !== 'runner') throw new Error('Use npm run test:storage');
const root = process.env.CARTE_TEST_ROOT;
const key = 'synthetic-session-key-for-storage-tests-only';
const user = { id: 'manual:synthetic', role: 'admin', unknownLegacyField: { keep: true } };
async function fresh(options) {
    const parent = fs.mkdtempSync(path.join(root, 'tmp', 'storage-'));
    const directory = path.join(parent, 'data');
    await initialize(directory);
    const store = new JsonStore(directory, options);
    await store.open();
    return store;
}
const sessionOptions = { secret: key, ttl: 600_000 };
const cookie = signed => ({ headers: { cookie: `map_session=${encodeURIComponent(signed)}` } });

test('all registered stores support strict round trips, preservation and restart', async () => {
    const store = await fresh();
    try {
        for (const name of names) assert.deepEqual(await store.read(name), JSON.parse(fs.readFileSync(store.file(name))));
        await store.write('users', { legacyMetadata: 'preserved', users: [user] });
        assert.deepEqual(await store.read('users'), { legacyMetadata: 'preserved', users: [user] });
        assert.equal(fs.existsSync(store.journalPath), false);
    } finally { await store.close(); }
    const restarted = new JsonStore(store.directory);
    await restarted.open();
    try { assert.equal((await restarted.read('users')).users[0].role, 'admin'); }
    finally { await restarted.close(); }
});

test('permissions v1 preparation is explicit, idempotent and preserves all historical bytes', async () => {
    const { main: migrate } = require('../../tools/migratePermissions');
    const store = await fresh();
    await store.write('annotations', [{ id: 'historical', scope: 'party', unknown: { preserved: true }, expiresAt: '2000-01-01' }]);
    await store.close();
    const originals = new Map(names.filter(name => name !== 'permissions').map(name => [name, fs.readFileSync(store.file(name))]));
    // Only a test-owned, synthetic permissions file is removed to simulate the v0 schema.
    fs.unlinkSync(store.file('permissions'));
    await assert.rejects(new JsonStore(store.directory).open(), { code: 'E_STORAGE_MISSING' });
    const env = { ...process.env, CARTE_DATA_DIR: store.directory };
    assert.deepEqual(await migrate(['prepare-v1'], env), { version: 1, created: true });
    const first = fs.readFileSync(store.file('permissions'));
    assert.deepEqual(await migrate(['prepare-v1'], env), { version: 1, created: false });
    assert.deepEqual(fs.readFileSync(store.file('permissions')), first);
    for (const [name, bytes] of originals) assert.deepEqual(fs.readFileSync(store.file(name)), bytes, name);
    await store.open();
    try {
        const original = await store.read('permissions');
        assert.equal(original.version, 1);
        assert.deepEqual(original.managedGroups, {});
        assert(Object.values(original.resources).every(entries => !Object.keys(entries).length));
        for (const invalid of [{ ...original, version: 2 }, { ...original, revision: -1 }, { ...original, managedGroups: { invalid: true } }]) {
            await assert.rejects(store.write('permissions', invalid), { code: 'E_STORAGE_INVALID' });
            assert.deepEqual(fs.readFileSync(store.file('permissions')), first);
        }
    } finally { await store.close(); }
    fs.writeFileSync(store.file('permissions'), '{corrupt');
    await assert.rejects(migrate(['prepare-v1'], env), { code: 'E_STORAGE_CORRUPT' });
    assert.equal(fs.readFileSync(store.file('permissions'), 'utf8'), '{corrupt');
});

test('missing, corrupt, invalid and inaccessible files never become empty data', async () => {
    for (const [contents, expected] of [[null, 'E_STORAGE_MISSING'], ['{bad', 'E_STORAGE_CORRUPT'], ['{}', 'E_STORAGE_INVALID']]) {
        const store = await fresh();
        const target = store.file('users');
        try {
            if (contents === null) fs.unlinkSync(target); else fs.writeFileSync(target, contents);
            await assert.rejects(store.read('users'), { code: expected });
            await assert.rejects(store.write('users', [user]), { code: expected });
            if (contents !== null) assert.equal(fs.readFileSync(target, 'utf8'), contents);
            else assert.equal(fs.existsSync(target), false);
        } finally { await store.close(); }
        const reopened = new JsonStore(store.directory);
        await assert.rejects(reopened.open(), { code: expected });
    }
    const store = await fresh();
    const original = fs.promises.readFile;
    try {
        fs.promises.readFile = async (...args) => {
            if (args[0] === store.file('users')) throw Object.assign(new Error('Synthetic EACCES'), { code: 'EACCES' });
            return original(...args);
        };
        await assert.rejects(store.write('users', [user]), { code: 'E_STORAGE_IO' });
    } finally { fs.promises.readFile = original; await store.close(); }
});

test('invalid roles and duplicate account IDs fail closed without rewriting the file', async () => {
    const store = await fresh();
    try {
        for (const users of [[{ id: 'x', role: 'owner' }], [user, user]]) await assert.rejects(store.write('users', users), { code: 'E_STORAGE_INVALID' });
        assert.deepEqual(await store.read('users'), []);
    } finally { await store.close(); }
});

test('virgin initialization is explicit, exclusive and refuses partial/existing installs', async () => {
    const store = await fresh();
    try {
        await store.write('users', [user]);
        const before = fs.readFileSync(store.file('users'));
        await assert.rejects(initialize(store.directory), { code: 'EEXIST' });
        assert.deepEqual(fs.readFileSync(store.file('users')), before);
    } finally { await store.close(); }
    fs.unlinkSync(store.file('planning'));
    await assert.rejects(initialize(store.directory), { code: 'EEXIST' });
    await assert.rejects(new JsonStore(store.directory).open(), { code: 'E_STORAGE_MISSING' });
});

test('the offline initializer creates only virgin roots and never copies fixtures', async () => {
    const parent = fs.mkdtempSync(path.join(root, 'tmp', 'virgin-'));
    const env = { ...process.env, CARTE_DATA_DIR: path.join(parent, 'data'), CARTE_LOG_DIR: path.join(parent, 'logs'), CARTE_MEDIA_DIR: path.join(parent, 'media') };
    await storageCommand(['init'], env);
    const store = new JsonStore(env.CARTE_DATA_DIR);
    await store.open();
    try {
        assert.deepEqual(await store.read('users'), []);
        assert.deepEqual(await store.read('groups'), []);
        assert.deepEqual(await store.read('annotations'), []);
    } finally { await store.close(); }
    await assert.rejects(storageCommand(['init'], env), /refuses existing/);
});

test('the offline bootstrap is explicit and can never alter existing accounts', async () => {
    const store = await fresh();
    await store.close();
    const env = { ...process.env, CARTE_DATA_DIR: store.directory };
    await storageCommand(['bootstrap-admin', '900000000000000099'], env);
    const before = fs.readFileSync(store.file('users'));
    await assert.rejects(storageCommand(['bootstrap-admin', '900000000000000098'], env), /empty user store/);
    assert.deepEqual(fs.readFileSync(store.file('users')), before);
    assert.equal(JSON.parse(before)[0].role, 'admin');
});

test('in-process concurrent read/modify/write operations cannot lose increments', async () => {
    const store = await fresh();
    try {
        await store.write('site-config', { count: 0 });
        await Promise.all(Array.from({ length: 24 }, () => store.run(async () => {
            const value = await store.read('site-config');
            value.count += 1;
            await store.write('site-config', value);
        })));
        assert.equal((await store.read('site-config')).count, 24);
    } finally { await store.close(); }
});

test('a second process is rejected while the first process holds the writer lease', async () => {
    const store = await fresh();
    try {
        const result = spawnSync(process.execPath, [path.join(__dirname, 'child.cjs'), store.directory, 'open'], { env: process.env, encoding: 'utf8', timeout: 20_000, windowsHide: true });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 23, result.stderr);
        assert.match(result.stdout, /E_STORAGE_LOCKED/);
        assert.deepEqual(await store.read('users'), []);
    } finally { await store.close(); }
});

test('exceptions before committing discard every staged write', async () => {
    const store = await fresh();
    try {
        await assert.rejects(store.transaction(async () => {
            await store.write('users', [user]);
            await store.write('groups', [{ id: 'synthetic' }]);
            throw new Error('Synthetic interruption');
        }), /Synthetic interruption/);
        assert.deepEqual(await store.read('users'), []);
        assert.deepEqual(await store.read('groups'), []);
    } finally { await store.close(); }
});

test('write and fsync failures before publishing the journal preserve the original bytes', async () => {
    for (const operation of ['writeFile', 'sync']) {
        const store = await fresh();
        const original = fs.promises.open;
        try {
            fs.promises.open = async (...args) => {
                const handle = await original(...args);
                if (!String(args[0]).includes('.pending.json.')) return handle;
                return {
                    writeFile: operation === 'writeFile' ? async () => { throw Object.assign(new Error('Synthetic disk full'), { code: 'ENOSPC' }); } : handle.writeFile.bind(handle),
                    sync: operation === 'sync' ? async () => { throw Object.assign(new Error('Synthetic sync error'), { code: 'EIO' }); } : handle.sync.bind(handle),
                    close: handle.close.bind(handle)
                };
            };
            await assert.rejects(store.write('users', [user]), { code: operation === 'writeFile' ? 'ENOSPC' : 'EIO' });
            assert.deepEqual(JSON.parse(fs.readFileSync(store.file('users'))), []);
            assert.equal(fs.existsSync(store.journalPath), false);
            await assert.rejects(store.read('users'), { code: 'E_STORAGE_UNAVAILABLE' });
        } finally { fs.promises.open = original; await store.close(); }
        const restarted = new JsonStore(store.directory);
        await restarted.open();
        try { assert.deepEqual(await restarted.read('users'), []); }
        finally { await restarted.close(); }
    }
});

test('legacy planning arrays and unknown annotation fields are kept without scope conversion', async () => {
    const store = await fresh();
    try {
        const planning = [{ id: 'synthetic-legacy', title: 'Fiction', date: '2026-10-17', responses: {} }];
        const annotations = [{ id: 'old-party', scope: 'party', unknownField: { untouched: true } }, { id: 'unknown', scope: 'unknown-scope' }];
        await store.write('planning', planning);
        await store.write('annotations', annotations);
        assert.deepEqual(await store.read('planning'), planning);
        assert.deepEqual(await store.read('annotations'), annotations);
        await assert.rejects(store.write('planning', { sessions: [{}] }), { code: 'E_STORAGE_INVALID' });
        assert.deepEqual(await store.read('planning'), planning);
    } finally { await store.close(); }
});

test('a failed rename preserves complete old JSON, blocks the writer and requires explicit recovery', async () => {
    const store = await fresh({ beforeRename(target) { if (target.endsWith('users.json')) throw new Error('Synthetic rename failure'); } });
    try {
        await assert.rejects(store.write('users', [user]), /Synthetic rename failure/);
        assert.deepEqual(JSON.parse(fs.readFileSync(store.file('users'))), []);
        await assert.rejects(store.read('users'), { code: 'E_STORAGE_UNAVAILABLE' });
        assert(fs.existsSync(store.journalPath));
    } finally { await store.close(); }
    const normal = new JsonStore(store.directory);
    await assert.rejects(normal.open(), { code: 'E_STORAGE_RECOVERY_REQUIRED' });
    await normal.acquire();
    try { await normal.recover(); } finally { await normal.close(); }
    await normal.open();
    try { assert.deepEqual(await normal.read('users'), [user]); } finally { await normal.close(); }
});

test('a real child-process interruption leaves a stale lease and recoverable multi-file intent', async () => {
    const store = await fresh();
    await store.close();
    const result = spawnSync(process.execPath, [path.join(__dirname, 'child.cjs'), store.directory, 'crash'], { env: process.env, encoding: 'utf8', timeout: 20_000, windowsHide: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 77, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(store.file('users'))).length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(store.file('groups'))), []);
    await assert.rejects(new JsonStore(store.directory).open(), { code: 'E_STORAGE_LOCKED' });
    const lock = JSON.parse(fs.readFileSync(store.lockPath));
    assert.equal(lock.pid, result.pid);
    const env = { ...process.env, CARTE_DATA_DIR: store.directory };
    await assert.rejects(storageCommand(['unlock', 'f'.repeat(48)], env), /identity mismatch/);
    await storageCommand(['unlock', lock.nonce], env);
    await assert.rejects(new JsonStore(store.directory).open(), { code: 'E_STORAGE_RECOVERY_REQUIRED' });
    await storageCommand(['recover'], env);
    await store.open();
    try { assert.equal((await store.read('groups'))[0].id, 'synthetic-group'); }
    finally { await store.close(); }
});

test('recovery refuses a third-party change or a corrupt target instead of overwriting it', async () => {
    for (const payload of ['[{"id":"unrelated","role":"user"}]', '{corrupt']) {
        const store = await fresh({ beforeRename(target) { if (target.endsWith('users.json')) throw new Error('Synthetic'); } });
        await assert.rejects(store.write('users', [user]));
        await store.close();
        fs.writeFileSync(store.file('users'), payload);
        const recovery = new JsonStore(store.directory);
        await recovery.acquire();
        try { await assert.rejects(recovery.recover()); }
        finally { await recovery.close(); }
        assert.equal(fs.readFileSync(store.file('users'), 'utf8'), payload);
        assert(fs.existsSync(store.journalPath));
    }
});

test('sessions are persisted before success, survive restart and revocations persist', async () => {
    const store = await fresh();
    await store.write('users', [user]);
    let sessions = createSessions(store, sessionOptions);
    const signed = await sessions.create({ userId: user.id, role: 'admin' });
    assert.equal(JSON.parse(fs.readFileSync(store.file('sessions'))).length, 1);
    await store.close();
    await store.open();
    sessions = createSessions(store, sessionOptions);
    try {
        assert.equal((await sessions.get(cookie(signed))).data.userId, user.id);
        await sessions.destroy(cookie(signed));
        assert.deepEqual(JSON.parse(fs.readFileSync(store.file('sessions'))), []);
        assert.equal(await sessions.get(cookie(signed)), null);
    } finally { await store.close(); }
});

test('missing secrets, forged/malformed cookies and role-only legacy sessions never authorize', async () => {
    const store = await fresh();
    try {
        const disabled = createSessions(store, { secret: '', ttl: 600_000 });
        await assert.rejects(disabled.create({ userId: user.id }));
        const sessions = createSessions(store, sessionOptions);
        for (const signed of ['x.y', 'x.' + 'f'.repeat(64), '%E0%A4%A']) assert.equal(await sessions.get({ headers: { cookie: `map_session=${signed}` } }), null);
        await store.write('sessions', [{ id: 'legacy', role: 'admin', expiresAt: Date.now() + 60_000 }]);
        assert.equal(await sessions.get(cookie(sessions.sign('legacy'))), null);
        assert.equal((await store.read('sessions')).length, 1);
        await store.write('sessions', [{ id: 'expired', userId: user.id, expiresAt: 1 }]);
        assert.equal(await sessions.get(cookie(sessions.sign('expired'))), null);
    } finally { await store.close(); }
});

test('session failures propagate without acknowledgement or reset', async () => {
    const store = await fresh();
    try {
        await store.write('users', [user]);
        fs.writeFileSync(store.file('sessions'), '{bad');
        const sessions = createSessions(store, sessionOptions);
        await assert.rejects(sessions.create({ userId: user.id }), { code: 'E_STORAGE_CORRUPT' });
        await assert.rejects(sessions.destroy(cookie(sessions.sign('synthetic'))), { code: 'E_STORAGE_CORRUPT' });
        assert.equal(fs.readFileSync(store.file('sessions'), 'utf8'), '{bad');
    } finally { await store.close(); }
});

test('path configuration has no default data path or implicit environment loading', () => {
    assert.throws(() => configuration({}), /explicit absolute/);
    const env = { ...process.env };
    assert.throws(() => configuration({ ...env, CARTE_PUBLIC_DIR: env.CARTE_DATA_DIR }), /separate/);
    assert.throws(() => configuration({ ...env, CARTE_DATA_DIR: path.join(env.CARTE_PUBLIC_DIR, 'data') }), /separate/);
    assert.throws(() => configuration({ ...env, CARTE_ENV_FILE: path.join(root, '.env') }), /forbidden/);
    assert.equal(loadExplicitSecrets(configuration(env), {}), undefined);
});

test('invalid OAuth/signing configurations fail closed; no development key is supplied', () => {
    assert.equal(authConfiguration({}).secret, '');
    assert.equal(authConfiguration({}).discordEnabled, false);
    assert.equal(authConfiguration({ DISCORD_CLIENT_ID: 'synthetic' }).invalid, true);
    assert.equal(authConfiguration({ SESSION_SECRET: 'short' }).invalid, true);
    assert.equal(authConfiguration({ DISCORD_API_ORIGIN: 'https://example.invalid' }).invalid, true);
    assert.equal(authConfiguration({ SESSION_SECRET: key }).invalid, false);
});

test('POSIX private modes are enforced; Windows reports its ACL verification limit', { skip: process.platform === 'win32' ? 'NTFS ACLs require independent Linux/host verification; injected EACCES is tested separately' : false }, async () => {
    const store = await fresh();
    try {
        assert.equal(fs.statSync(store.directory).mode & 0o077, 0);
        assert.equal(fs.statSync(store.file('users')).mode & 0o077, 0);
        fs.chmodSync(store.file('users'), 0o644);
        await assert.rejects(store.read('users'), { code: 'E_STORAGE_PERMISSIONS' });
    } finally { fs.chmodSync(store.file('users'), 0o600); await store.close(); }
});
