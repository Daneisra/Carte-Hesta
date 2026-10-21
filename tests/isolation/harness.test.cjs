const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { createSandbox, removeSandbox, verifySandbox, cleanEnvironment, SOURCE_ROOT, installFirefoxUpdatePolicy } = require('../support/sandbox.cjs');
const fixtures = require('../fixtures/application.cjs');
const { storeFile } = require('../../server/storage/jsonStore');

function probe(sandbox, code, extra = {}) {
    const result = spawnSync(process.execPath, ['-e', code], {
        cwd: sandbox.app, env: cleanEnvironment(sandbox, { CARTE_TEST_PROCESS: 'app', ...extra }),
        encoding: 'utf8', timeout: 15_000, windowsHide: true
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result;
}

test('staging copies only code, initializes all synthetic stores and never copies environment or original assets', () => {
    const sandbox = createSandbox();
    try {
        const copied = JSON.parse(fs.readFileSync(path.join(sandbox.root, 'copied-code.json')));
        assert(copied.includes('server.js'));
        assert(copied.every(file => !file.startsWith('assets') || file.replaceAll('\\', '/') === 'assets/hesta-identity.css'));
        assert(!fs.existsSync(path.join(sandbox.app, '.env')));
        assert(!fs.existsSync(path.join(sandbox.app, '.git')));
        for (const [name, data] of Object.entries(fixtures.stores)) {
            assert.deepEqual(JSON.parse(fs.readFileSync(storeFile(sandbox.data, name === 'logs/sessions.json' ? 'sessions' : name.replace(/\.json$/, '')))), data);
        }
        assert.equal(fs.readFileSync(path.join(sandbox.app, 'server.js'), 'utf8'), fs.readFileSync(path.join(SOURCE_ROOT, 'server.js'), 'utf8'));
    } finally { removeSandbox(sandbox.root, sandbox.token); }
});

test('two runs have independent stores and cleanup rejects foreign paths and wrong tokens', () => {
    const first = createSandbox();
    const second = createSandbox();
    try {
        assert.notEqual(first.root, second.root);
        fs.writeFileSync(storeFile(first.data, 'users'), '[]');
        assert.deepEqual(JSON.parse(fs.readFileSync(storeFile(second.data, 'users'))), fixtures.users);
        assert.throws(() => removeSandbox(SOURCE_ROOT, first.token));
        assert.throws(() => removeSandbox(first.root, 'wrong-token'));
        verifySandbox(first.root, first.token);
    } finally {
        removeSandbox(first.root, first.token);
        removeSandbox(second.root, second.token);
    }
});

test('ephemeral Firefox update policy is restrictive, verified and never overwrites an existing policy', () => {
    const sandbox = createSandbox();
    try {
        const browser = path.join(sandbox.root, 'synthetic-firefox');
        fs.mkdirSync(browser);
        assert.deepEqual(installFirefoxUpdatePolicy(browser, 'http://127.0.0.1:12345'), { updateDisabled: true, existingPolicyOverwritten: false });
        const policy = path.join(browser, 'distribution', 'policies.json');
        const before = fs.readFileSync(policy);
        assert.deepEqual(JSON.parse(before), { policies: { DisableAppUpdate: true, AppUpdateURL: 'http://127.0.0.1:12345/_firefox/updates.xml' } });
        assert.throws(() => installFirefoxUpdatePolicy(browser, 'http://127.0.0.1:12345'), { code: 'EEXIST' });
        assert.deepEqual(fs.readFileSync(policy), before);
        for (const origin of ['https://example.invalid', 'http://localhost:12345', 'http://127.0.0.1', 'http://user@127.0.0.1:12345', 'http://127.0.0.1:12345/private']) assert.throws(() => installFirefoxUpdatePolicy(browser, origin), /owned loopback/);
        assert.equal(cleanEnvironment(sandbox).MOZ_DISABLE_NONLOCAL_CONNECTIONS, '1');
    } finally { removeSandbox(sandbox.root, sandbox.token); }
});

test('environment is a positive list, ignoring inherited credentials, proxies and Node injections', () => {
    const sandbox = createSandbox();
    try {
        const env = cleanEnvironment(sandbox, {}, {
            PATH: 'synthetic-path', CI: 'true', ADMIN_API_TOKEN: 'poison', DISCORD_CLIENT_SECRET: 'poison',
            REMOTE_SYNC_URL: 'https://example.invalid', NODE_OPTIONS: '--require=poison',
            HTTP_PROXY: 'poison', HTTPS_PROXY: 'poison', PLAYWRIGHT_FIREFOX_POLICIES_JSON: 'poison', CARTE_TEST_ROOT: SOURCE_ROOT
        });
        for (const key of ['ADMIN_API_TOKEN', 'DISCORD_CLIENT_SECRET', 'REMOTE_SYNC_URL', 'HTTP_PROXY', 'HTTPS_PROXY']) assert.equal(env[key], undefined);
        assert.equal(env.CARTE_TEST_ROOT, sandbox.root);
        assert(env.NODE_OPTIONS.includes('processBoundary.cjs'));
        assert(!env.NODE_OPTIONS.includes('poison'));
        assert.equal(env.HOME, path.join(sandbox.root, 'home'));
        assert.equal(env.PLAYWRIGHT_FIREFOX_POLICIES_JSON, path.join(sandbox.root, 'tmp', 'distribution', 'policies.json'));
    } finally { removeSandbox(sandbox.root, sandbox.token); }
});

test('preloader refuses env files, out-of-app reads, external writes and sockets before I/O', () => {
    const sandbox = createSandbox();
    const other = createSandbox();
    try {
        fs.writeFileSync(path.join(sandbox.app, '.env'), 'SYNTHETIC_CANARY=not-a-secret');
        fs.writeFileSync(path.join(other.root, 'sentinel.json'), '{"canary":true}');
        const code = `
            const assert = require('node:assert/strict');
            const fs = require('node:fs');
            const net = require('node:net');
            const path = require('node:path');
            const boundary = require(${JSON.stringify(path.join(SOURCE_ROOT, 'tests/support/processBoundary.cjs'))});
            const blocked = fn => assert.throws(fn, { code: 'E_TEST_BOUNDARY' });
            blocked(() => fs.readFileSync(path.join(__dirname, '.env')));
            blocked(() => fs.readFileSync(${JSON.stringify(path.join(other.root, 'sentinel.json'))}));
            blocked(() => require(${JSON.stringify(path.join(other.root, 'sentinel.json'))}));
            blocked(() => fs.createReadStream(${JSON.stringify(path.join(other.root, 'sentinel.json'))}));
            blocked(() => fs.writeFileSync(${JSON.stringify(path.join(other.root, 'sentinel.json'))}, 'overwritten'));
            blocked(() => boundary.assertRead(path.join(process.env.CARTE_TEST_SOURCE_ROOT, 'assets/users.json')));
            blocked(() => boundary.assertConnection('example.invalid', 443));
            blocked(() => net.connect({ host: '127.0.0.1', port: 9 }));
            blocked(() => net.connect({ host: '203.0.113.1', port: 443 }));
            blocked(() => require('node:child_process').execFileSync('git', ['status']));
            (async () => {
                await assert.rejects(fs.promises.readFile(${JSON.stringify(path.join(other.root, 'sentinel.json'))}), { code: 'E_TEST_BOUNDARY' });
                const data = JSON.parse(fs.readFileSync(require('node:path').join(process.env.CARTE_DATA_DIR, 'private', 'users.json')));
                assert.equal(data[0].username, 'Test User');
            })().catch(error => { console.error(error); process.exitCode = 1; });
        `;
        probe(sandbox, code);
        assert.equal(fs.readFileSync(path.join(other.root, 'sentinel.json'), 'utf8'), '{"canary":true}');
    } finally {
        removeSandbox(sandbox.root, sandbox.token);
        removeSandbox(other.root, other.token);
    }
});

test('read/write containment follows real paths and rejects a synthetic junction escape', t => {
    const sandbox = createSandbox();
    const other = createSandbox();
    const link = path.join(sandbox.app, 'escape');
    try {
        try { fs.symlinkSync(other.app, link, process.platform === 'win32' ? 'junction' : 'dir'); }
        catch (error) {
            if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Link creation unavailable on this platform'); return; }
            throw error;
        }
        probe(sandbox, `
            const assert = require('node:assert/strict');
            const fs = require('node:fs');
            assert.throws(() => fs.readFileSync('escape/assets/users.json'), { code: 'E_TEST_BOUNDARY' });
            assert.throws(() => fs.writeFileSync('escape/assets/users.json', '[]'), { code: 'E_TEST_BOUNDARY' });
        `);
        assert.throws(() => removeSandbox(sandbox.root, sandbox.token));
    } finally {
        if (fs.existsSync(link)) fs.unlinkSync(link);
        removeSandbox(sandbox.root, sandbox.token);
        removeSandbox(other.root, other.token);
    }
});

test('direct Playwright and dev-server startup fail closed without starting an app', () => {
    const sandbox = createSandbox();
    try {
        const env = cleanEnvironment(sandbox);
        for (const key of Object.keys(env)) if (key.startsWith('CARTE_TEST_') || key === 'NODE_OPTIONS') delete env[key];
        const config = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(SOURCE_ROOT, 'playwright.config.js'))})`], { env, encoding: 'utf8', windowsHide: true });
        assert.notEqual(config.status, 0);
        assert.match(config.stderr, /Direct Playwright startup is disabled/);
        const server = spawnSync(process.execPath, [path.join(SOURCE_ROOT, 'tools/devServerWithStub.js')], { env, encoding: 'utf8', windowsHide: true });
        assert.notEqual(server.status, 0);
        assert.match(server.stderr, /Direct server startup is disabled/);
    } finally { removeSandbox(sandbox.root, sandbox.token); }
});

test('browser routing serves local pinned vendors, stubs embeds and refuses all other origins', async () => {
    const { installBrowserBoundary } = require('../support/playwright.cjs');
    let handler;
    const context = { route: async (_pattern, fn) => { handler = fn; }, addInitScript: async () => {} };
    const denied = [];
    await installBrowserBoundary(context, 'http://127.0.0.1:12345', denied);
    async function route(url) {
        let action;
        await handler({ request: () => ({ url: () => url }), continue: async () => { action = 'continue'; }, fulfill: async value => { action = value; }, abort: async () => { action = 'abort'; } });
        return action;
    }
    assert.equal(await route('http://127.0.0.1:12345/api/groups'), 'continue');
    assert((await route('https://unpkg.com/leaflet/dist/leaflet.js')).body.length > 1000);
    assert.equal((await route('https://www.youtube.com/embed/testVideo01')).contentType, 'text/html');
    assert.equal((await route('https://cdn.discordapp.com/embed/avatars/0.png')).contentType, 'image/png');
    assert.equal(await route('https://cdn.discordapp.com/avatars/unapproved.png'), 'abort');
    assert.equal(await route('https://example.invalid/private'), 'abort');
    assert.equal(await route('http://127.0.0.1:4173/api/profile'), 'abort');
    assert.equal(denied.length, 3);
});

test('all existing specs import the isolated fixture; no production JSON imports or reset hooks remain', () => {
    for (const directory of ['api', 'ui']) {
        for (const name of fs.readdirSync(path.join(SOURCE_ROOT, 'tests', directory)).filter(name => name.endsWith('.spec.js'))) {
            const text = fs.readFileSync(path.join(SOURCE_ROOT, 'tests', directory, name), 'utf8');
            assert(text.includes("require('../support/playwright.cjs')"), name);
            assert(!/require\([^\n]*assets\//.test(text), name);
            assert(!/(readFile|writeFile|unlink)\(/.test(text), name);
        }
    }
});

test('new server binds a distinct ephemeral port and stops without touching an occupied local server', async () => {
    const { startIsolatedServer } = require('../../tools/devServerWithStub');
    const sandbox = createSandbox();
    let hits = 0;
    const occupied = http.createServer((_req, res) => { hits += 1; res.end('synthetic unrelated server'); });
    await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
    let app;
    try {
        app = await startIsolatedServer(sandbox);
        assert.notEqual(app.port, occupied.address().port);
        assert.notEqual(app.port, app.stubPort);
        const policy = JSON.parse(fs.readFileSync(cleanEnvironment(sandbox).PLAYWRIGHT_FIREFOX_POLICIES_JSON));
        assert.equal(policy.policies.AppUpdateURL, 'http://127.0.0.1:' + app.stubPort + '/_firefox/updates.xml');
        const update = await new Promise((resolve, reject) => http.get(policy.policies.AppUpdateURL, response => {
            let body = ''; response.on('data', chunk => { body += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'], body }));
        }).on('error', reject));
        assert.deepEqual(update, { status: 200, type: 'application/xml', body: '<?xml version="1.0"?><updates/>' });
        assert.equal(hits, 0);
        await app.stop();
        assert(app.child.exitCode !== null || app.child.signalCode !== null);
        assert(occupied.listening);
        assert.equal(fs.readdirSync(sandbox.root).filter(name => name.startsWith('boundary-')).length, 0);
    } finally {
        if (app && !app.stopping) await app.stop();
        await new Promise(resolve => occupied.close(resolve));
        removeSandbox(sandbox.root, sandbox.token);
    }
});

test('Linux runner kernel probe is synthetic; app, private procfs, files and sockets stay denied', () => {
    const sandbox = createSandbox();
    try {
        const boundaryModule = JSON.stringify(path.join(SOURCE_ROOT, 'tests/support/processBoundary.cjs'));
        probe(sandbox, [
            "const assert = require('node:assert/strict'), fs = require('node:fs');",
            "Object.defineProperty(process, 'platform', { value: 'linux' });",
            'const boundary = require(' + boundaryModule + ');',
            "assert.equal(fs.readFileSync('/proc/version', 'utf8'), 'Linux version 0.0.0-cartehesta-synthetic\\n');",
            "assert.equal(fs.readFileSync('/proc/version').toString(), 'Linux version 0.0.0-cartehesta-synthetic\\n');",
            "for (const name of ['/proc/version', '/proc/self/environ', '/proc/self/cgroup', '/etc/shadow']) assert.throws(() => boundary.assertRead(name), { code: 'E_TEST_BOUNDARY' });",
            "assert.throws(() => boundary.assertRead(require('node:path').join(process.env.CARTE_TEST_SOURCE_ROOT, 'assets/users.json')), { code: 'E_TEST_BOUNDARY' });",
            "assert.throws(() => boundary.assertWrite('/proc/version'), { code: 'E_TEST_BOUNDARY' });",
            "assert.throws(() => boundary.assertConnection('example.invalid', 443), { code: 'E_TEST_BOUNDARY' });"
        ].join('\n'), { CARTE_TEST_PROCESS: 'runner' });
        probe(sandbox, [
            "const assert = require('node:assert/strict'), fs = require('node:fs');",
            "Object.defineProperty(process, 'platform', { value: 'linux' });",
            "assert.throws(() => fs.readFileSync('/proc/version', 'utf8'), { code: 'E_TEST_BOUNDARY' });"
        ].join('\n'));
    } finally { removeSandbox(sandbox.root, sandbox.token); }
});
