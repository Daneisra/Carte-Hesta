#!/usr/bin/env node
// No copy/delete/Git/application/network operation. 'plan' reads metadata only.
// Hashing commands are for AFTER operator approval of the private, non-synchronized destination.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { plainPath, within } = require('../server/storage/paths');
function absolute(value) { if (!value || !path.isAbsolute(value)) throw Error('E_BACKUP_ABSOLUTE_PATH'); plainPath(value); return path.resolve(value); }
function metadata(target) {
    const s = fs.lstatSync(target, { bigint: true });
    if (s.isSymbolicLink() || !s.isFile() && !s.isDirectory() || s.isFile() && s.nlink !== 1n) throw Error('E_BACKUP_LINK_OR_SPECIAL_FILE');
    return { directory: s.isDirectory(), size: Number(s.size), mtimeNs: String(s.mtimeNs), birthtimeNs: String(s.birthtimeNs), mode: String(s.mode), dev: String(s.dev), ino: String(s.ino), nlink: String(s.nlink) };
}
function inventory(root) {
    root = absolute(root); const files = [], directories = [];
    function walk(relative) {
        const target = path.join(root, relative); const state = metadata(target);
        if (state.directory) {
            if (relative) directories.push(relative);
            for (const name of fs.readdirSync(target).sort()) walk(relative ? `${relative}/${name}` : name);
        } else files.push({ path: relative, state });
    }
    walk('');
    return { root, files, directories: directories.sort() };
}
function plan(root, destination) {
    root = absolute(root); destination = absolute(destination);
    if (within(root, destination) || within(destination, root)) throw Error('E_BACKUP_OVERLAP');
    if (fs.existsSync(destination)) throw Error('E_BACKUP_DESTINATION_EXISTS');
    if (fs.existsSync(path.join(root, '.git')) && !fs.lstatSync(path.join(root, '.git')).isDirectory()) throw Error('E_BACKUP_EXTERNAL_GIT_DIRECTORY');
    for (const n of ['.git/objects/info/alternates', '.git/commondir', '.git/index.lock']) if (fs.existsSync(path.join(root, n))) throw Error('E_BACKUP_GIT_REVIEW_REQUIRED');
    const data = inventory(root); const bytes = data.files.reduce((n, f) => n + f.state.size, 0);
    return { files: data.files.length, directories: data.directories.length, bytes, maxFileBytes: data.files.reduce((m, f) => Math.max(m, f.state.size), 0), minimumBackupAndRestoreBytes: 2 * bytes, recommendedFreeBytes: 2 * bytes + Math.max(1024 ** 3, Math.ceil(bytes * 0.4)), contentsRead: false, copied: false };
}
function privateDirectory(directory) {
    directory = absolute(directory);
    const s = fs.statSync(directory);
    if (!s.isDirectory()) throw Error('E_BACKUP_PRIVATE_DIRECTORY');
    if (process.platform !== 'win32') {
        if (s.mode & 0o077 || s.uid !== process.getuid()) throw Error('E_BACKUP_PRIVATE_PERMISSIONS');
        return;
    }
    const env = {};
    for (const k of ['PATH', 'Path', 'SystemRoot', 'WINDIR']) if (process.env[k]) env[k] = process.env[k];
    env.CARTE_BACKUP_ACL_DIRECTORY = directory;
    const command = "$ErrorActionPreference='Stop'; $p=$env:CARTE_BACKUP_ACL_DIRECTORY; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $ok=@($sid,'S-1-5-18','S-1-5-32-544'); $acl=Get-Acl -LiteralPath $p; if($acl.Access.Count -eq 0){exit 2}; foreach($ace in $acl.Access){if($ace.AccessControlType -eq 'Allow'){ $id=$ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($id -notin $ok){exit 3}}}; exit 0";
    try { execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], { env, windowsHide: true, stdio: 'ignore' }); }
    catch { throw Error('E_BACKUP_PRIVATE_ACL_NOT_VERIFIED'); }
}
async function manifest(root, output, { privacyCheck = privateDirectory } = {}) {
    root = absolute(root); output = absolute(output);
    if (within(root, output)) throw Error('E_BACKUP_MANIFEST_INSIDE_SOURCE');
    if (fs.existsSync(output)) throw Error('E_BACKUP_MANIFEST_EXISTS');
    privacyCheck(path.dirname(output));
    plan(root, output); // Reject external Git storage/alternates and an active index lock before hashing.
    const before = inventory(root), entries = [];
    for (const file of before.files) {
        const target = path.join(root, file.path); const hash = crypto.createHash('sha256');
        for await (const chunk of fs.createReadStream(target, { highWaterMark: 256 * 1024 })) hash.update(chunk);
        if (JSON.stringify(metadata(target)) !== JSON.stringify(file.state)) throw Error('E_BACKUP_SOURCE_CHANGED');
        entries.push({ ...file, sha256: hash.digest('hex') });
    }
    if (JSON.stringify(inventory(root)) !== JSON.stringify(before)) throw Error('E_BACKUP_SOURCE_CHANGED');
    const payload = Buffer.from(JSON.stringify({ format: 1, directories: before.directories, entries }, null, 2) + '\n');
    const fd = fs.openSync(output, 'wx', 0o600);
    try { fs.writeFileSync(fd, payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { files: entries.length, directories: before.directories.length, manifestSha256: crypto.createHash('sha256').update(payload).digest('hex') };
}
function load(file) {
    file = absolute(file); const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (doc?.format !== 1 || !Array.isArray(doc.entries) || !Array.isArray(doc.directories)) throw Error('E_BACKUP_MANIFEST_FORMAT');
    const names = new Set();
    for (const name of [...doc.directories, ...doc.entries.map(e => e.path)]) {
        if (typeof name !== 'string' || !name || path.posix.isAbsolute(name) || /[\\:\x00-\x1f\x7f]/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..') || names.has(name)) throw Error('E_BACKUP_MANIFEST_PATH');
        names.add(name);
    }
    for (const e of doc.entries) if (!e.state || !Number.isSafeInteger(e.state.size) || e.state.size < 0 || !/^[a-f0-9]{64}$/.test(e.sha256)) throw Error('E_BACKUP_MANIFEST_ENTRY');
    return doc;
}
function compare(first, second, sourceState = false) {
    const a = load(first), b = load(second);
    const view = doc => ({ directories: [...doc.directories].sort(), entries: doc.entries.map(e => ({ path: e.path, sha256: e.sha256, size: e.state.size, ...(sourceState ? { state: e.state } : {}) })).sort((x, y) => x.path.localeCompare(y.path)) });
    if (JSON.stringify(view(a)) !== JSON.stringify(view(b))) throw Error('E_BACKUP_MANIFEST_MISMATCH');
    return { matched: true, files: a.entries.length, directories: a.directories.length, sourceStateCompared: sourceState };
}
function coverage(file, requiredFile) {
    const doc = load(file), required = JSON.parse(fs.readFileSync(absolute(requiredFile), 'utf8'));
    if (!Array.isArray(required) || !required.length || new Set(required).size !== required.length || required.some(n => typeof n !== 'string')) throw Error('E_BACKUP_REQUIRED_PATHS');
    const names = new Set(doc.entries.map(e => e.path));
    if (required.some(n => !names.has(n))) throw Error('E_BACKUP_COVERAGE');
    return { required: required.length, present: required.length, covered: true };
}
async function main(args = process.argv.slice(2)) {
    const [command, ...a] = args;
    if (command === 'plan' && a.length === 2) return plan(...a);
    if (command === 'manifest' && a.length === 2) return manifest(...a);
    if (command === 'compare' && (a.length === 2 || a.length === 3 && a[2] === '--source-state')) return compare(a[0], a[1], a[2] === '--source-state');
    if (command === 'coverage' && a.length === 2) return coverage(...a);
    throw Error('E_BACKUP_USAGE');
}
if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(/^E_BACKUP_[A-Z_]+$/.test(error.message) ? error.message : 'E_BACKUP_OPERATION_FAILED'); process.exitCode = 1; });
module.exports = { inventory, plan, manifest, compare, coverage, privateDirectory, main };
