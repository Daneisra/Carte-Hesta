const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createSandbox, removeSandbox } = require('../support/sandbox.cjs');
const { startIsolatedServer } = require('../../tools/devServerWithStub');
const { fingerprint, locationKey } = require('../../server/security/access');
const { ADMIN_ID } = require('../fixtures/application.cjs');
const A = 'group-test-a', B = 'group-test-b', PLAYER = 'manual:test-player';
const CANARY = 'SYNTHETIC-CONFIDENTIAL-CANARY';
const tokens = { admin: 'synthetic-admin-token', player: 'synthetic-player-token', outsider: 'synthetic-outsider', mj: 'synthetic-mj-a', otherMj: 'synthetic-mj-b', peer: 'synthetic-peer', accountAdmin: 'synthetic-account-admin' };
function request(app, target, { method = 'GET', actor, body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const req = http.request({ hostname: '127.0.0.1', port: app.port, path: target, method, agent: false, headers: { Connection: 'close', ...(actor ? { Authorization: `Bearer ${tokens[actor]}` } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}), ...headers } }, res => {
            let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers, json: () => JSON.parse(text) }));
        });
        req.setTimeout(8000, () => req.destroy(new Error('Synthetic HTTP deadline'))); req.on('error', reject); req.end(bytes);
    });
}
async function lab(run, prepare) {
    const sandbox = createSandbox(); let app;
    const read = name => JSON.parse(fs.readFileSync(path.join(sandbox.data, ['locations', 'timeline'].includes(name) ? 'content' : 'private', name + '.json')));
    const write = (name, value) => fs.writeFileSync(path.join(sandbox.data, ['locations', 'timeline'].includes(name) ? 'content' : 'private', name + '.json'), JSON.stringify(value));
    try {
        const users = read('users'); users[0].apiTokens = [tokens.accountAdmin];
        users.push(
            { id: 'manual:outsider', role: 'user', username: 'Outsider', groups: [B], apiTokens: [tokens.outsider], characters: [{ id: 'fake-member', name: 'False affiliation', groupId: A }] },
            { id: 'manual:mj-a', role: 'user', username: 'MJ A', groups: [], apiTokens: [tokens.mj] },
            { id: 'manual:mj-b', role: 'user', username: 'MJ B', groups: [B], apiTokens: [tokens.otherMj] },
            { id: 'manual:peer', role: 'user', username: 'Pseudonyme partage', groups: [A], apiTokens: [tokens.peer], avatar: CANARY, profile: { bio: CANARY }, characters: [{ id: 'peer-char', name: 'Personnage partage', groupId: A, avatar: CANARY, bio: CANARY }] }
        ); write('users', users);
        const locations = read('locations');
        const legacy = { name: 'Lieu historique ' + CANARY, type: 'Town', x: 9876, y: 7654, description: CANARY, images: ['assets/images/test-port.png'] };
        const group = { name: 'Lieu reserve A', type: 'Town', x: 200, y: 300, description: 'Description A', lore: [CANARY] };
        locations['Continent de test A'].push(legacy, group); write('locations', locations);
        const permissions = read('permissions'); permissions.managedGroups = { 'manual:mj-a': [A], 'manual:mj-b': [B] };
        permissions.resources.locations[locationKey('Continent de test A', group.name)] = { rule: { scope: 'GROUP', groupId: A }, categories: { description: { scope: 'GROUP', groupId: A }, lore: { scope: 'GM', groupId: A } }, fingerprint: fingerprint('locations', group) };
        const village = locations['Continent de test B'][0]; permissions.resources.locations[locationKey('Continent de test B', village.name)] = { rule: { scope: 'PLAYERS', userIds: [PLAYER] }, fingerprint: fingerprint('locations', village) };
        const annotations = [{ id: 'old party', scope: 'party', label: CANARY, x: 1, y: 2, expiresAt: '2000-01-01', unknown: { keep: ['all', 'bytes'] } }]; write('annotations', annotations);
        const sessions = [
            { id: 'a', title: 'Session A', date: '2026-10-20', groupId: A, description: 'Public editorial text', responses: { [PLAYER]: { status: 'available', comment: 'Own comment' }, 'manual:peer': { status: 'busy', comment: CANARY } } },
            { id: 'b', title: 'Session B', date: '2026-10-20', groupId: B },
            { id: 'orphan', title: 'Historique orphelin', date: '2026-10-20', groupId: 'historical-lost-group' },
            { id: 'old', title: 'Historique sans groupe', date: '2026-10-20', groupName: 'Groupe fictif A', responses: { [PLAYER]: { status: 'busy', comment: CANARY } } }
        ]; write('planning', { sessions }); write('permissions', permissions);
        await prepare?.({ sandbox, read, write, legacy });
        app = await startIsolatedServer(sandbox);
        await run({ app, sandbox, read, write, group, legacy });
        await app.stop();
        assert.deepEqual(fs.readdirSync(sandbox.root).filter(name => /^boundary-/.test(name)), []);
    } finally { if (app && !app.stopping) await app.stop(); removeSandbox(sandbox.root, sandbox.token); }
}
async function qualify(app, qualification) {
    const catalog = (await request(app, '/api/admin/permissions', { actor: 'admin' })).json();
    const current = catalog.permissions;
    const reviewed = catalog.catalog[qualification.kind].find(value => (value.key || value.id) === qualification.key);
    qualification = { ...qualification, fingerprint: reviewed.fingerprint };
    const result = await request(app, '/api/admin/permissions', { actor: 'admin', method: 'PATCH', body: { revision: current.revision, qualification, confirm: true } });
    assert.equal(result.status, 200, result.text); return result.json().permissions;
}
function stream(app, actor) {
    let response, text = ''; const waiters = [];
    const req = http.get({ hostname: '127.0.0.1', port: app.port, path: '/api/events/stream', agent: false, headers: actor ? { Authorization: `Bearer ${tokens[actor]}` } : {} });
    const connected = new Promise((resolve, reject) => { req.once('error', reject); req.once('response', res => { response = res; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; for (const waiter of waiters) waiter(); if (text.includes('event: connected')) resolve(); }); res.on('error', reject); }); });
    return { connected, get text() { return text; }, count: () => (text.match(/event: permissions.changed/g) || []).length, wait: count => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('No expected scoped SSE invalidation')), 5000); const check = () => { if ((text.match(/event: permissions.changed/g) || []).length >= count) { clearTimeout(timer); resolve(); } }; waiters.push(check); check(); }), close: () => { response?.destroy(); req.destroy(); } };
}

test('locations, facets, direct aliases and categories obey guest/player/outsider/MJ/admin boundaries', async () => lab(async ({ app, sandbox }) => {
    for (const actor of [undefined, 'player', 'outsider', 'mj', 'otherMj', 'admin']) {
        const result = await request(app, '/api/locations', { actor }); assert.equal(result.status, 200);
        const locations = Object.values(result.json().locations).flat();
        assert.equal(locations.some(place => place.name.includes(CANARY)), actor === 'admin');
        assert.equal(locations.some(place => place.name === 'Lieu reserve A'), ['player', 'mj', 'admin'].includes(actor));
        const group = locations.find(place => place.name === 'Lieu reserve A');
        if (group && actor !== 'admin') assert.equal(JSON.stringify(group).includes(CANARY), actor === 'mj');
        assert.equal(locations.some(place => place.name === 'Village des Fixtures'), ['player', 'admin'].includes(actor));
        const search = await request(app, '/api/locations/search?text=' + encodeURIComponent(CANARY), { actor }); assert.equal(search.status, 200);
        if (actor !== 'admin' && actor !== 'mj') { assert(!JSON.stringify({ results: search.json().results, facets: search.json().facets }).includes(CANARY)); assert.equal(search.json().matched, 0); }
        const alias = await request(app, '/assets/locations.json', { actor }); assert.equal(alias.status, 200);
        assert.deepEqual(alias.json(), result.json().locations);
    }
    assert.equal((await request(app, '/api/admin/locations', { actor: 'player' })).status, 403);
    assert.equal((await request(app, '/api/admin/locations')).status, 401);
    assert.equal((await request(app, '/assets/locations.json', { method: 'HEAD' })).text, '');
    const typesFile = path.join(sandbox.data, 'content/types.json');
    const types = JSON.parse(fs.readFileSync(typesFile)); types.Town.scope = 'GM'; types.Town.label = 'PRIVATE-TYPE-LABEL'; fs.writeFileSync(typesFile, JSON.stringify(types));
    assert(!(await request(app, '/api/locations/search')).text.includes('PRIVATE-TYPE-LABEL'));
}));

test('groups expose only explicitly published metadata or verified member pseudonyms/characters, never character-derived access', async () => lab(async ({ app }) => {
    assert.deepEqual((await request(app, '/api/groups')).json().groups, []);
    const player = await request(app, '/api/groups', { actor: 'player' });
    assert.deepEqual(player.json().groups.map(group => group.id), [A]);
    assert(player.text.includes('Pseudonyme partage')); assert(player.text.includes('Personnage partage')); assert(!player.text.includes(CANARY)); assert(!player.text.includes('False affiliation'));
    assert.deepEqual((await request(app, '/api/groups', { actor: 'outsider' })).json().groups.map(group => group.id), [B]);
    await qualify(app, { kind: 'groups', key: A, rule: { scope: 'PUBLIC' } });
    const published = (await request(app, '/api/groups')).json().groups;
    assert.deepEqual(Object.keys(published[0]).sort(), ['color', 'id', 'name']);
    assert.equal((await request(app, '/api/admin/users', { actor: 'mj' })).status, 403);
    assert.equal((await request(app, '/api/admin/permissions', { actor: 'mj' })).status, 403);
}));

test('planning keeps own responses private, enforces MJ scope and supports explicit reversible public projections', async () => lab(async ({ app }) => {
    assert.deepEqual((await request(app, '/api/planning/sessions')).json().sessions, []);
    const player = await request(app, '/api/planning/sessions', { actor: 'player' }); assert.deepEqual(player.json().sessions.map(session => session.id), ['a']); assert(!player.text.includes(CANARY)); assert.deepEqual(Object.keys(player.json().sessions[0].responses), [PLAYER]);
    assert((await request(app, '/api/planning/sessions', { actor: 'mj' })).text.includes(CANARY));
    for (const actor of ['outsider', 'otherMj']) assert.equal((await request(app, '/api/planning/sessions/a/response', { actor, method: 'PATCH', body: { status: 'busy' } })).status, 404);
    assert.equal((await request(app, '/api/planning/sessions/a/response', { actor: 'player', method: 'PATCH', body: { status: 'available', userId: 'manual:peer' } })).status, 400);
    assert.equal((await request(app, '/api/admin/planning/sessions', { actor: 'mj', method: 'POST', body: { title: 'MJ session', date: '2026-10-22', groupId: A } })).status, 201);
    assert.equal((await request(app, '/api/admin/planning/sessions', { actor: 'mj', method: 'POST', body: { title: 'Forbidden', date: '2026-10-22', groupId: B } })).status, 403);
    await qualify(app, { kind: 'planning', key: 'a', rule: { scope: 'PUBLIC' } });
    const guest = await request(app, '/api/planning/sessions'); assert.equal(guest.json().sessions.length, 1); for (const field of ['responses', 'responseSummary', 'planningInsight', 'groupId', CANARY]) assert(!guest.text.includes(field));
    await qualify(app, { kind: 'planning', key: 'a', rule: { scope: 'ADMIN' } }); assert.deepEqual((await request(app, '/api/planning/sessions')).json().sessions, []);
}));

test('historical annotations remain byte-for-byte intact through reads, qualification, expiry and withdrawal', async () => lab(async ({ app, sandbox }) => {
    const file = path.join(sandbox.data, 'private/annotations.json'), before = fs.readFileSync(file);
    for (const actor of [undefined, 'player', 'mj', 'outsider']) assert.deepEqual((await request(app, '/api/annotations', { actor })).json().annotations, []);
    assert((await request(app, '/api/annotations', { actor: 'admin' })).text.includes(CANARY));
    assert.equal((await request(app, '/api/admin/permissions', { actor: 'admin', method: 'PATCH', body: { revision: 0, confirm: true, qualification: { kind: 'annotations', key: 'old party', rule: { scope: 'PUBLIC' } } } })).status, 400);
    await qualify(app, { kind: 'annotations', key: 'old party', rule: { scope: 'PRIVATE', ownerId: PLAYER }, ownerId: PLAYER });
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal((await request(app, '/api/annotations/old%20party', { actor: 'admin', method: 'DELETE' })).status, 204);
    assert.deepEqual(fs.readFileSync(file), before);
    const catalog = (await request(app, '/api/admin/permissions', { actor: 'admin' })).json(); assert.equal(catalog.catalog.annotations[0].record.scope, 'party'); assert.equal(catalog.permissions.resources.annotations['old party'].withdrawn, true);
}));

test('new annotation scopes bind the authenticated owner and verified group, with no publication or ownership injection', async () => lab(async ({ app }) => {
    const body = { label: 'Owned note', x: 20, y: 30, scope: 'PRIVATE' };
    for (const scope of ['party', 'private', '', 'unknown']) assert.equal((await request(app, '/api/annotations', { actor: 'player', method: 'POST', body: { ...body, scope } })).status, 400);
    assert.equal((await request(app, '/api/annotations', { actor: 'player', method: 'POST', body: { ...body, scope: 'PUBLIC' } })).status, 403);
    assert.equal((await request(app, '/api/annotations', { actor: 'player', method: 'POST', body: { ...body, ownerId: ADMIN_ID } })).status, 403);
    assert.equal((await request(app, '/api/annotations', { actor: 'outsider', method: 'POST', body: { ...body, scope: 'GROUP', groupId: A } })).status, 403);
    const created = await request(app, '/api/annotations', { actor: 'player', method: 'POST', body }); assert.equal(created.status, 201); const id = created.json().annotation.id;
    assert.equal((await request(app, '/api/annotations', { actor: 'player' })).json().annotations[0].id, id);
    for (const actor of [undefined, 'mj', 'peer', 'outsider']) assert.deepEqual((await request(app, '/api/annotations', { actor })).json().annotations, []);
    assert.equal((await request(app, '/api/annotations', { actor: 'mj', method: 'POST', body: { ...body, scope: 'GM', groupId: A } })).status, 201);
}));

test('shared media requires access to every parent, handles HEAD and excludes private bytes from the public archive', async () => lab(async ({ app, legacy }) => {
    const aliases = ['/assets/images/test-port.png', '/%61ssets/images/test-port.png', '/assets/%69mages/test-port.png', '/assets/images/%74est-port.png', '/%61%73%73%65%74%73/%69%6d%61%67%65%73/test-port.png'];
    for (const target of aliases) for (const actor of [undefined, 'player', 'mj', 'otherMj', 'outsider', 'admin']) for (const method of ['GET', 'HEAD']) {
        const response = await request(app, target, { actor, method });
        assert.equal(response.status, actor === 'admin' ? 200 : 404, target + ':' + actor + ':' + method);
        if (method === 'HEAD') assert.equal(response.text, '');
    }
    const invalid = ['/assets%2fimages/test-port.png', '/assets%5cimages/test-port.png', '/%2561ssets/images/test-port.png', '/assets/images/%2574est-port.png', '/assets/%252e%252e/users.json', '/assets/images/%252fusers.json', '/assets/images/%', '/assets/images/%ZZ.png', '/assets/images/%C3%28.png', '/assets/images/%00.png', '/assets/images/test-port.png%23private', '/assets/images/test-port.png%3Fprivate', '/assets//images/test-port.png', '//assets/images/test-port.png', '/assets/../images/test-port.png', '/assets/images/./test-port.png'];
    for (const target of invalid) for (const actor of [undefined, 'player', 'mj', 'admin']) for (const method of ['GET', 'HEAD']) assert.equal((await request(app, target, { actor, method })).status, 400, target);
    assert.equal((await request(app, '/assets/images/test-port.png', { actor: 'admin' })).status, 200);
    const archive = await request(app, '/api/admin/assets.zip', { actor: 'admin' }); assert.equal(archive.status, 200); assert(!archive.text.includes('images/test-port.png'));
    // A visible marker does not publish its image category.
    await qualify(app, { kind: 'locations', key: locationKey('Continent de test A', legacy.name), rule: { scope: 'PUBLIC' } });
    assert.equal((await request(app, '/assets/images/test-port.png')).status, 404);
    await qualify(app, { kind: 'locations', key: locationKey('Continent de test A', legacy.name), rule: { scope: 'PUBLIC' }, categories: { images: { scope: 'PUBLIC' } } });
    for (const target of aliases) for (const method of ['GET', 'HEAD']) assert.equal((await request(app, target, { method })).status, 200, target);
    await qualify(app, { kind: 'locations', key: locationKey('Continent de test A', legacy.name), rule: { scope: 'ADMIN' } });
    assert.equal((await request(app, '/assets/images/test-port.png')).status, 404);
}));

test('encoded Unicode and space media paths obey the same shared-parent publication and revocation checks', async () => {
    const relative = 'assets/images/Média public test.png';
    const aliases = ['/assets/images/M%C3%A9dia%20public%20test.png', '/%61ssets/images/M%c3%a9dia%20public%20test.png', '/assets/%69mages/M%C3%A9dia%20public%20test.png'];
    await lab(async ({ app, legacy }) => {
        for (const target of aliases) for (const actor of [undefined, 'player', 'mj', 'outsider', 'admin']) for (const method of ['GET', 'HEAD']) assert.equal((await request(app, target, { actor, method })).status, actor === 'admin' ? 200 : 404, target);
        await qualify(app, { kind: 'locations', key: locationKey('Continent de test A', legacy.name), rule: { scope: 'PUBLIC' }, categories: { images: { scope: 'PUBLIC' } } });
        for (const target of aliases) for (const method of ['GET', 'HEAD']) {
            const result = await request(app, target, { method }); assert.equal(result.status, 200); assert.equal(result.headers['content-type'], 'image/png');
            assert.equal(result.text, method === 'HEAD' ? '' : require('../fixtures/application.cjs').PNG.toString('utf8'));
        }
        await qualify(app, { kind: 'locations', key: locationKey('Continent de test A', legacy.name), rule: { scope: 'ADMIN' } });
        for (const target of aliases) assert.equal((await request(app, target)).status, 404);
    }, ({ sandbox, read, write, legacy }) => {
        const { PNG } = require('../fixtures/application.cjs'); const { metadata } = require('../../server/publication/files');
        const target = path.join(sandbox.media, relative.slice(7)); fs.writeFileSync(target, PNG, { flag: 'wx', mode: 0o600 });
        const indexFile = path.join(sandbox.media, '.published-media.json'); const index = JSON.parse(fs.readFileSync(indexFile)); index.entries[relative] = metadata(PNG, 'image/png'); fs.writeFileSync(indexFile, JSON.stringify(index));
        const locations = read('locations'), places = locations['Continent de test A']; places[0].images.push(relative); places.find(place => place.name === legacy.name).images.push(relative);
        const permissions = read('permissions'); permissions.resources.locations[locationKey('Continent de test A', places[0].name)].fingerprint = fingerprint('locations', places[0]);
        write('locations', locations); write('permissions', permissions);
    });
});

test('concurrent administrative qualifications reject stale revisions and MJ revocation takes effect immediately', async () => lab(async ({ app }) => {
    const current = (await request(app, '/api/admin/permissions', { actor: 'admin' })).json().permissions;
    const groupCatalog = (await request(app, '/api/admin/permissions', { actor: 'admin' })).json().catalog.groups;
    const responses = await Promise.all([A, B].map(id => request(app, '/api/admin/permissions', { actor: 'admin', method: 'PATCH', body: { revision: current.revision, confirm: true, qualification: { kind: 'groups', key: id, fingerprint: groupCatalog.find(group => group.id === id).fingerprint, rule: { scope: 'PUBLIC' } } } })));
    assert.deepEqual(responses.map(result => result.status).sort(), [200, 409]);
    const permissions = (await request(app, '/api/admin/permissions', { actor: 'admin' })).json().permissions;
    assert.equal((await request(app, '/api/admin/permissions', { actor: 'admin', method: 'PATCH', body: { revision: permissions.revision, confirm: true, assignment: { userId: 'manual:mj-a', groupIds: [] } } })).status, 200);
    assert.equal((await request(app, '/api/admin/planning/sessions', { actor: 'mj', method: 'POST', body: { title: 'Revoked', date: '2026-10-22', groupId: A } })).status, 403);
    assert.equal((await request(app, '/api/admin/locations', { actor: 'accountAdmin' })).status, 200);
    assert.equal((await request(app, '/api/admin/users', { actor: 'admin', method: 'PATCH', body: { id: ADMIN_ID, role: 'user' } })).status, 200);
    assert.equal((await request(app, '/api/admin/locations', { actor: 'accountAdmin' })).status, 403);
}));

test('publication refuses content changed after review even if the ACL revision has not changed', async () => lab(async ({ app }) => {
    const loaded = (await request(app, '/api/admin/permissions', { actor: 'admin' })).json();
    const reviewed = loaded.catalog.groups.find(group => group.id === A);
    assert.equal((await request(app, '/api/admin/groups', { actor: 'admin', method: 'PATCH', body: { id: A, name: 'Edited after review' } })).status, 200);
    const result = await request(app, '/api/admin/permissions', { actor: 'admin', method: 'PATCH', body: { revision: loaded.permissions.revision, confirm: true, qualification: { kind: 'groups', key: A, rule: { scope: 'PUBLIC' }, fingerprint: reviewed.fingerprint } } });
    assert.equal(result.status, 409);
    assert.deepEqual((await request(app, '/api/groups')).json().groups, []);
}));

test('media parent checks canonicalize Unicode, escapes and dot segments without changing records', () => {
    const { Access } = require('../../server/security/access');
    const { emptyPermissions } = require('../../server/security/schema');
    for (const privateRef of ['assets/images/../images/échantillon.png', 'assets\\images\\échantillon.png', '/assets/images/%C3%A9chantillon.png']) {
        const publicPlace = { name: 'Published', type: 'Town', x: 1, y: 2, images: ['assets/images/%C3%A9chantillon.png'] };
        const privatePlace = { name: 'Unqualified', images: [privateRef] };
        const permissions = emptyPermissions(); permissions.resources.locations[locationKey('Synthetic', 'Published')] = { rule: { scope: 'PUBLIC' }, categories: { images: { scope: 'PUBLIC' } }, fingerprint: fingerprint('locations', publicPlace) };
        const documents = { permissions, users: [], groups: [], locations: { Synthetic: [publicPlace, privatePlace] }, timeline: { entries: [] }, planning: [], annotations: [], types: {}, 'site-config': {} };
        const before = JSON.stringify(documents);
        assert.equal(new Access(documents, { role: null, user: null }).mediaAllowed('assets/images/échantillon.png'), false, privateRef);
        assert.equal(JSON.stringify(documents), before);
    }
});

test('SSE sends only recipient-view invalidations, refreshes memberships without reconnection, and never holds the storage queue', async () => lab(async ({ app, group }) => {
    const guest = stream(app), player = stream(app, 'player');
    try {
        await Promise.all([guest.connected, player.connected]);
        assert.equal((await request(app, '/api/locations/content', { actor: 'mj', method: 'PATCH', body: { continent: 'Continent de test A', name: group.name, category: 'description', value: 'New private description ' + CANARY } })).status, 200);
        await player.wait(1); assert.equal(guest.count(), 0);
        await qualify(app, { kind: 'groups', key: B, rule: { scope: 'PUBLIC' } });
        await guest.wait(1); assert.equal(guest.count(), 1);
        const before = player.count();
        assert.equal((await request(app, '/api/admin/users', { actor: 'admin', method: 'PATCH', body: { id: PLAYER, groups: [] } })).status, 200);
        await player.wait(before + 1);
        assert.equal((await request(app, '/api/planning/sessions/a/response', { actor: 'player', method: 'PATCH', body: { status: 'busy' } })).status, 404);
        assert(!player.text.includes(CANARY)); assert(!guest.text.includes(CANARY)); assert(!guest.text.includes('description')); assert(!guest.text.includes('group-test'));
    } finally { guest.close(); player.close(); }
}));

test('permission corruption and forged credentials fail closed, without resetting any historical store', async () => lab(async ({ app, sandbox }) => {
    assert.equal((await request(app, '/api/locations', { headers: { Authorization: 'Bearer forged-synthetic-token' } })).status, 401);
    const annotation = fs.readFileSync(path.join(sandbox.data, 'private/annotations.json'));
    const target = path.join(sandbox.data, 'private/permissions.json'); fs.writeFileSync(target, '{corrupt');
    for (const endpoint of ['/api/locations', '/api/groups', '/api/planning/sessions', '/api/annotations', '/api/timeline', '/assets/images/test-port.png']) assert.equal((await request(app, endpoint)).status, 500);
    assert.equal(fs.readFileSync(target, 'utf8'), '{corrupt'); assert.deepEqual(fs.readFileSync(path.join(sandbox.data, 'private/annotations.json')), annotation);
}));

test('quests and timeline check direct IDs and source/destination MJ scope on every write', async () => lab(async ({ app }) => {
    const locations = (await request(app, '/api/admin/locations', { actor: 'admin' })).json().locations;
    const place = locations['Continent de test A'][0], key = locationKey('Continent de test A', place.name);
    await qualify(app, { kind: 'locations', key, rule: { scope: 'PUBLIC' }, categories: { questEvents: { scope: 'GROUP', groupId: A } } });
    assert.deepEqual((await request(app, '/api/quest-events')).json().events, []);
    for (const actor of ['player', 'otherMj']) assert.equal((await request(app, '/api/quest-events/quest-fixture', { actor, method: 'PATCH', body: { note: CANARY } })).status, 404);
    assert.equal((await request(app, '/api/quest-events/quest-fixture', { actor: 'mj', method: 'PATCH', body: { note: CANARY } })).status, 200);
    assert((await request(app, '/api/quest-events', { actor: 'player' })).text.includes(CANARY));
    assert(!(await request(app, '/api/quest-events')).text.includes(CANARY));
    assert.equal((await request(app, '/api/quest-events/quest-fixture', { actor: 'mj', method: 'PATCH', body: { locationName: 'Fort du Laboratoire' } })).status, 404);
    await qualify(app, { kind: 'timeline', key: 'test-founding', rule: { scope: 'GM', groupId: A } });
    assert(!(await request(app, '/api/timeline')).text.includes('Fondation fictive'));
    assert.equal((await request(app, '/api/timeline/entries/test-founding', { actor: 'otherMj', method: 'PATCH', body: { content: CANARY } })).status, 404);
    assert.equal((await request(app, '/api/timeline/entries/test-founding', { actor: 'mj', method: 'PATCH', body: { content: CANARY } })).status, 200);
    assert((await request(app, '/api/timeline', { actor: 'mj' })).text.includes(CANARY));
    assert(!(await request(app, '/assets/timeline.json', { actor: 'player' })).text.includes(CANARY));
    const full = (await request(app, '/api/admin/timeline', { actor: 'admin' })).json().timeline;
    full.entries.find(entry => entry.id === 'test-founding').content = 'STALE-PRIVATE-TIMELINE';
    assert.equal((await request(app, '/api/admin/timeline', { actor: 'admin', method: 'PATCH', body: { timeline: full } })).status, 200);
    assert(!(await request(app, '/api/timeline')).text.includes('STALE-PRIVATE-TIMELINE'));
}));

test('retired group IDs cannot reattach historical sessions or recover revoked MJ grants', async () => lab(async ({ app }) => {
    assert.equal((await request(app, '/api/admin/groups', { actor: 'admin', method: 'DELETE', body: { id: A } })).status, 200);
    const recreated = await request(app, '/api/admin/groups', { actor: 'admin', method: 'POST', body: { name: 'Group test a' } });
    assert.equal(recreated.status, 201); assert.notEqual(recreated.json().group.id, A);
    const formerlyOrphan = await request(app, '/api/admin/groups', { actor: 'admin', method: 'POST', body: { name: 'Historical lost group' } });
    assert.equal(formerlyOrphan.status, 201); assert.notEqual(formerlyOrphan.json().group.id, 'historical-lost-group');
    const permissions = (await request(app, '/api/admin/permissions', { actor: 'admin' })).json().permissions;
    assert(permissions.retiredGroupIds.includes(A)); assert(!permissions.managedGroups['manual:mj-a'].includes(A));
    assert.deepEqual((await request(app, '/api/planning/sessions', { actor: 'mj' })).json().sessions, []);
}));

test('profiles do not migrate legacy characters on reads, and session availability is limited to its responsible MJ', async () => lab(async ({ app, sandbox, read, write }) => {
    const users = read('users'), player = users.find(user => user.id === PLAYER);
    player.character = { id: 'historical-char', name: 'Legacy', groupId: A, unknown: CANARY }; player.characters = [];
    player.planningAvailability = [{ id: 'dated', date: '2026-10-20', startTime: '20:00', endTime: '22:00', status: 'busy', comment: CANARY }, { id: 'other-date', date: '2026-10-21', comment: 'OTHER-DATE-PRIVATE' }];
    write('users', users);
    const file = path.join(sandbox.data, 'private/users.json'), before = fs.readFileSync(file);
    assert.equal((await request(app, '/api/profile', { actor: 'player' })).status, 200); assert.deepEqual(fs.readFileSync(file), before);
    for (const actor of ['player', 'outsider', 'otherMj']) assert.equal((await request(app, '/api/planning/sessions/a/availability', { actor })).status, 404);
    const allowed = await request(app, '/api/planning/sessions/a/availability', { actor: 'mj' }); assert.equal(allowed.status, 200); assert(allowed.text.includes(CANARY)); assert(!allowed.text.includes('OTHER-DATE-PRIVATE')); assert(!allowed.text.includes('avatar')); assert(!allowed.text.includes('discordId'));
    assert.equal((await request(app, '/api/profile', { actor: 'player', method: 'PATCH', body: { role: 'admin', groups: [B], managedGroupIds: [B] } })).status, 403);
    assert.equal((await request(app, '/api/profile', { actor: 'player', method: 'PATCH', body: { characters: [{ name: 'Illegal affiliation', groupId: B }] } })).status, 400);
    assert.deepEqual(fs.readFileSync(file), before);
}));

test('profile media stays private to its owner and cannot be declassified by Range or encoding', async () => {
    await lab(async ({ app }) => {
        for (const target of ['/assets/images/own-profile.png', '/%61ssets/images/own-profile.png']) {
            for (const actor of [undefined, 'outsider', 'mj', 'peer']) assert.equal((await request(app, target, { actor, headers: { Range: 'bytes=0-7' } })).status, 404);
            assert.equal((await request(app, target, { actor: 'player', headers: { Range: 'bytes=0-7' } })).status, 206);
            assert.equal((await request(app, target, { actor: 'admin' })).status, 200);
        }
        // Two private owners do not grant access to one another's shared reference.
        for (const actor of ['player', 'peer', 'outsider']) assert.equal((await request(app, '/assets/images/shared-profile.png', { actor })).status, 404);
    }, async ({ sandbox, read, write }) => {
        const users = read('users'); const player = users.find(u => u.id === PLAYER), peer = users.find(u => u.id === 'manual:peer');
        player.avatar = 'assets/images/own-profile.png'; player.characters = [{ name: 'Fiction', avatar: 'assets/images/shared-profile.png' }]; peer.avatar = 'assets/images/shared-profile.png'; write('users', users);
        const { PNG } = require('../fixtures/application.cjs');
        for (const file of ['own-profile.png', 'shared-profile.png']) fs.writeFileSync(path.join(sandbox.media, 'images', file), PNG);
        const { PublishedMedia } = require('../../server/publication/media'); await new PublishedMedia(sandbox.media).approve(['assets/images/own-profile.png', 'assets/images/shared-profile.png']);
    });
});
