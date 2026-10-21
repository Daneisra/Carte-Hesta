const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { plainPath } = require('../storage/paths');
const { validateMedia, MAX_BYTES } = require('./mediaTypes');
const { inspectLarge } = require('./stream');
const { mediaPath, resolved, readPlain, metadata, readIndex, verified } = require('./files');
const INDEX = '.published-media.json';
async function syncDirectory(directory) {
    if (process.platform === 'win32') return;
    const handle = await fs.promises.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
}
async function replaceFile(target, bytes) {
    plainPath(target);
    const temporary = path.join(path.dirname(target), `.publish-${crypto.randomUUID()}.tmp`);
    let handle;
    try {
        handle = await fs.promises.open(temporary, 'wx', 0o600);
        await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
        await fs.promises.rename(temporary, target);
        await syncDirectory(path.dirname(target));
    } finally {
        await handle?.close();
        await fs.promises.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
}
function initializeMedia(root) {
    plainPath(root);
    fs.writeFileSync(path.join(root, INDEX), JSON.stringify({ version: 1, entries: {} }) + '\n', { flag: 'wx', mode: 0o600 });
}
class PublishedMedia {
    constructor(root, options = {}) { this.root = root; this.options = options; }
    index() { return readIndex(this.root, INDEX, 'media'); }
    streaming(relative) {
        mediaPath(relative);
        const entry = this.index().entries[relative];
        return entry && entry.size > MAX_BYTES ? { target: resolved(this.root, relative.slice('assets/'.length)), relative, entry } : null;
    }
    read(relative) {
        mediaPath(relative);
        const entry = this.index().entries[relative];
        if (!entry) return null;
        const bytes = verified(this.root, relative.slice('assets/'.length), entry);
        validateMedia(relative, bytes);
        return { bytes, ...entry };
    }
    // Offline approval must hold the application's writer lease; callers provide an explicit list.
    async approve(relatives) {
        const document = this.index();
        for (const relative of relatives) {
            mediaPath(relative);
            const target = resolved(this.root, relative.slice('assets/'.length));
            if ((await fs.promises.lstat(target)).size > MAX_BYTES) document.entries[relative] = await inspectLarge(target, relative);
            else {
                const bytes = readPlain(target);
                document.entries[relative] = metadata(bytes, validateMedia(relative, bytes));
            }
        }
        const encoded = Buffer.from(JSON.stringify(document, null, 2) + '\n');
        if (encoded.length > 1024 * 1024) throw new Error('Media index size exceeded');
        await replaceFile(path.join(this.root, INDEX), encoded);
    }
    async upload({ type, filename, data }) {
        if (!['image', 'audio'].includes(type) || typeof filename !== 'string' || /[\\/\x00-\x1f]/.test(filename)) throw new Error('Invalid upload name/type');
        if (typeof data !== 'string') throw new Error('Invalid upload data');
        const encoded = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
        if (!encoded || encoded.length > 35 * 1024 * 1024 || (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))) throw new Error('Invalid base64 upload');
        const bytes = Buffer.from(encoded, 'base64');
        const mime = validateMedia(filename, bytes);
        if (!mime.startsWith(type + '/')) throw new Error('Upload type/content mismatch');
        const document = this.index();
        const extension = path.extname(filename).toLowerCase();
        const base = path.basename(filename, path.extname(filename)).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'file';
        if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) throw new Error('Reserved upload filename');
        const directory = type === 'image' ? 'images' : 'audio';
        const folder = resolved(this.root, directory);
        await fs.promises.mkdir(folder, { recursive: true, mode: 0o700 });
        let relative, target, reservation;
        for (let suffix = 0; suffix < 10_000; suffix++) {
            relative = `assets/${directory}/${base}${suffix ? '-' + suffix : ''}${extension}`;
            target = resolved(this.root, relative.slice('assets/'.length));
            try { reservation = await fs.promises.open(target, 'wx', 0o600); break; }
            catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        if (!reservation) throw new Error('Unable to reserve upload filename');
        // The reserved empty name is never listed/served. A crash leaves only unpublished residue.
        await reservation.close();
        await this.options.beforePublish?.(target);
        await replaceFile(target, bytes);
        document.entries[relative] = metadata(bytes, mime);
        await this.options.beforeIndex?.(relative);
        await replaceFile(path.join(this.root, INDEX), Buffer.from(JSON.stringify(document, null, 2) + '\n'));
        return relative;
    }
}
module.exports = { PublishedMedia, initializeMedia, INDEX, replaceFile };
