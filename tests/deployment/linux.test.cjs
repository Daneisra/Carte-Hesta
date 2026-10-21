const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { createSandbox, removeSandbox, SOURCE_ROOT } = require('../support/sandbox.cjs');
const { startIsolatedServer } = require('../../tools/devServerWithStub');
const { build, scan } = require('../../tools/deployment/release');
const { syncStage } = require('../../tools/deployment/stage');
const { readPlain, digest } = require('../../server/publication/files');
const linux = { skip: process.platform !== 'linux' ? 'Requires isolated Linux with native nginx and rsync; not validated on Windows' : false };
const REV = 'b'.repeat(40);
function request(port, target, token, method = 'GET') {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: target, method, agent: false, headers: { Connection: 'close' } }, res => {
            let text = ''; res.on('data', b => { text += b; }); res.on('end', () => { if (token && res.headers['x-carte-test-token'] !== token) reject(Error('Wrong Nginx process identity')); else resolve({ status: res.statusCode, text, headers: res.headers }); });
        }); req.setTimeout(5000, () => req.destroy(Error('Loopback test deadline'))); req.on('error', reject); req.end();
    });
}
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }

test('native rsync --delete stays inside a verified disposable stage and preserves all persistent sentinels', linux, async () => {
    const s = createSandbox();
    try {
        const env = { PATH: '/usr/bin:/bin', HOME: path.join(s.root, 'home'), LANG: 'C.UTF-8' };
        assert.equal(spawnSync('rsync', ['--version'], { env }).status, 0, 'rsync must be installed');
        const out = path.join(s.root, 'release'), info = build(SOURCE_ROOT, out, REV), stage = path.join(s.root, 'stage');
        syncStage(out, stage, REV, info.sha256);
        const sentinels = [s.data, s.media, s.logs, path.join(s.root, 'secrets'), path.join(s.root, 'backups')];
        for (const root of sentinels) { fs.mkdirSync(root, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(root, 'SYNTHETIC-SENTINEL'), 'fixture-only', { mode: 0o600 }); }
        const hashes = roots => roots.map(root => scan(root).map(n => [n, digest(readPlain(path.join(root, n)))]));
        const before = hashes(sentinels);
        for (let i = 0; i < 2; i++) {
            fs.writeFileSync(path.join(stage, 'app/server/obsolete.js'), '// obsolete');
            // Both operands are created above, inside our owned laboratory; never use a supplied destination.
            const result = spawnSync('rsync', ['-a', '--delete', '--safe-links', '--exclude=/.carte-code-stage.json', out + '/', stage + '/'], { env, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr); assert(!fs.existsSync(path.join(stage, 'app/server/obsolete.js'))); assert.deepEqual(hashes(sentinels), before);
            syncStage(out, stage, REV, info.sha256);
        }
    } finally { removeSandbox(s.root, s.token); }
});

test('native Nginx maintains 503, then proxies pages, OAuth, ACL media, negative paths and SSE to isolated Node', linux, async () => {
    const s = createSandbox(); let app, child, sse;
    try {
        const env = { PATH: '/usr/sbin:/usr/bin:/bin', HOME: path.join(s.root, 'home'), LANG: 'C.UTF-8' };
        assert.equal(spawnSync('nginx', ['-v'], { env }).status, 0, 'nginx must be installed');
        app = await startIsolatedServer(s);
        const port = await freePort(), gate = path.join(s.root, 'OPEN_APPROVED'), conf = path.join(s.root, 'nginx.conf');
        const routing = fs.readFileSync(path.join(SOURCE_ROOT, 'ops/nginx-routing.conf'), 'utf8')
            .replaceAll('/srv/cartehesta/public', s.publicDir).replaceAll('/run/cartehesta-gates/OPEN_APPROVED', gate).replaceAll('127.0.0.1:4173', `127.0.0.1:${app.port}`);
        fs.writeFileSync(conf, `pid ${s.root}/nginx.pid; error_log ${s.root}/nginx-error.log warn; events {} http { access_log off; client_body_temp_path ${s.root}/body; proxy_temp_path ${s.root}/proxy; server { listen 127.0.0.1:${port}; add_header X-Carte-Test-Token ${s.token} always; ${routing} } }`);
        const check = spawnSync('nginx', ['-t', '-c', conf, '-p', s.root], { env, encoding: 'utf8' }); assert.equal(check.status, 0, check.stderr);
        child = spawn('nginx', ['-c', conf, '-p', s.root, '-g', 'daemon off;'], { env, stdio: ['ignore', 'ignore', 'pipe'] }); let errors = ''; child.stderr.on('data', b => { errors += b; });
        const deadline = Date.now() + 5000;
        while (true) {
            try { const res = await request(port, '/', s.token); assert.equal(res.status, 503); break; }
            catch (error) { if (Date.now() >= deadline || child.exitCode !== null) throw Error(errors || error.message); await new Promise(r => setTimeout(r, 25)); }
        }
        fs.writeFileSync(gate, 'synthetic local recipe only');
        for (const page of ['/', '/map/', '/timeline/', '/planning/', '/changelog/', '/geek-unchained/']) assert.equal((await request(port, page, s.token)).status, 200, page);
        for (const target of ['/server.js', '/.env', '/.git/config', '/tools/storage.js', '/data/private/users.json', '/assets/users.json', '/assets/missing.png', '/js/missing.js', '/assets/%2e%2e/users.json', '/assets/%2fusers.json']) {
            const res = await request(port, target, s.token); assert([400, 403, 404].includes(res.status), target + ':' + res.status); assert(!res.text.includes('synthetic-player-token'));
        }
        assert.equal((await request(port, '/api/admin/users', s.token)).status, 401);
        assert.equal((await request(port, '/auth/discord/login', s.token)).status, 302);
        assert.equal((await request(port, '/auth/session', s.token)).status, 200);
        assert.equal((await request(port, '/assets/locations.json', s.token)).status, 200);
        assert.equal((await request(port, '/assets/users.json', s.token, 'HEAD')).text, '');
        await new Promise((resolve, reject) => {
            sse = http.get({ hostname: '127.0.0.1', port, path: '/api/events/stream', agent: false }, res => {
                assert.equal(res.statusCode, 200); assert(res.headers['content-type'].includes('text/event-stream'));
                res.once('data', () => { res.destroy(); resolve(); });
            }); sse.setTimeout(5000, () => sse.destroy(Error('SSE first-byte deadline'))); sse.once('error', reject);
        });
        fs.unlinkSync(gate); assert.equal((await request(port, '/api/locations', s.token)).status, 503);
    } finally {
        sse?.destroy();
        if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); }
        await app?.stop(); removeSandbox(s.root, s.token);
    }
});
