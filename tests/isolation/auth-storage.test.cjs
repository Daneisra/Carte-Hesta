const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createSandbox, removeSandbox } = require('../support/sandbox.cjs');
const { storeFile, names } = require('../../server/storage/jsonStore');
const { startIsolatedServer } = require('../../tools/devServerWithStub');
const { ADMIN_ID, DISCORD_ID, PNG } = require('../fixtures/application.cjs');

function request(app, pathname, { method = 'GET', body, cookie, admin = false } = {}) {
    assert(pathname.startsWith('/') && !pathname.startsWith('//'));
    return new Promise((resolve, reject) => {
        const headers = { Connection: 'close' };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
        }
        if (cookie) headers.Cookie = cookie;
        if (admin) headers.Authorization = 'Bearer synthetic-admin-token';
        const req = http.request(app.origin + pathname, { method, headers, agent: false }, res => {
            let text = '';
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
        });
        req.on('error', reject);
        if (body !== undefined) req.write(JSON.stringify(body));
        req.end();
    });
}
async function login(app) {
    const redirect = await request(app, '/auth/discord/login');
    assert.equal(redirect.status, 302);
    const state = new URL(redirect.headers.location).searchParams.get('state');
    const callback = await request(app, `/auth/discord/callback?code=synthetic&state=${state}`);
    assert.equal(callback.status, 302, callback.text);
    return callback.headers['set-cookie'][0].split(';')[0];
}
async function laboratory(run, overrides, prepare) {
    const sandbox = createSandbox();
    let app;
    try {
        await prepare?.(sandbox);
        app = await startIsolatedServer(sandbox, overrides);
        await run(app, sandbox);
        await app.stop();
        assert.equal(fs.existsSync(path.join(sandbox.data, 'locks', 'writer.lock')), false, 'graceful shutdown must release its own lease');
        assert.deepEqual(fs.readdirSync(sandbox.root).filter(name => /^boundary-/.test(name)), []);
    } finally {
        if (app && !app.stopping) await app.stop();
        removeSandbox(sandbox.root, sandbox.token);
    }
}

test('absent authentication configuration never grants admin; an app .env is not read', async () => {
    await laboratory(async app => {
        const session = await request(app, '/auth/session');
        assert.equal(session.status, 200);
        assert.equal(session.json().authenticated, false);
        assert.equal(session.json().role, 'guest');
        assert.equal((await request(app, '/api/admin/users')).status, 401);
        assert.equal((await request(app, '/auth/discord/login')).status, 503);
    }, { ADMIN_API_TOKEN: '', USER_API_TOKENS: '', SESSION_SECRET: '', DISCORD_CLIENT_ID: '', DISCORD_CLIENT_SECRET: '', DISCORD_REDIRECT_URI: '' }, sandbox => {
        fs.writeFileSync(path.join(sandbox.app, '.env'), 'ADMIN_API_TOKEN=synthetic-canary-never-read');
    });
});

test('partial OAuth or weak signing configuration refuses protected operations even with a token', async () => {
    for (const overrides of [{ DISCORD_CLIENT_SECRET: '' }, { SESSION_SECRET: 'short' }, { DISCORD_REDIRECT_URI: 'invalid-uri' }]) {
        await laboratory(async app => {
            assert.equal((await request(app, '/api/admin/users', { admin: true })).status, 503);
            assert.equal((await request(app, '/auth/session')).status, 503);
            assert.equal((await request(app, '/auth/discord/login')).status, 503);
        }, overrides);
    }
});

test('the first Discord account stays a player even if DISCORD_ADMIN_IDS names it', async () => {
    await laboratory(async (app, sandbox) => {
        const cookie = await login(app);
        assert.equal((await request(app, '/auth/session', { cookie })).json().role, 'user');
        assert.equal((await request(app, '/api/admin/users', { cookie })).status, 403);
        const users = JSON.parse(fs.readFileSync(storeFile(sandbox.data, 'users')));
        assert.equal(users.length, 1);
        assert.equal(users[0].discordId, DISCORD_ID);
        assert.equal(users[0].role, 'user');
        assert.equal(JSON.parse(fs.readFileSync(storeFile(sandbox.data, 'sessions'))).length, 1);
    }, {}, sandbox => fs.writeFileSync(storeFile(sandbox.data, 'users'), '[]'));
});

test('existing administrator sessions survive a real server restart and roles follow persisted accounts', async () => {
    const sandbox = createSandbox();
    let app;
    try {
        app = await startIsolatedServer(sandbox);
        const cookie = await login(app);
        assert.equal((await request(app, '/api/admin/users', { cookie })).status, 200);
        await app.stop();
        assert.equal(fs.existsSync(path.join(sandbox.data, 'locks', 'writer.lock')), false);
        app = await startIsolatedServer(sandbox);
        assert.equal((await request(app, '/api/admin/users', { cookie })).status, 200);
        assert.equal((await request(app, '/api/admin/users', { method: 'PATCH', admin: true, body: { id: ADMIN_ID, role: 'user' } })).status, 200);
        assert.equal((await request(app, '/api/admin/users', { cookie })).status, 403);
        assert.equal((await request(app, '/auth/session', { cookie })).json().role, 'user');
        assert.equal((await request(app, '/auth/logout', { method: 'POST', cookie })).status, 204);
        await app.stop();
        app = await startIsolatedServer(sandbox);
        assert.equal((await request(app, '/api/admin/users', { cookie })).status, 401);
        assert.deepEqual(fs.readdirSync(sandbox.root).filter(name => /^boundary-/.test(name)), []);
    } finally { if (app && !app.stopping) await app.stop(); removeSandbox(sandbox.root, sandbox.token); }
});

test('legacy admin-only sessions and malformed signatures never authorize HTTP requests', async () => {
    const id = 'synthetic-legacy';
    const key = 'synthetic-test-session-secret-not-for-production';
    const signature = crypto.createHmac('sha256', key).update(id).digest('hex');
    await laboratory(async app => {
        for (const cookie of [`map_session=${id}.${signature}`, 'map_session=x.y', 'map_session=%E0%A4%A']) {
            assert.equal((await request(app, '/api/admin/users', { cookie })).status, 401);
            assert.equal((await request(app, '/auth/session', { cookie })).json().authenticated, false);
        }
    }, {}, sandbox => fs.writeFileSync(storeFile(sandbox.data, 'sessions'), JSON.stringify([{ id, role: 'admin', expiresAt: Date.now() + 60_000 }])));
});

test('all private stores and code paths are absent from the static root for GET and HEAD', async () => {
    await laboratory(async app => {
        for (const pathname of ['/assets/users.json', '/assets/groups.json', '/assets/planning.json', '/assets/annotations.json', '/assets/logs/sessions.json', '/data/private/users.json', '/server.js', '/server/storage/jsonStore.js', '/.env']) {
            for (const method of ['GET', 'HEAD']) assert.equal((await request(app, pathname, { method })).status, pathname === '/.env' ? 400 : 404, `${method} ${pathname}`);
        }
        assert.equal((await request(app, '/assets/types.json')).status, 200);
        const publicLocations = await request(app, '/assets/locations.json');
        assert.equal(publicLocations.status, 200);
        assert(!publicLocations.text.includes('Récit synthétique.'));
        assert.equal((await request(app, '/assets/locations.json', { admin: true })).status, 200);
    });
});

test('each corrupt store refuses startup, remains byte-for-byte intact and is never reinitialized', async () => {
    for (const name of names) {
        const sandbox = createSandbox();
        try {
            const target = storeFile(sandbox.data, name);
            fs.writeFileSync(target, '{synthetic-corruption');
            await assert.rejects(startIsolatedServer(sandbox), /exited/);
            assert.equal(fs.readFileSync(target, 'utf8'), '{synthetic-corruption');
            assert.deepEqual(fs.readdirSync(sandbox.root).filter(name => /^boundary-/.test(name)), []);
        } finally { removeSandbox(sandbox.root, sandbox.token); }
    }
});

test('a corrupt account store cannot be overwritten by an authenticated admin mutation', async () => {
    await laboratory(async (app, sandbox) => {
        const target = storeFile(sandbox.data, 'users');
        fs.writeFileSync(target, '{synthetic-corruption');
        const response = await request(app, '/api/admin/users', { method: 'POST', admin: true, body: { username: 'Fictional account', role: 'admin' } });
        assert.equal(response.status, 500);
        assert.equal(fs.readFileSync(target, 'utf8'), '{synthetic-corruption');
        assert.equal((await request(app, '/auth/session')).json().authenticated, false);
    });
});

test('parallel admin read/modify/write requests preserve every independently created account', async () => {
    await laboratory(async (app, sandbox) => {
        const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => request(app, '/api/admin/users', { method: 'POST', admin: true, body: { username: `Synthetic-${index}`, role: 'user' } })));
        assert(responses.every(response => response.status === 201));
        const users = JSON.parse(fs.readFileSync(storeFile(sandbox.data, 'users')));
        for (let index = 0; index < 12; index++) assert.equal(users.filter(user => user.username === `Synthetic-${index}`).length, 1);
        assert.equal(users.find(user => user.id === ADMIN_ID).role, 'admin');
    });
});

test('a corrupt session file makes logout fail without erasing sessions or claiming success', async () => {
    await laboratory(async (app, sandbox) => {
        const cookie = await login(app);
        fs.writeFileSync(storeFile(sandbox.data, 'sessions'), '{bad-sessions');
        assert.equal((await request(app, '/auth/logout', { method: 'POST', cookie })).status, 500);
        assert.equal((await request(app, '/auth/session', { cookie })).status, 500);
        assert.equal((await request(app, '/api/admin/users', { cookie })).status, 500);
        assert.equal(fs.readFileSync(storeFile(sandbox.data, 'sessions'), 'utf8'), '{bad-sessions');
    });
});

test('uploads persist outside code/public and retain their existing public URL', async () => {
    await laboratory(async (app, sandbox) => {
        const response = await request(app, '/api/upload', { method: 'POST', admin: true, body: { type: 'image', filename: 'synthetic-upload.png', data: PNG.toString('base64') } });
        assert.equal(response.status, 200, response.text);
        assert.equal(response.json().path, 'assets/images/synthetic-upload.png');
        assert.deepEqual(fs.readFileSync(path.join(sandbox.media, 'images', 'synthetic-upload.png')), PNG);
        assert.equal(fs.existsSync(path.join(sandbox.publicDir, 'assets', 'images', 'synthetic-upload.png')), false);
        assert.equal(fs.existsSync(path.join(sandbox.app, 'assets', 'images', 'synthetic-upload.png')), false);
        assert.equal((await request(app, '/' + response.json().path)).status, 404);
        assert.equal((await request(app, '/' + response.json().path, { admin: true })).status, 200);
    });
});

test('group deletion commits the existing group/account/session cleanup together', async () => {
    await laboratory(async (app, sandbox) => {
        const cookie = await login(app);
        const groupId = JSON.parse(fs.readFileSync(storeFile(sandbox.data, 'groups')))[0].id;
        assert.equal((await request(app, '/api/admin/users', { method: 'PATCH', admin: true, body: { id: ADMIN_ID, groups: [groupId] } })).status, 200);
        assert.equal((await request(app, '/api/admin/groups', { method: 'DELETE', admin: true, body: { id: groupId } })).status, 200);
        assert(!JSON.parse(fs.readFileSync(storeFile(sandbox.data, 'groups'))).some(group => group.id === groupId));
        assert(!JSON.parse(fs.readFileSync(storeFile(sandbox.data, 'users'))).some(user => user.groups?.includes(groupId)));
        assert(!JSON.parse(fs.readFileSync(storeFile(sandbox.data, 'sessions'))).some(session => session.groups?.includes(groupId)));
        assert.equal((await request(app, '/api/admin/users', { cookie })).status, 200);
        assert.equal(fs.existsSync(path.join(sandbox.data, 'transactions', 'pending.json')), false);
    });
});
