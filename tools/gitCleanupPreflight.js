#!/usr/bin/env node
// Read-only E1.5 checks. No index-writing, fetch, application or recovery command.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { parseIndex, auditIndex } = require('./auditTrackedPaths');
const { plainPath, within } = require('../server/storage/paths');
const fail = code => { throw new Error(code); };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const equal = (a, b, code) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(code); };
function statView(stat) {
    return Object.fromEntries(['size', 'mtimeNs', 'birthtimeNs', 'mode', 'dev', 'ino', 'nlink'].map(k => [k, String(stat[k])]));
}
async function hashPlain(file) {
    plainPath(file);
    const handle = await fs.promises.open(file, 'r');
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.nlink !== 1n) fail('E_PREFLIGHT_FILE_TYPE');
        const hash = crypto.createHash('sha256');
        for await (const bytes of handle.createReadStream({ autoClose: false })) hash.update(bytes);
        equal(statView(await handle.stat({ bigint: true })), statView(before), 'E_PREFLIGHT_FILE_CHANGED');
        equal(statView(fs.lstatSync(file, { bigint: true })), statView(before), 'E_PREFLIGHT_PATH_REPLACED');
        return { sha256: hash.digest('hex'), metadata: statView(before) };
    } finally { await handle.close(); }
}
function gitMetadata(root) {
    const base = path.join(root, '.git');
    plainPath(base);
    const records = [];
    function visit(relative) {
        const target = path.join(base, relative);
        plainPath(target);
        const st = fs.lstatSync(target, { bigint: true });
        if (relative.endsWith('.lock')) fail('E_PREFLIGHT_GIT_LOCK');
        if (!st.isDirectory() && (!st.isFile() || st.nlink !== 1n)) fail('E_PREFLIGHT_GIT_FILE_TYPE');
        records.push({ path: relative, directory: st.isDirectory(), ...statView(st) });
        if (st.isDirectory()) for (const name of fs.readdirSync(target).sort()) visit(relative ? relative + '/' + name : name);
    }
    visit('');
    return { nodes: records.length, sha256: digest(Buffer.from(JSON.stringify(records))) };
}
function validatePathspec(bytes, expectedPaths, approvedSha256) {
    if (!/^[a-f0-9]{64}$/.test(approvedSha256 || '') || digest(bytes) !== approvedSha256 || bytes[bytes.length - 1] !== 0) fail('E_PREFLIGHT_PATHSPEC_DIGEST');
    const paths = bytes.toString('utf8').split('\0').slice(0, -1);
    if (paths.length !== 114 || new Set(paths).size !== 114) fail('E_PREFLIGHT_PATHSPEC_COUNT');
    equal(paths, expectedPaths, 'E_PREFLIGHT_PATHSPEC_SET');
    return paths;
}
function validateIndex(actual, reference, removals, after) {
    const names = new Set(removals);
    const expected = after ? reference.filter(e => !names.has(e.path)) : reference;
    if (reference.length !== 225 || expected.length !== (after ? 111 : 225)) fail('E_PREFLIGHT_INDEX_REFERENCE');
    equal(actual, expected, 'E_PREFLIGHT_INDEX_ENTRIES');
}
function validateStaged(raw, removals, after) {
    if (!after) { if (raw.length) fail('E_PREFLIGHT_STAGED_CHANGES'); return; }
    const fields = raw.toString('utf8').split('\0');
    if (fields.pop() !== '' || fields.length !== 228) fail('E_PREFLIGHT_STAGED_COUNT');
    const paths = [];
    for (let i = 0; i < fields.length; i += 2) {
        if (fields[i] !== 'D') fail('E_PREFLIGHT_STAGED_KIND');
        paths.push(fields[i + 1]);
    }
    equal(paths.sort(), [...removals].sort(), 'E_PREFLIGHT_STAGED_SET');
}
function verifyProof(control, approvedSha256) {
    const proof = path.join(control, 'verification-sha256.private.txt');
    if (!/^[a-f0-9]{64}$/.test(approvedSha256 || '') || digest(fs.readFileSync(proof)) !== approvedSha256) fail('E_PREFLIGHT_BACKUP_PROOF');
    const lines = fs.readFileSync(proof, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    const names = new Set();
    for (const line of lines) {
        const m = /^([a-fA-F0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
        if (!m || names.has(m[2])) fail('E_PREFLIGHT_BACKUP_CONTROL_FORMAT');
        if (digest(fs.readFileSync(path.join(control, m[2]))) !== m[1].toLowerCase()) fail('E_PREFLIGHT_BACKUP_CONTROL_DIGEST');
        names.add(m[2]);
    }
    if (lines.length !== 13) fail('E_PREFLIGHT_BACKUP_CONTROL_COUNT');
    return names.size;
}
// Historical operator orchestration and private references are archived separately.
// These helpers never mutate Git and require explicit approval digests for private inputs.
if (require.main === module) {
    try {
        if (process.argv.length !== 3 || process.argv[2] !== 'git-metadata' || process.env.NODE_OPTIONS || process.env.NODE_PATH) fail('E_PREFLIGHT_USAGE');
        console.log(JSON.stringify(gitMetadata(path.resolve(__dirname, '..'))));
    } catch (error) { console.error(/^E_PREFLIGHT_[A-Z_]+$/.test(error.message) ? error.message : 'E_PREFLIGHT_OPERATION_FAILED'); process.exitCode = 1; }
}
module.exports = { hashPlain, gitMetadata, validatePathspec, validateIndex, validateStaged, verifyProof };
