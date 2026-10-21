#!/usr/bin/env node
// Path-only index audit. Never opens tracked datasets, media, secrets or Git objects.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const historical = new Set(require('./deployment/legacyTrackedPaths.json'));
const codeJson = new Set(['package.json', 'package-lock.json', 'tools/deployment/legacyTrackedPaths.json', 'assets/fixtures/locations_sample.json', 'assets/fixtures/types_sample.json']);
function classify(files) {
    const legacy = [], forbidden = [];
    for (const name of files) {
        const lower = name.toLowerCase();
        if (!name || /^[\/\\]|^[a-z]:/i.test(name) || /[\\\x00-\x1f\x7f]/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..')) { forbidden.push(name); continue; }
        if (historical.has(name)) legacy.push(name);
        else if ((lower.startsWith('assets/') && name !== 'assets/hesta-identity.css' && !/^assets\/fixtures\/(?:README\.md|locations_sample\.json|types_sample\.json)$/.test(name)) ||
            /(^|\/)(?:\.env(?:\..*)?|[^/]+\.env|[^/]+\.(?:pem|key|p12|pfx)|id_rsa|id_ed25519)$/i.test(name) && name !== '.env.example' ||
            /(^|\/)(?:\.aws|\.ssh|\.codex|\.git)(?:\/|$)|(^|\/)(?:\.npmrc|\.netrc|\.pypirc)$/i.test(name) ||
            /\.json$/i.test(name) && !codeJson.has(name) ||
            /(^|\/)(?:data|private|media-private|media-public|logs|secrets|backups|releases|dist|test-results|playwright-report)\//i.test(name) ||
            /\.(?:log|jsonl)(?:\.\d+)?(?:\.(?:gz|xz|zst))?$|\.(?:bak|zip|tar|gz|7z|rar|tgz|tbz2|bz2|xz|zst|sql|sqlite|sqlite3|db)$/i.test(name) ||
            /\.(?:png|jpe?g|webp|gif|svg|bmp|ico|mp3|wav|ogg|flac|m4a|aac|mp4|webm|pdf|docx|xlsx|pptx|odt)$/i.test(name)) forbidden.push(name);
    }
    return { legacy, forbidden, cleanForRelease: !legacy.length && !forbidden.length };
}
function readIndex(root, env = process.env) {
    const raw = execFileSync('git', ['-c', 'core.fsmonitor=false', 'ls-files', '--stage', '-z'], { cwd: root, env, windowsHide: true });
    return parseIndex(raw);
}
function parseIndex(raw) {
    return raw.toString('utf8').split('\0').filter(Boolean).map(record => {
        const match = /^([0-7]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])\t([\s\S]+)$/.exec(record);
        if (!match) throw Error('Invalid Git index metadata');
        return { mode: match[1], object: match[2], stage: Number(match[3]), path: match[4] };
    });
}
function auditIndex(entries) {
    const result = classify([...new Set(entries.map(e => e.path))]);
    const unsafeEntries = entries.filter(e => e.stage !== 0 || !['100644', '100755'].includes(e.mode)).map(e => ({ path: e.path, mode: e.mode, stage: e.stage }));
    return { ...result, unsafeEntries, cleanForRelease: result.cleanForRelease && !unsafeEntries.length };
}
function main(args = process.argv.slice(2)) {
    if (args.length > 1 || args.length && !['--strict', '--audit'].includes(args[0])) throw Error('Use --audit or --strict');
    const root = path.resolve(__dirname, '..');
    const result = auditIndex(readIndex(root));
    console.log(JSON.stringify({ ...result, inspectedContents: false }, null, 2));
    if (result.forbidden.length || result.unsafeEntries.length || args[0] === '--strict' && result.legacy.length) process.exitCode = 1;
    return result;
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { classify, readIndex, parseIndex, auditIndex, main };
