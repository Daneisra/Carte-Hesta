const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { plainPath } = require('../storage/paths');
const { MAX_BYTES, TYPES } = require('./mediaTypes');
const CHUNK_BYTES = 256 * 1024;
const MAX_STREAM_BYTES = 128 * 1024 * 1024;
const fail = () => { throw new Error('Invalid streaming media'); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && b.isFile() && b.nlink === 1;
function validateStreamEntry(relative, entry) {
    if (!['.png', '.mp3'].includes(path.extname(relative).toLowerCase()) || entry.mime !== TYPES[path.extname(relative).toLowerCase()] ||
        !Number.isSafeInteger(entry.size) || entry.size <= MAX_BYTES || entry.size > MAX_STREAM_BYTES ||
        entry.chunkSize !== CHUNK_BYTES || !Array.isArray(entry.chunks) || entry.chunks.length !== Math.ceil(entry.size / CHUNK_BYTES) ||
        !entry.chunks.every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) fail();
}
async function openFile(target) {
    plainPath(target);
    const before = await fs.promises.lstat(target);
    if (!before.isFile() || before.nlink !== 1 || before.size <= MAX_BYTES || before.size > MAX_STREAM_BYTES) fail();
    const handle = await fs.promises.open(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try { if (!same(before, await handle.stat())) fail(); return { handle, before }; }
    catch (error) { await handle.close(); throw error; }
}
async function block(file, index) {
    const start = index * CHUNK_BYTES, length = Math.min(CHUNK_BYTES, file.before.size - start);
    if (length <= 0) fail();
    const bytes = Buffer.allocUnsafe(length); let count = 0;
    while (count < length) {
        const result = await file.handle.read(bytes, count, length - count, start + count);
        if (!result.bytesRead) fail(); count += result.bytesRead;
    }
    if (!same(file.before, await file.handle.stat())) fail();
    return bytes;
}
// Sequential parser, fixed-size reads; neither IDAT chunks nor ID3 tags become whole buffers.
class Reader {
    constructor(file) { this.file = file; this.offset = 0; this.buffer = Buffer.alloc(0); this.used = 0; this.next = 0; this.hashes = []; this.digest = crypto.createHash('sha256'); }
    async consume(length, callback) {
        if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.file.before.size) fail();
        while (length) {
            if (this.used === this.buffer.length) {
                this.buffer = await block(this.file, this.next++); this.used = 0;
                this.hashes.push(hash(this.buffer)); this.digest.update(this.buffer);
            }
            const count = Math.min(length, this.buffer.length - this.used);
            callback?.(this.buffer.subarray(this.used, this.used + count));
            this.used += count; this.offset += count; length -= count;
        }
    }
    async take(length) {
        if (length > 32) fail();
        const out = Buffer.alloc(length); let used = 0;
        await this.consume(length, bytes => { bytes.copy(out, used); used += bytes.length; });
        return out;
    }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
    let value = n; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); return value >>> 0;
});
function updateCrc(crc, bytes) { for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return crc; }
async function png(reader) {
    if (!(await reader.take(8)).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) fail();
    let header = false, image = false;
    while (reader.offset + 12 <= reader.file.before.size) {
        const record = await reader.take(8), size = record.readUInt32BE(), kind = record.toString('ascii', 4);
        if (reader.offset + size + 4 > reader.file.before.size) fail();
        let crc = updateCrc(0xffffffff, record.subarray(4));
        if (!header) {
            if (kind !== 'IHDR' || size !== 13) fail();
            const data = await reader.take(13); crc = updateCrc(crc, data);
            const width = data.readUInt32BE(), height = data.readUInt32BE(4);
            if (!width || !height || width > 32768 || height > 32768 || width * height > 268435456 ||
                ![0, 2, 3, 4, 6].includes(data[9]) || data[10] || data[11] || data[12] > 1) fail();
            header = true;
        } else {
            if (kind === 'IHDR') fail();
            await reader.consume(size, bytes => { crc = updateCrc(crc, bytes); });
        }
        if (((crc ^ 0xffffffff) >>> 0) !== (await reader.take(4)).readUInt32BE()) fail();
        if (kind === 'IDAT' && size) image = true;
        if (kind === 'IEND') { if (size || !image || reader.offset !== reader.file.before.size) fail(); return; }
    }
    fail();
}
async function mp3(reader) {
    // Read only enough to classify the optional tag; seek-free consume retains full hashes.
    let header = await reader.take(4);
    if (header.toString('ascii', 0, 3) === 'ID3') {
        const rest = await reader.take(6), tag = Buffer.concat([header, rest]);
        if (tag.subarray(6, 10).some(byte => byte & 128)) fail();
        const size = tag.subarray(6, 10).reduce((sum, byte) => sum * 128 + byte, 0) + ((tag[5] & 16) ? 10 : 0);
        await reader.consume(size); header = await reader.take(4);
    }
    let frames = 0;
    while (true) {
        if (header[0] !== 255 || (header[1] & 0xe0) !== 0xe0) fail();
        const version = (header[1] >> 3) & 3, layer = (header[1] >> 1) & 3, index = header[2] >> 4, rateIndex = (header[2] >> 2) & 3;
        if (version === 1 || layer !== 1 || index === 0 || index === 15 || rateIndex === 3) fail();
        const rate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
        const bitrate = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[index] * 1000;
        const size = Math.floor((version === 3 ? 144 : 72) * bitrate / rate) + ((header[2] >> 1) & 1);
        if (size < 4) fail(); await reader.consume(size - 4); frames++;
        if (reader.offset === reader.file.before.size) break;
        // A standard trailing ID3v1 tag is data, not another MPEG frame.
        if (reader.file.before.size - reader.offset === 128) {
            const tag = await reader.take(3); if (tag.toString('ascii') !== 'TAG') fail();
            await reader.consume(125); break;
        }
        header = await reader.take(4);
    }
    if (!frames) fail();
}
async function inspectLarge(target, relative) {
    const extension = path.extname(relative).toLowerCase(); if (!['.png', '.mp3'].includes(extension)) fail();
    const file = await openFile(target);
    try {
        const reader = new Reader(file);
        if (extension === '.png') await png(reader); else await mp3(reader);
        if (reader.offset !== file.before.size || !same(file.before, await file.handle.stat())) fail();
        return { size: file.before.size, sha256: reader.digest.digest('hex'), mime: TYPES[extension], chunkSize: CHUNK_BYTES, chunks: reader.hashes };
    } finally { await file.handle.close(); }
}
async function openVerified(target, relative, entry) {
    validateStreamEntry(relative, entry); const file = await openFile(target);
    try {
        if (file.before.size !== entry.size) fail();
        const whole = crypto.createHash('sha256');
        for (let i = 0; i < entry.chunks.length; i++) {
            const bytes = await block(file, i); if (hash(bytes) !== entry.chunks[i]) fail(); whole.update(bytes);
        }
        if (whole.digest('hex') !== entry.sha256) fail();
        return { ...file, entry };
    } catch (error) { await file.handle.close(); throw error; }
}
function range(header, size) {
    if (header === undefined) return { start: 0, end: size - 1, status: 200 };
    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!match || (!match[1] && !match[2])) return null;
    let start, end;
    if (!match[1]) { const count = Number(match[2]); if (!Number.isSafeInteger(count) || count <= 0) return null; start = Math.max(0, size - count); end = size - 1; }
    else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
    return { start, end: Math.min(end, size - 1), status: 206 };
}
async function transfer(file, res, selected) {
    try {
        for (let i = Math.floor(selected.start / CHUNK_BYTES); i <= Math.floor(selected.end / CHUNK_BYTES); i++) {
            if (res.destroyed) return;
            const bytes = await block(file, i);
            if (hash(bytes) !== file.entry.chunks[i]) fail(); // Check BEFORE writing each block, including after a concurrent mutation.
            const start = Math.max(0, selected.start - i * CHUNK_BYTES), end = Math.min(bytes.length, selected.end - i * CHUNK_BYTES + 1);
            if (!res.write(bytes.subarray(start, end))) await new Promise((resolve, reject) => {
                const cleanup = () => { res.off('drain', drain); res.off('close', close); res.off('error', close); };
                const drain = () => { cleanup(); resolve(); }, close = () => { cleanup(); reject(new Error('Media response closed')); };
                res.once('drain', drain); res.once('close', close); res.once('error', close);
                if (res.destroyed) close();
            });
        }
        res.end();
    } catch { res.destroy(); }
    finally { await file.handle.close(); }
}
module.exports = { CHUNK_BYTES, MAX_STREAM_BYTES, validateStreamEntry, inspectLarge, openVerified, range, transfer };
