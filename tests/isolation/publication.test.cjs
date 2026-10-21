const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createSandbox, removeSandbox, isWithin } = require('../support/sandbox.cjs');
const { startIsolatedServer } = require('../../tools/devServerWithStub');
const { STATIC_FILES } = require('../../server/publication/files');
const { PNG } = require('../fixtures/application.cjs');
const CANARY = 'SYNTHETIC-PRIVATE-MATERIAL-NEVER-PUBLISH';
function request(app, target, { method = 'GET', admin = false, payload } = {}) {
    return new Promise((resolve, reject) => {
        const headers = { Connection: 'close' };
        if (admin) headers.Authorization = 'Bearer synthetic-admin-token';
        const bytes = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
        if (bytes) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = bytes.length; }
        // Raw request target: URL normalization must not erase attack sequences before the server sees them.
        const req = http.request({ hostname: '127.0.0.1', port: app.port, path: target, method, headers, agent: false }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks), json() { return JSON.parse(this.bytes); } }));
        });
        req.setTimeout(5000, () => req.destroy(new Error('Synthetic HTTP deadline')));
        req.on('error', reject); if (bytes) req.write(bytes); req.end();
    });
}
async function lab(run, prepare) {
    const sandbox = createSandbox(); let app;
    try {
        await prepare?.(sandbox);
        app = await startIsolatedServer(sandbox);
        await run(app, sandbox);
        await app.stop();
        assert.equal(fs.existsSync(path.join(sandbox.data, 'locks/writer.lock')), false);
        assert.deepEqual(fs.readdirSync(sandbox.root).filter(name => /^boundary-/.test(name)), []);
    } finally { if (app && !app.stopping) await app.stop(); removeSandbox(sandbox.root, sandbox.token); }
}

test('HTTP GET/HEAD reject every sensitive category even when planted inside public/', async () => {
    const denied = ['.env', '.env.production', '.git/config', 'server.js', 'server/routes/auth.js', 'assets/users.json', 'assets/groups.json', 'assets/annotations.json', 'assets/planning.json', 'assets/logs/sessions.json', 'logs/audit.jsonl', 'secret.env', 'backup.bak', 'scratch.tmp', 'tests/fixtures/users.json', 'docs/security/report.md', 'tools/storage.js', 'data/transactions/pending.json', 'data/locks/writer.lock', '.public-manifest.json', 'assets/.published-media.json'];
    await lab(async app => {
        for (const relative of denied) for (const method of ['GET', 'HEAD']) {
            const result = await request(app, '/' + relative, { method });
            assert([400, 404].includes(result.status), `${method} ${relative}: ${result.status}`);
            assert(!result.bytes.includes(Buffer.from(CANARY)));
            assert(!result.bytes.toString('utf8').includes('<!DOCTYPE html>'));
            assert.equal(result.headers['x-content-type-options'], 'nosniff');
            if (method === 'HEAD') assert.equal(result.bytes.length, 0);
        }
    }, sandbox => {
        for (const relative of denied.filter(name => !name.endsWith('manifest.json'))) {
            const target = path.join(sandbox.publicDir, relative);
            assert(isWithin(sandbox.publicDir, target));
            fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, CANARY);
        }
    });
});

test('encoded traversal, absolute targets and Windows separators fail before file access', async () => {
    await lab(async app => {
        const paths = ['/../server.js', '/%2e%2e/server.js', '/%252e%252e/server.js', '/assets/%2e%2e/%2e%2e/server.js', '/assets%2fusers.json', '/assets%5cusers.json', '/assets/..\\users.json', '/C:/private/users.json', '//private/users.json', '/%00', '/%ZZ', '/.git/config'];
        for (const target of paths) for (const method of ['GET', 'HEAD']) assert.equal((await request(app, target, { method })).status, 400, target);
        assert.notEqual((await request(app, 'http://example.invalid/server.js')).status, 200);
    });
});

test('all approved scripts/styles and six page URL forms load with explicit MIME types', async () => {
    await lab(async app => {
        for (const relative of STATIC_FILES) {
            const get = await request(app, '/' + relative), head = await request(app, '/' + relative, { method: 'HEAD' });
            assert.equal(get.status, 200, relative); assert.equal(head.status, 200, relative);
            assert.equal(head.bytes.length, 0); assert.equal(head.headers['content-length'], get.headers['content-length']);
            assert.notEqual(get.headers['content-type'], 'application/octet-stream');
        }
        for (const page of ['/', '/map', '/map/', '/timeline/', '/planning/', '/changelog/', '/geek-unchained/']) assert.equal((await request(app, page)).status, 200, page);
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await request(app, '/js/main.js', { method })).status, 405);
    });
});

test('locations fallback/search project explicitly published fixtures and preserve administrative access', async () => {
    await lab(async app => {
        for (const target of ['/assets/locations.json', '/api/locations/search']) {
            assert.equal((await request(app, target)).status, 200);
            assert(!(await request(app, target)).bytes.includes(Buffer.from('Récit synthétique.')));
            assert.equal((await request(app, target, { admin: true })).status, 200);
        }
        assert.equal((await request(app, '/assets/locations.json', { method: 'HEAD' })).status, 200);
        for (const target of ['/assets/types.json', '/assets/timeline.json', '/assets/site-config.json']) {
            assert.equal((await request(app, target)).status, 200);
            assert.equal((await request(app, target, { method: 'HEAD' })).bytes.length, 0);
            assert.equal((await request(app, target, { method: 'POST' })).status, 405);
        }
    });
});

test('public JSON aliases and timeline API never serialize hidden, unknown-scope or unknown fields', async () => {
    await lab(async app => {
        for (const target of ['/assets/timeline.json', '/api/timeline', '/assets/site-config.json', '/assets/types.json']) {
            const result = await request(app, target); assert.equal(result.status, 200); assert(!result.bytes.includes(Buffer.from(CANARY)), target);
        }
    }, sandbox => {
        for (const [file, mutate] of [
            ['timeline', document => { document.privateNote = CANARY; document.entries[0].unknown = CANARY; document.entries.push({ id: 'private', visible: false, title: CANARY }, { id: 'legacy', title: CANARY }, { id: 'gm', visible: true, scope: 'GM', title: CANARY }); }],
            ['site-config', document => { document.secret = CANARY; document.home.privateNote = CANARY; document.community.proof.guildId = CANARY; }],
            ['types', document => { document.Town.privateNote = CANARY; }]
        ]) {
            const target = path.join(sandbox.data, 'content', file + '.json'); const document = JSON.parse(fs.readFileSync(target)); mutate(document); fs.writeFileSync(target, JSON.stringify(document));
        }
    });
});

test('SSE remains open while subsequent stored reads and mutations complete', async () => {
    await lab(async app => {
        let stream;
        const req = http.get({ hostname: '127.0.0.1', port: app.port, path: '/api/events/stream', agent: false }, res => { stream = res; });
        req.setTimeout(5000, () => req.destroy(new Error('SSE test deadline')));
        try {
            await new Promise((resolve, reject) => { req.once('error', reject); req.once('response', res => { res.once('data', resolve); res.on('error', reject); }); });
            assert(!stream.complete);
            assert.equal((await request(app, '/api/timeline')).status, 200);
            assert.equal((await request(app, '/api/admin/users', { method: 'POST', admin: true, payload: { username: 'Synthetic SSE parallel account', role: 'user' } })).status, 201);
            assert(!stream.complete);
        } finally { stream?.destroy(); req.destroy(); }
    });
});

test('archive HTTP includes exactly approved media and keeps authorization/method/HEAD checks', async () => {
    await lab(async (app, sandbox) => {
        assert.equal((await request(app, '/api/admin/assets.zip')).status, 401);
        assert.equal((await request(app, '/api/admin/assets.zip', { method: 'POST', admin: true })).status, 405);
        const get = await request(app, '/api/admin/assets.zip', { admin: true }), head = await request(app, '/api/admin/assets.zip', { admin: true, method: 'HEAD' });
        assert.equal(get.status, 200); assert.equal(get.headers['content-type'], 'application/zip'); assert.equal(head.status, 200); assert.equal(head.bytes.length, 0);
        assert.equal(Number(get.headers['content-length']), get.bytes.length); assert.equal(head.headers['content-length'], get.headers['content-length']);
        const names = []; let offset = 0;
        while (get.bytes.readUInt32LE(offset) === 0x04034b50) {
            const size = get.bytes.readUInt32LE(offset + 18), length = get.bytes.readUInt16LE(offset + 26);
            names.push(get.bytes.toString('utf8', offset + 30, offset + 30 + length)); offset += 30 + length + size;
        }
        const index = JSON.parse(fs.readFileSync(path.join(sandbox.media, '.published-media.json')));
        assert.deepEqual(names.sort(), Object.keys(index.entries).map(name => name.slice(7)).sort());
        assert(!get.bytes.includes(Buffer.from(CANARY)));
        assert(names.includes('map.png')); assert(names.includes('logo.png'));
    }, sandbox => {
        for (const relative of ['users.json', 'sessions.json', '.env', 'pending.json', 'private-not-approved.png']) fs.writeFileSync(path.join(sandbox.media, relative), CANARY);
    });
});

test('uploads reject active/disguised data and serve only validated registered bytes', async () => {
    await lab(async (app, sandbox) => {
        const payload = { type: 'image', filename: 'synthetic-http.png', data: PNG.toString('base64') };
        for (const change of [{ filename: '../private.png' }, { filename: 'active.svg' }, { data: Buffer.from('<html>synthetic</html>').toString('base64') }]) assert.equal((await request(app, '/api/upload', { method: 'POST', admin: true, payload: { ...payload, ...change } })).status, 400);
        const result = await request(app, '/api/upload', { method: 'POST', admin: true, payload }); assert.equal(result.status, 200);
        const target = '/' + result.json().path;
        assert.equal((await request(app, target)).status, 404);
        const get = await request(app, target, { admin: true }), head = await request(app, target, { method: 'HEAD', admin: true });
        assert.equal(get.status, 200); assert.equal(get.headers['content-type'], 'image/png'); assert.equal(head.status, 200); assert.equal(head.bytes.length, 0); assert.deepEqual(get.bytes, PNG);
        fs.writeFileSync(path.join(sandbox.media, 'images', 'synthetic-unlisted.png'), PNG);
        assert.equal((await request(app, '/assets/images/synthetic-unlisted.png')).status, 404);
        fs.writeFileSync(path.join(sandbox.media, 'images', 'synthetic-http.png'), CANARY);
        assert.equal((await request(app, target)).status, 404);
    });
});

test('a public directory junction cannot escape to an owned synthetic private directory', async t => {
    const other = createSandbox();
    try {
        await lab(async (app, sandbox) => {
            const original = path.join(sandbox.publicDir, 'js'), saved = path.join(sandbox.publicDir, 'js-owned-saved');
            assert(isWithin(sandbox.root, original) && isWithin(sandbox.root, saved));
            fs.renameSync(original, saved);
            try {
                try { fs.symlinkSync(other.app, original, process.platform === 'win32' ? 'junction' : 'dir'); }
                catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Junction creation unavailable'); return; } throw error; }
                assert.equal((await request(app, '/js/server.js')).status, 404);
                assert.equal((await request(app, '/js/main.js')).status, 404);
            } finally { if (fs.existsSync(original)) fs.unlinkSync(original); fs.renameSync(saved, original); }
        });
    } finally { removeSandbox(other.root, other.token); }
});

test('a hard-linked approved file is refused even when its bytes still match the artifact', async t => {
    await lab(async (app, sandbox) => {
        const original = path.join(sandbox.publicDir, 'js', 'main.js'), link = path.join(sandbox.logs, 'synthetic-hardlink.js');
        assert(isWithin(sandbox.root, original) && isWithin(sandbox.root, link));
        try {
            try { fs.linkSync(original, link); }
            catch (error) { if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) { t.skip('Hard links unavailable'); return; } throw error; }
            assert.equal((await request(app, '/js/main.js')).status, 404);
        } finally { if (fs.existsSync(link)) fs.unlinkSync(link); }
        assert.equal((await request(app, '/js/main.js')).status, 200);
    });
});
