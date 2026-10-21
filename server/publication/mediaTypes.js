const path = require('node:path');
const MAX_BYTES = 25 * 1024 * 1024;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4' };
function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}
const fail = () => { throw new Error('Invalid or unsupported media content'); };
const dimensions = (width, height) => { if (!width || !height || width > 32768 || height > 32768 || width * height > 268435456) fail(); };
function png(bytes) {
    if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) fail();
    let offset = 8, header = false, image = false;
    while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
        if (end > bytes.length) fail();
        const kind = bytes.toString('ascii', offset + 4, offset + 8);
        if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail();
        if (!header) {
            if (kind !== 'IHDR' || length !== 13) fail();
            dimensions(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12));
            if (![0, 2, 3, 4, 6].includes(bytes[offset + 17]) || bytes[offset + 18] || bytes[offset + 19] || bytes[offset + 20] > 1) fail();
            header = true;
        } else if (kind === 'IHDR') fail();
        if (kind === 'IDAT' && length) image = true;
        if (kind === 'IEND') { if (length || end !== bytes.length || !image) fail(); return; }
        offset = end;
    }
    fail();
}
function jpeg(bytes) {
    if (bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) fail();
    let offset = 2, frame = false, scan = false;
    while (offset < bytes.length - 2) {
        if (bytes[offset++] !== 0xff) fail();
        while (bytes[offset] === 0xff) offset++;
        const marker = bytes[offset++];
        if (marker === 0xd9) fail();
        if (marker === 0 || marker === 0xd8) fail();
        if (marker >= 0xd0 && marker <= 0xd7) continue;
        if (offset + 2 > bytes.length) fail();
        const size = bytes.readUInt16BE(offset);
        if (size < 2 || offset + size > bytes.length - 2) fail();
        if ([0xc0, 0xc1, 0xc2].includes(marker)) {
            if (size < 8) fail();
            dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
            frame = true;
        }
        offset += size;
        if (marker === 0xda) {
            scan = true;
            while (offset < bytes.length - 2) {
                if (bytes[offset++] !== 0xff) continue;
                const next = bytes[offset];
                if (next === 0 || (next >= 0xd0 && next <= 0xd7)) offset++;
                else { offset--; break; }
            }
        }
    }
    if (!frame || !scan || offset !== bytes.length - 2) fail();
}
function riff(bytes, kind) {
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== kind || bytes.readUInt32LE(4) + 8 !== bytes.length) fail();
    const chunks = [];
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const size = bytes.readUInt32LE(offset + 4), end = offset + 8 + size;
        if (end > bytes.length) fail();
        chunks.push({ kind: bytes.toString('ascii', offset, offset + 4), data: bytes.subarray(offset + 8, end) });
        offset = end + (size & 1);
    }
    if (offset !== bytes.length) fail();
    if (kind === 'WEBP') {
        if (!chunks.some(chunk => ['VP8 ', 'VP8L', 'ANMF'].includes(chunk.kind) && chunk.data.length >= 5)) fail();
        const extended = chunks.find(chunk => chunk.kind === 'VP8X');
        if (extended) { if (extended.data.length !== 10) fail(); dimensions(extended.data.readUIntLE(4, 3) + 1, extended.data.readUIntLE(7, 3) + 1); }
    } else {
        const format = chunks.find(chunk => chunk.kind === 'fmt '), data = chunks.find(chunk => chunk.kind === 'data');
        if (!format || format.data.length < 16 || !data?.data.length || ![1, 3].includes(format.data.readUInt16LE(0)) || !format.data.readUInt16LE(2) || !format.data.readUInt32LE(4)) fail();
    }
}
function gif(bytes) {
    if (!['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) fail();
    dimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
    let offset = 13 + ((bytes[10] & 128) ? 3 * (2 ** ((bytes[10] & 7) + 1)) : 0), frames = 0;
    const blocks = () => {
        while (offset < bytes.length) {
            const length = bytes[offset++];
            if (!length) return;
            offset += length;
            if (offset > bytes.length) fail();
        }
        fail();
    };
    while (offset < bytes.length) {
        const marker = bytes[offset++];
        if (marker === 0x3b) { if (!frames || offset !== bytes.length) fail(); return; }
        if (marker === 0x21) { offset++; blocks(); }
        else if (marker === 0x2c) {
            if (offset + 9 >= bytes.length) fail();
            dimensions(bytes.readUInt16LE(offset + 4), bytes.readUInt16LE(offset + 6));
            const flags = bytes[offset + 8]; offset += 9;
            if (flags & 128) offset += 3 * (2 ** ((flags & 7) + 1));
            if (bytes[offset] < 2 || bytes[offset] > 8) fail();
            offset++; blocks(); frames++;
        } else fail();
    }
    fail();
}
function audio(bytes, extension) {
    if (extension === '.flac') {
        if (bytes.toString('ascii', 0, 4) !== 'fLaC') fail();
        let offset = 4, last = false, streamInfo = false;
        while (!last && offset + 4 <= bytes.length) {
            last = Boolean(bytes[offset] & 128);
            const kind = bytes[offset] & 127, size = bytes.readUIntBE(offset + 1, 3);
            if (!streamInfo && (kind !== 0 || size !== 34)) fail();
            streamInfo = true; offset += 4 + size;
        }
        if (!last || offset + 2 > bytes.length || bytes[offset] !== 255 || (bytes[offset + 1] & 254) !== 248) fail();
    } else if (extension === '.ogg') {
        let offset = 0, pages = 0, codec = false;
        while (offset + 27 <= bytes.length) {
            if (bytes.toString('ascii', offset, offset + 4) !== 'OggS' || bytes[offset + 4] !== 0) fail();
            const segments = bytes[offset + 26], start = offset + 27 + segments;
            if (start > bytes.length) fail();
            let size = 0; for (let i = offset + 27; i < start; i++) size += bytes[i];
            if (start + size > bytes.length) fail();
            if (!pages) codec = bytes.toString('ascii', start, start + 8) === 'OpusHead' || bytes.toString('ascii', start, start + 7) === '\x01vorbis';
            offset = start + size; pages++;
        }
        if (!pages || !codec || offset !== bytes.length) fail();
    } else if (extension === '.m4a') {
        let offset = 0; const chunks = new Set();
        while (offset + 8 <= bytes.length) {
            const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
            if (size < 8 || offset + size > bytes.length || !['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide'].includes(kind)) fail();
            if (!offset && (kind !== 'ftyp' || !['M4A ', 'isom', 'mp42'].includes(bytes.toString('ascii', offset + 8, offset + 12)))) fail();
            chunks.add(kind); offset += size;
        }
        if (offset !== bytes.length || !chunks.has('moov') || !chunks.has('mdat')) fail();
    } else {
        let offset = 0, frames = 0;
        if (extension === '.mp3' && bytes.toString('ascii', 0, 3) === 'ID3') {
            if (bytes.subarray(6, 10).some(byte => byte & 128)) fail();
            offset = 10 + bytes.subarray(6, 10).reduce((sum, byte) => sum * 128 + byte, 0) + ((bytes[5] & 16) ? 10 : 0);
        }
        while (offset + 7 <= bytes.length) {
            if (extension === '.mp3' && bytes.length - offset === 128 && bytes.toString('ascii', offset, offset + 3) === 'TAG') {
                offset += 128; break; // Standard ID3v1 trailer, after the MPEG frames.
            }
            if (bytes[offset] !== 255 || (bytes[offset + 1] & 0xe0) !== 0xe0) fail();
            let size;
            if (extension === '.aac') {
                if ((bytes[offset + 1] & 0xf6) !== 0xf0) fail();
                size = ((bytes[offset + 3] & 3) << 11) | (bytes[offset + 4] << 3) | (bytes[offset + 5] >> 5);
                if (size < 7) fail();
            } else {
                const version = (bytes[offset + 1] >> 3) & 3, layer = (bytes[offset + 1] >> 1) & 3;
                const index = bytes[offset + 2] >> 4, rateIndex = (bytes[offset + 2] >> 2) & 3;
                if (version === 1 || layer !== 1 || index === 0 || index === 15 || rateIndex === 3) fail();
                const rate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
                const bitrate = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[index] * 1000;
                size = Math.floor((version === 3 ? 144 : 72) * bitrate / rate) + ((bytes[offset + 2] >> 1) & 1);
            }
            offset += size; if (offset > bytes.length) fail(); frames++;
        }
        if (!frames || offset !== bytes.length) fail();
    }
}
function validateMedia(filename, bytes) {
    const extension = path.extname(filename).toLowerCase(), mime = TYPES[extension];
    if (!mime || !Buffer.isBuffer(bytes) || bytes.length < 16 || bytes.length > MAX_BYTES) fail();
    try {
        if (extension === '.png') png(bytes);
        else if (extension === '.jpg' || extension === '.jpeg') jpeg(bytes);
        else if (extension === '.gif') gif(bytes);
        else if (extension === '.webp') riff(bytes, 'WEBP');
        else if (extension === '.wav') riff(bytes, 'WAVE');
        else audio(bytes, extension);
    } catch { fail(); }
    return mime;
}
module.exports = { validateMedia, TYPES, MAX_BYTES, crc32 };
