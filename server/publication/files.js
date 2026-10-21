const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { plainPath, within } = require('../storage/paths');
const STATIC_FILES = require('./staticFiles');
const { TYPES, MAX_BYTES } = require('./mediaTypes');
const { MAX_STREAM_BYTES, validateStreamEntry } = require('./stream');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function relativePath(relative) {
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('%') || relative.includes(':') || /[\x00-\x1f\x7f?#]/.test(relative) || path.posix.isAbsolute(relative)) throw new Error('Invalid public relative path');
    if (relative.split('/').some(part => !part || part.startsWith('.') || /[<>"|*]/.test(part))) throw new Error('Invalid public path segment');
    return relative;
}
function requestPath(raw) {
    const encoded = raw.split('?')[0];
    if (!encoded.startsWith('/') || encoded.startsWith('//') || /%2f|%5c/i.test(encoded)) throw new Error('Invalid request target');
    const decoded = decodeURIComponent(encoded);
    if (decoded === '/') return decoded;
    relativePath(decoded.slice(1).replace(/\/$/, ''));
    return decoded;
}
function mediaPath(relative) {
    relativePath(relative);
    if (!(/^assets\/(?:images|audio|home|icons)\//.test(relative) || ['assets/map.png', 'assets/logo.png'].includes(relative)) || !TYPES[path.posix.extname(relative).toLowerCase()]) throw new Error('Unapproved media path');
    return relative;
}
function resolved(root, relative) {
    relativePath(relative);
    const target = path.resolve(root, ...relative.split('/'));
    if (!within(root, target) || target === root) throw new Error('Public path escapes root');
    plainPath(target);
    return target;
}
function readPlain(target, limit = MAX_BYTES) {
    plainPath(target);
    const before = fs.lstatSync(target);
    if (!before.isFile() || before.nlink !== 1 || before.size > limit) throw new Error('Invalid public file');
    const descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
        const after = fs.fstatSync(descriptor);
        if (!after.isFile() || after.nlink !== 1 || after.size > limit || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) throw new Error('Public file changed');
        const bytes = Buffer.allocUnsafe(before.size + 1);
        let length = 0;
        while (length < bytes.length) {
            const count = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
            if (!count) break;
            length += count;
        }
        if (length !== before.size) throw new Error('Public file changed while reading');
        return bytes.subarray(0, length);
    } finally { fs.closeSync(descriptor); }
}
function metadata(bytes, mime) { return { size: bytes.length, sha256: digest(bytes), mime }; }
function validateEntry(value, maximum = MAX_BYTES) {
    if (!value || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > maximum || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.mime !== 'string') throw new Error('Invalid publication metadata');
}
function readIndex(root, filename, category) {
    const document = JSON.parse(readPlain(path.join(root, filename), 1024 * 1024).toString('utf8'));
    if (document.version !== 1 || !document.entries || Array.isArray(document.entries) || typeof document.entries !== 'object' || Object.keys(document.entries).length > 4096) throw new Error('Invalid publication index');
    for (const [relative, entry] of Object.entries(document.entries)) {
        validateEntry(entry, category === 'media' ? MAX_STREAM_BYTES : MAX_BYTES);
        if (category === 'media' && entry.size > MAX_BYTES) validateStreamEntry(relative, entry);
        else if (entry.chunks !== undefined || entry.chunkSize !== undefined) throw new Error('Unexpected streaming metadata');
        if (category === 'static') {
            if (!STATIC_FILES.includes(relative) || MIME[path.posix.extname(relative)] !== entry.mime) throw new Error('Unapproved static entry');
        } else {
            mediaPath(relative);
            if (TYPES[path.posix.extname(relative).toLowerCase()] !== entry.mime) throw new Error('Invalid media MIME');
        }
    }
    return document;
}
function verified(root, relative, entry) {
    validateEntry(entry);
    const bytes = readPlain(resolved(root, relative));
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error('Public file integrity failure');
    return bytes;
}
function buildPublic(source, destination) {
    if (!path.isAbsolute(source) || !path.isAbsolute(destination) || within(source, destination) || within(destination, source)) throw new Error('Public build requires separate explicit absolute paths');
    plainPath(source); plainPath(destination);
    fs.mkdirSync(destination); // exclusive: never merge into an existing artifact
    const entries = Object.create(null);
    for (const relative of STATIC_FILES) {
        const bytes = readPlain(resolved(source, relative));
        const target = resolved(destination, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o644 });
        entries[relative] = metadata(bytes, MIME[path.posix.extname(relative)]);
    }
    fs.writeFileSync(path.join(destination, '.public-manifest.json'), JSON.stringify({ version: 1, entries }, null, 2), { flag: 'wx', mode: 0o600 });
    return { version: 1, entries };
}
module.exports = { STATIC_FILES, MIME, digest, relativePath, requestPath, mediaPath, resolved, readPlain, metadata, readIndex, verified, buildPublic };
