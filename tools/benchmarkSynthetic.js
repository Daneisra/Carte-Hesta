#!/usr/bin/env node
// Small reproducible probes, not a production capacity claim. No external services/data.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createSandbox, removeSandbox } = require('../tests/support/sandbox.cjs');
const { startIsolatedServer } = require('./devServerWithStub');
const { JsonStore } = require('../server/storage/jsonStore');
const { emptyPermissions } = require('../server/security/schema');
const { fingerprint, locationKey } = require('../server/security/access');
function request(app, target, { method = 'GET', body, token } = {}) {
    return new Promise((resolve, reject) => {
        const started = performance.now(), bytes = body ? Buffer.from(JSON.stringify(body)) : null;
        const req = http.request({ hostname: '127.0.0.1', port: app.port, path: target, method, agent: false, headers: { Connection: 'close', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}) } }, res => {
            const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ ms: Math.round((performance.now() - started) * 10) / 10, status: res.statusCode, bytes: Buffer.concat(chunks) }));
        }); req.setTimeout(15000, () => req.destroy(Error('Synthetic load deadline exceeded'))); req.on('error', reject); req.end(bytes);
    });
}
async function scenario({ places, players, streams }) {
    const s = createSandbox(); let app; const open = [];
    try {
        const store = new JsonStore(s.data), permissions = emptyPermissions(), locations = { 'Synthetic benchmark': [] };
        for (let i = 0; i < places; i++) {
            const place = { name: `Fictitious place ${i}`, type: 'city', x: i, y: i, description: 'Synthetic description', lore: 'SYNTHETIC-PRIVATE-CANARY', images: ['assets/images/test-port.png'], questEvents: [] };
            locations['Synthetic benchmark'].push(place);
            permissions.resources.locations[locationKey('Synthetic benchmark', place.name)] = { fingerprint: fingerprint('locations', place), rule: { scope: i % 2 ? 'ADMIN' : 'PUBLIC' }, categories: { description: { scope: 'PUBLIC' }, images: { scope: 'PUBLIC' }, lore: { scope: 'ADMIN' } } };
        }
        const users = JSON.parse(fs.readFileSync(store.file('users')));
        for (let i = 0; i < players; i++) users.push({ id: `manual:load-${i}`, provider: 'manual', username: `Fictitious player ${i}`, role: 'user', groups: ['group-test-a'], characters: [], apiTokens: [] });
        for (const [name, value] of Object.entries({ locations, users, permissions })) fs.writeFileSync(store.file(name), JSON.stringify(value), { mode: 0o600 });
        app = await startIsolatedServer(s);
        for (let i = 0; i < streams; i++) await new Promise((resolve, reject) => {
            const req = http.get(`${app.origin}/api/events/stream`, res => { if (res.statusCode !== 200) return reject(Error('Synthetic SSE refused')); res.once('data', resolve); res.on('error', () => {}); });
            open.push(req); req.setTimeout(15000, () => req.destroy(Error('SSE readiness deadline'))); req.on('error', reject);
        });
        const started = performance.now();
        const readResults = await Promise.all(Array.from({ length: 12 }, (_, i) => request(app, i % 3 === 0 ? '/api/admin/permissions' : '/api/locations', { token: i % 3 === 0 ? 'synthetic-admin-token' : undefined })));
        for (let i = 0; i < readResults.length; i++) { assert.equal(readResults[i].status, 200); if (i % 3) assert(!readResults[i].bytes.includes(Buffer.from('SYNTHETIC-PRIVATE-CANARY'))); }
        const writes = await Promise.all(Array.from({ length: 4 }, (_, i) => request(app, '/api/planning/my-availability', { method: 'POST', token: 'synthetic-player-token', body: { date: `2026-10-${12 + i}`, startTime: '20:00', endTime: '22:00', status: 'busy', comment: 'synthetic load only' } })));
        for (const result of writes) assert.equal(result.status, 201, result.bytes.toString());
        const saved = JSON.parse(fs.readFileSync(store.file('users'))).find(u => u.id === 'manual:test-player');
        for (let i = 0; i < 4; i++) assert(JSON.stringify(saved).includes(`2026-10-${12 + i}`), 'No availability update may be lost');
        const media = await request(app, '/assets/images/test-port.png'); assert.equal(media.status, 404, 'Shared private parent prevents publication');
        const archive = await request(app, '/api/admin/assets.zip', { token: 'synthetic-admin-token' }); assert.equal(archive.status, 200);
        const milliseconds = readResults.map(r => r.ms).sort((a, b) => a - b);
        const result = { places, syntheticPlayersAdded: players, sseConnections: streams, concurrentReads: 12, concurrentWrites: 4, readMedianMs: milliseconds[5], readMaxMs: milliseconds.at(-1), writeMaxMs: Math.max(...writes.map(r => r.ms)), sharedMediaMs: media.ms, sharedMediaStatus: media.status, archiveMs: archive.ms, archiveBytes: archive.bytes.length, elapsedMs: Math.round(performance.now() - started), confidentialityAssertionsPassed: true };
        open.forEach(req => req.destroy()); await app.stop();
        assert.deepEqual(fs.readdirSync(s.root).filter(n => /^boundary-/.test(n)), []);
        return result;
    } finally { open.forEach(req => req.destroy()); await app?.stop(); removeSandbox(s.root, s.token); }
}
async function main() {
    const results = [];
    for (const values of [{ places: 25, players: 10, streams: 0 }, { places: 200, players: 100, streams: 4 }, { places: 800, players: 300, streams: 8 }]) {
        const result = await scenario(values); results.push(result); console.log(JSON.stringify(result));
    }
    return { platform: process.platform, node: process.version, productionCapacityValidated: false, results };
}
if (require.main === module) main().then(result => { fs.mkdirSync('test-results', { recursive: true }); fs.writeFileSync(path.join('test-results', 'lot-e1-performance.json'), JSON.stringify(result, null, 2)); }).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main, scenario };
