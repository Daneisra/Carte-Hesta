const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('../fixtures/application.cjs');
const { buildPublic, STATIC_FILES, requestPath, metadata } = require('../../server/publication/files');
const { createPublicHandler } = require('../../server/publication/http');
const { PublishedMedia, initializeMedia } = require('../../server/publication/media');
const { validateMedia, MAX_BYTES, crc32 } = require('../../server/publication/mediaTypes');
const { publicArchive, MAX_ARCHIVE_BYTES } = require('../../server/publication/archive');
const { publicTimeline, publicSiteConfig, publicTypes } = require('../../server/publication/projections');
if (!process.env.CARTE_TEST_ROOT || process.env.CARTE_TEST_PROCESS !== 'runner') throw new Error('Use npm run test:publication');
const root = process.env.CARTE_TEST_ROOT;
const directory = () => fs.mkdtempSync(path.join(root, 'tmp', 'publication-'));
function media(options) { const dir = directory(); initializeMedia(dir); return new PublishedMedia(dir, options); }
const upload = { type: 'image', filename: 'synthetic.png', data: PNG.toString('base64') };
function response(handler, url, method = 'GET') {
    let status, headers, bytes;
    handler({ url, method }, { writeHead(s, h) { status = s; headers = h; }, end(b) { bytes = b; } });
    return { status, headers, bytes };
}
function unzip(bytes) {
    const result = new Map(); let offset = 0;
    while (bytes.readUInt32LE(offset) === 0x04034b50) {
        assert.equal(bytes.readUInt16LE(offset + 8), 0);
        const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
        const name = bytes.toString('utf8', offset + 30, offset + 30 + length), start = offset + 30 + length + extra;
        const file = bytes.subarray(start, start + size);
        assert.equal(crc32(file), bytes.readUInt32LE(offset + 14));
        result.set(name, file); offset = start + size;
    }
    assert([0x02014b50, 0x06054b50].includes(bytes.readUInt32LE(offset)));
    assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
    return result;
}

test('the artifact contains exactly the reviewed code list, excluding planted private files', () => {
    const destination = path.join(directory(), 'public');
    const canary = path.join(root, 'app', 'server-secret.json');
    fs.writeFileSync(canary, '{"synthetic-secret":true}');
    const result = buildPublic(path.join(root, 'app'), destination);
    const actual = [];
    function visit(dir, prefix = '') { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const relative = prefix + entry.name; if (entry.isDirectory()) visit(path.join(dir, entry.name), relative + '/'); else actual.push(relative); } }
    visit(destination);
    assert.deepEqual(actual.sort(), [...STATIC_FILES, '.public-manifest.json'].sort());
    assert.deepEqual(Object.keys(result.entries).sort(), [...STATIC_FILES].sort());
    assert(!actual.includes('server-secret.json'));
    assert.throws(() => buildPublic(path.join(root, 'app'), destination), { code: 'EEXIST' });
    assert.throws(() => buildPublic(path.join(root, 'app'), path.join(root, 'app', 'nested')));
});

test('unknown files and modified approved files cannot grant themselves a public URL', () => {
    const destination = path.join(directory(), 'public'); buildPublic(path.join(root, 'app'), destination);
    const handler = createPublicHandler({ publicRoot: destination, media: media(), securityHeaders: { 'X-Content-Type-Options': 'nosniff' } });
    fs.writeFileSync(path.join(destination, 'users.json'), '[]');
    for (const target of ['/users.json', '/server.js', '/.env', '/.public-manifest.json', '/docs/security/LOT-B-STOCKAGE-AUTH.md']) assert.notEqual(response(handler, target).status, 200);
    assert.equal(response(handler, '/').status, 200);
    assert.equal(response(handler, '/js/main.js', 'HEAD').bytes, undefined);
    assert.equal(response(handler, '/js/main.js', 'POST').status, 405);
    fs.writeFileSync(path.join(destination, 'js/main.js'), 'synthetic private replacement');
    assert.equal(response(handler, '/js/main.js').status, 404);
});

test('request normalization rejects encoded traversal, hidden files, separators and absolute paths', () => {
    for (const target of ['/../server.js', '/%2e%2e/server.js', '/%252e%252e/server.js', '/assets%2fusers.json', '/assets%5cusers.json', '/assets/..\\users.json', '/C:/private', '//private', '/.git/config', '/file%00.png', '/file%ZZ.png']) assert.throws(() => requestPath(target), target);
    assert.equal(requestPath('/assets/images/Fiction%20A.png?v=1'), '/assets/images/Fiction A.png');
});

test('media content validation accepts synthetic PNG and PCM WAV and rejects disguised/partial/active files', () => {
    assert.equal(validateMedia('fiction.png', PNG), 'image/png');
    const wav = Buffer.alloc(48); wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4, 40);
    assert.equal(validateMedia('fiction.wav', wav), 'audio/wav');
    for (const filename of ['fiction.svg', 'fiction.html', 'fiction.exe', 'fiction.jpg', 'fiction.webp', 'fiction.mp3', 'fiction.ogg', 'fiction.flac', 'fiction.m4a', 'fiction.aac']) assert.throws(() => validateMedia(filename, PNG));
    assert.throws(() => validateMedia('fiction.png', Buffer.from('<html><script>alert(1)</script></html>')));
    assert.throws(() => validateMedia('fiction.png', PNG.subarray(0, PNG.length - 1)));
    assert.throws(() => validateMedia('fiction.png', Buffer.concat([PNG, Buffer.from('<script>canary</script>')])));
    const corrupt = Buffer.from(PNG); corrupt[40] ^= 1; assert.throws(() => validateMedia('fiction.png', corrupt));
    assert.throws(() => validateMedia('fiction.png', Buffer.alloc(MAX_BYTES + 1)));
});

test('upload publication validates names, type and base64 before writing', async () => {
    const published = media();
    for (const change of [{ filename: '../outside.png' }, { filename: 'CON.png' }, { filename: 'C:\\outside.png' }, { type: 'audio' }, { filename: 'active.svg' }, { data: 'invalid%%%base64' }]) await assert.rejects(published.upload({ ...upload, ...change }));
    assert.deepEqual(Object.keys(published.index().entries), []);
});

test('complete uploads are published after validation and cannot overwrite an existing file', async () => {
    const published = media();
    const first = await published.upload(upload), second = await published.upload(upload);
    assert.notEqual(first, second);
    assert.equal(published.read(first).mime, 'image/png');
    assert.deepEqual(published.read(first).bytes, PNG);
    assert.deepEqual(published.read(second).bytes, PNG);
    assert.equal(published.read('assets/images/not-approved.png'), null);
});

test('an interruption before metadata publication leaves an invisible file and preserves the prior index', async () => {
    const published = media({ beforeIndex() { throw new Error('Synthetic publication interruption'); } });
    const before = fs.readFileSync(path.join(published.root, '.published-media.json'));
    await assert.rejects(published.upload(upload), /Synthetic publication interruption/);
    assert.deepEqual(fs.readFileSync(path.join(published.root, '.published-media.json')), before);
    assert.equal(published.read('assets/images/synthetic.png'), null);
    assert.equal(unzip(publicArchive(published).bytes).size, 0);
});

test('a reservation left by an interrupted upload is never served or reused', async () => {
    const published = media({ beforePublish() { throw new Error('Synthetic interruption'); } });
    await assert.rejects(published.upload(upload));
    assert.equal(published.read('assets/images/synthetic.png'), null);
    const normal = new PublishedMedia(published.root);
    assert.equal(await normal.upload(upload), 'assets/images/synthetic-1.png');
    assert.equal(fs.statSync(path.join(normal.root, 'images/synthetic.png')).size, 0);
});

test('corrupt media metadata or altered bytes fail closed without resetting anything', async () => {
    const published = media(); const relative = await published.upload(upload);
    fs.writeFileSync(path.join(published.root, 'images/synthetic.png'), 'synthetic canary');
    assert.throws(() => published.read(relative));
    fs.writeFileSync(path.join(published.root, '.published-media.json'), '{bad');
    await assert.rejects(published.upload(upload));
    assert.equal(fs.readFileSync(path.join(published.root, '.published-media.json'), 'utf8'), '{bad');
});

test('the archive contains exactly approved media, including explicitly approved static map assets', async () => {
    const published = media(); await published.upload(upload);
    fs.writeFileSync(path.join(published.root, 'map.png'), PNG);
    await published.approve(['assets/map.png']);
    for (const name of ['users.json', 'sessions.json', '.env', 'pending.json', 'writer.lock', 'server.js']) fs.writeFileSync(path.join(published.root, name), 'SYNTHETIC-PRIVATE-CANARY');
    fs.writeFileSync(path.join(published.root, 'unlisted.png'), PNG);
    const result = publicArchive(published), entries = unzip(result.bytes);
    assert.deepEqual([...entries.keys()], ['images/synthetic.png', 'map.png']);
    assert.deepEqual(entries.get('map.png'), PNG);
    assert(!result.bytes.includes(Buffer.from('SYNTHETIC-PRIVATE-CANARY')));
    await assert.rejects(published.approve(['assets/users.json']));
    assert.throws(() => publicArchive({ index: () => ({ entries: Object.fromEntries(Array.from({ length: 1025 }, (_, i) => ['x'+i, {}])) }) }));
    assert.throws(() => publicArchive({ index: () => ({ entries: { 'assets/map.png': {} } }), read: () => ({ bytes: { length: MAX_ARCHIVE_BYTES + 1 } }) }));
});

test('an independent ZIP reader accepts the central directory, names and stored bytes', async () => {
    const published = media(); await published.upload(upload);
    const archive = publicArchive(published);
    const { yauzl } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/zipBundle.js'));
    const entries = await new Promise((resolve, reject) => yauzl.fromBuffer(archive.bytes, { lazyEntries: true }, (error, zip) => {
        if (error) { reject(error); return; }
        const result = [];
        zip.on('error', reject); zip.on('end', () => resolve(result));
        zip.on('entry', entry => {
            zip.openReadStream(entry, (error, stream) => {
                if (error) { reject(error); return; }
                const chunks = [];
                stream.on('error', reject); stream.on('data', chunk => chunks.push(chunk));
                stream.on('end', () => { result.push({ name: entry.fileName, bytes: Buffer.concat(chunks) }); zip.readEntry(); });
            });
        });
        zip.readEntry();
    }));
    assert.deepEqual(entries, [{ name: 'images/synthetic.png', bytes: PNG }]);
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('public projections exclude unknown fields and do not infer publication or future scopes', () => {
    const timeline = publicTimeline({ title: 'Fiction', privateNote: 'CANARY', entries: [
        { id: 'yes', visible: true, title: 'Public', unknown: 'CANARY' },
        { id: 'missing', title: 'CANARY' }, { id: 'hidden', visible: false, title: 'CANARY' },
        { id: 'gm', visible: true, scope: 'GM', title: 'CANARY' }
    ] });
    assert.deepEqual(timeline.entries.map(entry => entry.id), ['yes']);
    assert(!JSON.stringify(timeline).includes('CANARY'));
    const site = publicSiteConfig({ home: { title: 'Fiction', privateNote: 'CANARY' }, secret: 'CANARY', community: { proof: { guildId: 'CANARY', manualCount: 5 } } });
    assert(!JSON.stringify(site).includes('CANARY'));
    const types = publicTypes({ Town: { icon: 'assets/icons/test.png', zoom: 100, secret: 'CANARY' }, GM: { scope: 'GM', icon: 'CANARY' } });
    assert.deepEqual(Object.keys(types), ['Town']); assert(!JSON.stringify(types).includes('CANARY'));
});

test('publication metadata is not treated as an arbitrary path authority', () => {
    const published = media();
    fs.writeFileSync(path.join(published.root, '.published-media.json'), JSON.stringify({ version: 1, entries: { '../outside.png': metadata(PNG, 'image/png') } }));
    assert.throws(() => published.index());
});

// Large fixtures remain synthetic and inside the isolated runner directory.
const streamMedia = require('../../server/publication/stream');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
function largePng(target) {
    const fd = fs.openSync(target, 'wx');
    try {
        fs.writeSync(fd, PNG.subarray(0, PNG.length - 12));
        const head = Buffer.alloc(8); head.writeUInt32BE(26 * 1024 * 1024); head.write('npAD', 4); fs.writeSync(fd, head);
        let crc = 0xffffffff;
        const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); return c >>> 0; });
        const update = bytes => { for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8); };
        update(head.subarray(4)); const block = Buffer.alloc(64 * 1024);
        for (let i = 0; i < 26 * 16; i++) { fs.writeSync(fd, block); update(block); }
        const footer = Buffer.alloc(4); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0); fs.writeSync(fd, footer);
        fs.writeSync(fd, PNG.subarray(PNG.length - 12));
    } finally { fs.closeSync(fd); }
}
function largeMp3(target) {
    const frame = Buffer.alloc(417); frame.writeUInt32BE(0xfffb9000);
    const batch = Buffer.concat(Array.from({ length: 128 }, () => frame));
    const fd = fs.openSync(target, 'wx'); try { for (let i = 0; i < 512; i++) fs.writeSync(fd, batch); } finally { fs.closeSync(fd); }
}
function wireRequest(handler, method, headers = {}, url = '/assets/map.png') {
    return new Promise((resolve, reject) => {
        const response = new EventEmitter(), digest = crypto.createHash('sha256'); let length = 0, status, sentHeaders;
        response.writeHead = (code, values) => { status = code; sentHeaders = Object.fromEntries(Object.entries(values).map(([key,value]) => [key.toLowerCase(),String(value)])); response.headersSent = true; };
        response.write = bytes => { length += bytes.length; digest.update(bytes); return true; };
        response.end = bytes => { if (bytes) response.write(bytes); resolve({ status, headers: sentHeaders, length, sha256: digest.digest('hex') }); };
        response.destroy = () => { response.destroyed = true; response.emit('close'); reject(new Error('Synthetic response aborted')); };
        response.setTimeout = () => {};
        const request = { url, method, headers: Object.fromEntries(Object.entries(headers).map(([key,value]) => [key.toLowerCase(),value])) };
        Promise.resolve(handler(request, response)).catch(reject);
    });
}
test('large PNG approval validates CRCs and hashes with bounded allocations; uploads retain 25 MiB limit', async () => {
    const published = media(), target = path.join(published.root, 'map.png'); largePng(target);
    const allocate = Buffer.allocUnsafe; let largest = 0;
    Buffer.allocUnsafe = size => { largest = Math.max(largest, size); return allocate(size); };
    try { await published.approve(['assets/map.png']); } finally { Buffer.allocUnsafe = allocate; }
    const entry = published.index().entries['assets/map.png'];
    assert(entry.size > MAX_BYTES); assert(largest <= streamMedia.CHUNK_BYTES);
    assert.equal(entry.chunkSize, 256 * 1024); assert.equal(entry.chunks.length, Math.ceil(entry.size / entry.chunkSize));
    assert.equal(published.streaming('assets/map.png').entry.sha256, entry.sha256);
    assert.throws(() => published.read('assets/map.png')); // Never fall back to buffering in the bounded ZIP API.
    await assert.rejects(published.upload({ type: 'image', filename: 'large.png', data: 'A'.repeat(36 * 1024 * 1024) }));
    const before = fs.readFileSync(path.join(published.root, '.published-media.json'));
    const fd = fs.openSync(target, 'r+'); try { fs.writeSync(fd, Buffer.from([1]), 0, 1, 29); } finally { fs.closeSync(fd); }
    await assert.rejects(published.approve(['assets/map.png']));
    assert.deepEqual(fs.readFileSync(path.join(published.root, '.published-media.json')), before);
});
test('large MPEG frames are validated without whole-file reads; forged metadata and oversize fail closed', async () => {
    const published = media(); fs.mkdirSync(path.join(published.root, 'audio'));
    const target = path.join(published.root, 'audio/synthetic.mp3'); largeMp3(target);
    await published.approve(['assets/audio/synthetic.mp3']);
    const entry = published.index().entries['assets/audio/synthetic.mp3']; assert.equal(entry.mime, 'audio/mpeg');
    assert(entry.size > MAX_BYTES);
    assert.throws(() => streamMedia.validateStreamEntry('assets/audio/synthetic.mp3', { ...entry, chunks: entry.chunks.slice(1) }));
    assert.throws(() => streamMedia.validateStreamEntry('assets/audio/synthetic.mp3', { ...entry, size: streamMedia.MAX_STREAM_BYTES + 1 }));
    assert.throws(() => streamMedia.validateStreamEntry('assets/images/synthetic.jpg', entry));
    const fd = fs.openSync(target, 'r+'); try { fs.writeSync(fd, Buffer.from([0]), 0, 1, 417); } finally { fs.closeSync(fd); }
    await assert.rejects(published.approve(['assets/audio/synthetic.mp3']));
});
test('large HTTP resources preserve bytes and security headers for GET, HEAD and single byte ranges', async () => {
    const published = media(); largePng(path.join(published.root, 'map.png')); await published.approve(['assets/map.png']);
    const publicRoot = path.join(directory(), 'public'); buildPublic(path.join(root, 'app'), publicRoot);
    const handler = createPublicHandler({ publicRoot, media: published, securityHeaders: { 'X-Content-Type-Options': 'nosniff' } });
    {
        const full = await wireRequest(handler, 'GET'), head = await wireRequest(handler, 'HEAD');
        const entry = published.index().entries['assets/map.png'];
        assert.equal(full.status, 200); assert.equal(full.length, entry.size); assert.equal(full.sha256, entry.sha256);
        assert.equal(full.headers['x-content-type-options'], 'nosniff'); assert.equal(full.headers['cache-control'], 'no-store');
        assert.equal(full.headers['cross-origin-resource-policy'], 'same-origin'); assert.match(full.headers['content-security-policy'], /sandbox/);
        assert.equal(head.status, 200); assert.equal(head.length, 0); assert.equal(Number(head.headers['content-length']), entry.size);
        for (const range of ['bytes=262140-262150', 'bytes=-12', 'bytes=0-0']) {
            const result = await wireRequest(handler, 'GET', { Range: range }); assert.equal(result.status, 206);
            const match = /bytes (\d+)-(\d+)\//.exec(result.headers['content-range']);
            assert.equal(result.length, Number(match[2]) - Number(match[1]) + 1);
        }
        for (const range of ['bytes=999999999-', 'bytes=-0', 'bytes=4-2', 'bytes=0-1,4-5', 'bytes=abc']) assert.equal((await wireRequest(handler, 'GET', { Range: range })).status, 416);
        assert.equal((await wireRequest(handler, 'GET', { Range: 'bytes=0-0', 'If-Range': 'unmatched' })).status, 200);
        const fd = fs.openSync(path.join(published.root, 'map.png'), 'r+'); try { fs.writeSync(fd, Buffer.from([1]), 0, 1, 300000); } finally { fs.closeSync(fd); }
        const corrupt = await wireRequest(handler, 'GET'); assert.equal(corrupt.status, 404); assert.equal(corrupt.length, 0);
    }
});
test('mutation after full verification cannot emit altered blocks and closes its descriptor', async () => {
    const published = media(), target = path.join(published.root, 'map.png'); largePng(target); await published.approve(['assets/map.png']);
    const entry = published.index().entries['assets/map.png']; const file = await streamMedia.openVerified(target, 'assets/map.png', entry);
    const fd = fs.openSync(target, 'r+'); try { fs.writeSync(fd, Buffer.from([1]), 0, 1, 100000); } finally { fs.closeSync(fd); }
    const res = new EventEmitter(); let writes = 0; res.write = () => { writes++; return true; }; res.end = () => {}; res.destroy = () => { res.destroyed = true; };
    await streamMedia.transfer(file, res, { start: 0, end: entry.size - 1 });
    assert.equal(writes, 0); assert.equal(res.destroyed, true); assert.equal(file.handle.fd, -1);
});

test('large media rejects a forged block hash and a sparse file above the explicit 128 MiB bound', async () => {
    const published = media(), target = path.join(published.root, 'map.png'); largePng(target); await published.approve(['assets/map.png']);
    const entry = published.index().entries['assets/map.png'];
    await assert.rejects(streamMedia.openVerified(target, 'assets/map.png', { ...entry, chunks: entry.chunks.map((h,i) => i ? h : '0'.repeat(64)) }));
    const oversized = path.join(published.root, 'too-big.png'), fd = fs.openSync(oversized, 'wx');
    try { fs.ftruncateSync(fd, streamMedia.MAX_STREAM_BYTES + 1); } finally { fs.closeSync(fd); }
    await assert.rejects(streamMedia.inspectLarge(oversized, 'assets/images/too-big.png'));
});
test('backpressure followed by a disconnected client releases the open media descriptor', async () => {
    const published = media(), target = path.join(published.root, 'map.png'); largePng(target); await published.approve(['assets/map.png']);
    const entry = published.index().entries['assets/map.png'], file = await streamMedia.openVerified(target, 'assets/map.png', entry);
    const res = new EventEmitter(); let written;
    const firstWrite = new Promise(resolve => { written = resolve; });
    res.write = () => { written(); return false; }; res.end = () => {}; res.destroy = () => { res.destroyed = true; };
    const pending = streamMedia.transfer(file, res, { start: 0, end: entry.size - 1 });
    await firstWrite; res.destroyed = true; res.emit('close'); await pending;
    assert.equal(file.handle.fd, -1); assert.equal(res.listenerCount('drain'), 0); assert.equal(res.listenerCount('close'), 0);
});

test('standard trailing ID3v1 metadata is accepted only after complete MPEG frames', () => {
    const frame = Buffer.alloc(417); frame.writeUInt32BE(0xfffb9000);
    const tag = Buffer.alloc(128); tag.write('TAG');
    assert.equal(validateMedia('synthetic.mp3', Buffer.concat([frame, frame, tag])), 'audio/mpeg');
    assert.throws(() => validateMedia('synthetic.mp3', Buffer.concat([frame, Buffer.alloc(128)])));
    assert.throws(() => validateMedia('synthetic.mp3', Buffer.concat([frame, tag.subarray(0,127)])));
    assert.throws(() => validateMedia('synthetic.mp3', tag));
});

test('small audio implements byte ranges, suffixes, HEAD and If-Range after integrity verification', async () => {
    const published = media();
    const frame = Buffer.alloc(417); frame.writeUInt32BE(0xfffb9000);
    const bytes = Buffer.concat([frame, frame, frame]);
    const url = '/' + await published.upload({ type: 'audio', filename: 'short synthetic.mp3', data: bytes.toString('base64') });
    const publicRoot = path.join(directory(), 'public'); buildPublic(path.join(root, 'app'), publicRoot);
    const handler = createPublicHandler({ publicRoot, media: published, securityHeaders: { 'X-Content-Type-Options': 'nosniff' } });
    for (const [range, start, end] of [['bytes=0-15', 0, 15], ['bytes=417-833', 417, 833], ['bytes=-10', bytes.length - 10, bytes.length - 1], ['bytes=1250-9999', 1250, bytes.length - 1]]) {
        const r = await wireRequest(handler, 'GET', { Range: range }, url);
        assert.equal(r.status, 206); assert.equal(r.length, end - start + 1);
        assert.equal(r.sha256, crypto.createHash('sha256').update(bytes.subarray(start, end + 1)).digest('hex'));
        assert.equal(r.headers['content-range'], 'bytes ' + start + '-' + end + '/' + bytes.length);
        assert.equal(r.headers['accept-ranges'], 'bytes'); assert.equal(r.headers['content-type'], 'audio/mpeg');
        assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
    }
    for (const range of ['bytes=1251-', 'bytes=4-2', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=broken']) {
        const r = await wireRequest(handler, 'GET', { Range: range }, url); assert.equal(r.status, 416); assert.equal(r.length, 0); assert.equal(r.headers['content-range'], 'bytes */' + bytes.length);
    }
    const head = await wireRequest(handler, 'HEAD', { Range: 'bytes=0-15' }, url); assert.equal(head.status, 200); assert.equal(head.length, 0); assert.equal(Number(head.headers['content-length']), bytes.length);
    const whole = await wireRequest(handler, 'GET', { Range: 'bytes=0-15', 'If-Range': 'unknown' }, url); assert.equal(whole.status, 200); assert.equal(whole.length, bytes.length);
    fs.writeFileSync(path.join(published.root, url.slice('/assets/'.length)), Buffer.alloc(bytes.length));
    const corrupt = await wireRequest(handler, 'GET', { Range: 'bytes=0-15' }, url); assert.equal(corrupt.status, 404); assert.equal(corrupt.sha256, crypto.createHash('sha256').update('Not Found').digest('hex'));
});
