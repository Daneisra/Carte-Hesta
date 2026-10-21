const path = require('node:path');
const { openVerified, range, transfer } = require('./stream');
const { STATIC_FILES, requestPath, readIndex, verified, MIME } = require('./files');

const PAGES = ['index.html', 'map/index.html', 'timeline/index.html', 'planning/index.html', 'changelog/index.html', 'geek-unchained/index.html'];
function staticRelative(pathname) {
    if (pathname === '/') return 'index.html';
    let relative = pathname.slice(1);
    if (relative.endsWith('/')) relative += 'index.html';
    else if (PAGES.includes(relative + '/index.html')) relative += '/index.html';
    return STATIC_FILES.includes(relative) ? relative : null;
}
function createPublicHandler({ publicRoot, media, securityHeaders }) {
    // Snapshot authority from a completed artifact; additional files cannot grant themselves a URL.
    const manifest = readIndex(publicRoot, '.public-manifest.json', 'static');
    if (STATIC_FILES.some(file => !Object.hasOwn(manifest.entries, file))) throw new Error('Incomplete public artifact');
    let activeLargeResponses = 0;
    async function serveLarge(req, res, source) {
        if (activeLargeResponses >= 4) { res.writeHead(503, { ...securityHeaders, 'Cache-Control': 'no-store' }); res.end(); return; }
        activeLargeResponses++; let file, released = false;
        try {
            file = await openVerified(source.target, source.relative, source.entry);
            if (res.destroyed) return;
            const selected = range(req.method === 'GET' && !req.headers?.['if-range'] ? req.headers?.range : undefined, source.entry.size);
            if (!selected) { res.writeHead(416, { ...securityHeaders, 'Content-Range': 'bytes */' + source.entry.size, 'Cache-Control': 'no-store' }); res.end(); return; }
            res.writeHead(selected.status, {
                ...securityHeaders, 'Content-Type': source.entry.mime, 'Content-Length': selected.end - selected.start + 1,
                'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; sandbox",
                'Cross-Origin-Resource-Policy': 'same-origin',
                ...(selected.status === 206 ? { 'Content-Range': 'bytes ' + selected.start + '-' + selected.end + '/' + source.entry.size } : {})
            });
            if (req.method === 'HEAD') res.end();
            else {
                res.setTimeout?.(30_000, () => res.destroy());
                // Do not retain the storage queue while a slow client drains the response.
                const pending = transfer(file, res, selected); file = null; released = true;
                pending.then(() => { activeLargeResponses--; }, () => { activeLargeResponses--; res.destroy(); });
            }
        } catch {
            if (res.headersSent) res.destroy();
            else { res.writeHead(404, { ...securityHeaders, 'Cache-Control': 'no-store' }); res.end(); }
        } finally { try { await file?.handle.close(); } finally { if (!released) activeLargeResponses--; } }
    }
    return (req, res) => {
        let pathname;
        try { pathname = requestPath(req.url); }
        catch { res.writeHead(400, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Invalid resource path'); return; }
        if (!['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(405, { ...securityHeaders, Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Method Not Allowed'); return;
        }
        try {
            const relative = staticRelative(pathname);
            let result;
            if (relative) result = { bytes: verified(publicRoot, relative, manifest.entries[relative]), mime: MIME[path.posix.extname(relative)] };
            else if (pathname.startsWith('/assets/')) {
                const source = media.streaming?.(pathname.slice(1));
                if (source) return serveLarge(req, res, source);
                result = media.read(pathname.slice(1));
            }
            if (!result) { res.writeHead(404, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : 'Not Found'); return; }
            // Small media need the same seek contract as streamed media. Integrity and
            // authorization have already succeeded before any range can emit bytes.
            const isMedia = result.mime.startsWith('image/') || result.mime.startsWith('audio/');
            const selected = isMedia ? range(req.method === 'GET' && !req.headers?.['if-range'] ? req.headers?.range : undefined, result.bytes.length) : { status: 200, start: 0, end: result.bytes.length - 1 };
            if (!selected) {
                res.writeHead(416, { ...securityHeaders, 'Content-Range': 'bytes */' + result.bytes.length, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }); res.end(); return;
            }
            res.writeHead(selected.status, {
                ...securityHeaders, 'Content-Type': result.mime, 'Content-Length': selected.end - selected.start + 1,
                ...(isMedia ? { 'Accept-Ranges': 'bytes' } : {}),
                ...(selected.status === 206 ? { 'Content-Range': 'bytes ' + selected.start + '-' + selected.end + '/' + result.bytes.length } : {}),
                'Cache-Control': 'no-store',
                ...(result.mime.startsWith('image/') || result.mime.startsWith('audio/') ? { 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin' } : {})
            });
            res.end(req.method === 'HEAD' ? undefined : result.bytes.subarray(selected.start, selected.end + 1));
        } catch {
            // Missing/unlisted/changed files, links and invalid indexes never produce bytes or HTML fallbacks.
            res.writeHead(404, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : 'Not Found');
        }
    };
}
module.exports = { createPublicHandler, staticRelative, PAGES };
