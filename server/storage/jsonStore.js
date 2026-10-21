const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { plainPath } = require('./paths');
const io = fs.promises;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const records = value => Array.isArray(value) && value.every(object);
const { validPermissions, emptyPermissions } = require('../security/schema');
const names = ['permissions', 'users', 'groups', 'locations', 'types', 'timeline', 'site-config', 'planning', 'annotations', 'sessions'];
const privateNames = new Set(['permissions', 'users', 'groups', 'planning', 'annotations', 'sessions']);
const storeFile = (directory, name) => path.join(directory, privateNames.has(name) ? 'private' : 'content', `${name}.json`);
const initial = { permissions: emptyPermissions(), users: [], groups: [], locations: {}, types: {}, timeline: { title: '', subtitle: '', entries: [] }, 'site-config': {}, planning: { sessions: [] }, annotations: [], sessions: [] };
const encode = value => JSON.stringify(value, null, 2) + '\n';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
class StorageError extends Error {
    constructor(code, name, cause) { super(`${code}: ${name}`, { cause }); this.code = code; }
}
function validate(name, value) {
    let valid = false;
    if (name === 'permissions') valid = validPermissions(value);
    else if (name === 'users' || name === 'groups') {
        const list = Array.isArray(value) ? value : value?.[name];
        valid = records(list) && list.every(item => typeof item.id === 'string' && item.id.length > 0) && new Set(list.map(item => item.id)).size === list.length;
        if (valid && name === 'users') valid = list.every(item => ['admin', 'user'].includes(item.role)
            && (item.apiTokens === undefined || (Array.isArray(item.apiTokens) && item.apiTokens.every(token => typeof token === 'string' && token.length > 0)))
            && (item.groups === undefined || (Array.isArray(item.groups) && item.groups.every(group => typeof group === 'string')))
            && (item.characters === undefined || item.characters === null || records(item.characters)));
    } else if (name === 'sessions') {
        valid = records(value) && value.every(item => typeof item.id === 'string' && item.id && Number.isFinite(item.expiresAt)) && new Set(value.map(item => item.id)).size === value.length;
    } else if (name === 'annotations') valid = records(value);
    else if (name === 'planning') {
        const sessions = Array.isArray(value) ? value : value?.sessions;
        valid = records(sessions) && sessions.every(session => typeof session.id === 'string' && session.id && typeof session.title === 'string' && session.title.trim()
            && typeof session.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(session.date) && !Number.isNaN(Date.parse(session.date))
            && (session.responses === undefined || (object(session.responses) && Object.values(session.responses).every(object))));
    }
    else if (name === 'timeline') valid = object(value) && records(value.entries);
    else if (name === 'locations') valid = object(value) && Object.values(value).every(records);
    else if (name === 'types') valid = object(value);
    else if (name === 'site-config') valid = object(value) && ['home', 'community', 'theme'].every(key => value[key] === undefined || object(value[key]))
        && (value.changelog === undefined || records(value.changelog));
    if (!valid) throw new StorageError('E_STORAGE_INVALID', name);
    return value;
}
async function privatePath(target, directory = false) {
    plainPath(target);
    const stat = await io.stat(target);
    if (directory ? !stat.isDirectory() : (!stat.isFile() || stat.nlink !== 1)) throw new StorageError('E_STORAGE_PATH', path.basename(target));
    if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new StorageError('E_STORAGE_PERMISSIONS', path.basename(target));
}
async function syncDirectory(directory) {
    // Windows Node cannot open directory handles for fsync. Linux verification remains required.
    if (process.platform === 'win32') return;
    const descriptor = await io.open(directory, 'r');
    try { await descriptor.sync(); } finally { await descriptor.close(); }
}
class JsonStore {
    constructor(directory, options = {}) {
        this.directory = directory;
        this.lockPath = path.join(directory, 'locks', 'writer.lock');
        this.journalPath = path.join(directory, 'transactions', 'pending.json');
        this.options = options; // Dependency injection for fault tests; no environment-controlled failpoints.
        this.local = new AsyncLocalStorage();
        this.tail = Promise.resolve();
        this.lease = null;
        this.poisoned = false;
    }
    file(name) {
        if (!names.includes(name)) throw new StorageError('E_STORAGE_NAME', String(name));
        return storeFile(this.directory, name);
    }
    async raw(name) {
        try {
            const target = this.file(name);
            await privatePath(target);
            const text = await io.readFile(target, 'utf8');
            let value;
            try { value = JSON.parse(text); } catch (error) { throw new StorageError('E_STORAGE_CORRUPT', name, error); }
            return { text, value: validate(name, value) };
        } catch (error) {
            if (error instanceof StorageError) throw error;
            throw new StorageError(error.code === 'ENOENT' ? 'E_STORAGE_MISSING' : 'E_STORAGE_IO', name, error);
        }
    }
    async acquire() {
        await privatePath(this.directory, true);
        for (const name of ['private', 'content', 'locks', 'transactions']) await privatePath(path.join(this.directory, name), true);
        const leasePath = this.lockPath;
        plainPath(leasePath);
        const lease = { pid: process.pid, nonce: crypto.randomBytes(24).toString('hex') };
        let handle;
        try {
            handle = await io.open(leasePath, 'wx', 0o600);
            await handle.writeFile(encode(lease));
            await handle.sync();
            await handle.close();
            handle = null;
            await syncDirectory(path.dirname(leasePath));
            this.lease = lease;
        } catch (error) {
            await handle?.close();
            throw new StorageError(error.code === 'EEXIST' ? 'E_STORAGE_LOCKED' : 'E_STORAGE_IO', 'writer.lock', error);
        }
    }
    async open() {
        await this.acquire();
        try {
            try { await io.lstat(this.journalPath); throw new StorageError('E_STORAGE_RECOVERY_REQUIRED', 'pending.json'); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            for (const name of names) await this.raw(name);
            return this;
        } catch (error) { await this.close(); throw error; }
    }
    run(callback) {
        if (this.local.getStore()?.owner === this) {
            if (!this.lease || this.poisoned) throw new StorageError('E_STORAGE_UNAVAILABLE', 'writer');
            return callback();
        }
        const result = this.tail.then(async () => {
            if (!this.lease || this.poisoned) throw new StorageError('E_STORAGE_UNAVAILABLE', 'writer');
            return this.local.run({ owner: this }, callback);
        });
        this.tail = result.catch(() => {});
        return result;
    }
    read(name) {
        return this.run(async () => {
            const pending = this.local.getStore().pending;
            if (pending?.has(name)) return clone(pending.get(name).after);
            return clone((await this.raw(name)).value);
        });
    }
    write(name, value) {
        return this.transaction(async () => {
            validate(name, value);
            const pending = this.local.getStore().pending;
            if (!pending.has(name)) pending.set(name, { name, beforeHash: hash((await this.raw(name)).text) });
            pending.get(name).after = clone(value);
        });
    }
    transaction(callback) {
        return this.run(async () => {
            const context = this.local.getStore();
            if (context.pending) return callback();
            context.pending = new Map();
            try {
                const result = await callback();
                await this.commit([...context.pending.values()]);
                return result;
            } finally { delete context.pending; }
        });
    }
    async atomic(target, text) {
        plainPath(target);
        const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
        let descriptor;
        try {
            descriptor = await io.open(temporary, 'wx', 0o600);
            await descriptor.writeFile(text, 'utf8');
            await descriptor.sync();
            await descriptor.close();
            descriptor = null;
            await this.options.beforeRename?.(target);
            await io.rename(temporary, target);
            await syncDirectory(path.dirname(target));
        } catch (error) {
            await descriptor?.close();
            await io.unlink(temporary).catch(() => {});
            throw error;
        }
    }
    async commit(changes) {
        if (!changes.length) return;
        for (const entry of changes) {
            if (hash((await this.raw(entry.name)).text) !== entry.beforeHash) throw new StorageError('E_STORAGE_CONFLICT', entry.name);
            entry.afterHash = hash(encode(entry.after));
        }
        // Intent is durable before the first replacement. A failed commit stops all further operations.
        this.poisoned = true;
        const journal = this.journalPath;
        await this.atomic(journal, encode({ version: 1, changes }));
        for (const entry of changes) await this.atomic(this.file(entry.name), encode(entry.after));
        await io.unlink(journal);
        await syncDirectory(path.dirname(journal));
        this.poisoned = false;
    }
    async recover() {
        if (!this.lease) throw new StorageError('E_STORAGE_UNAVAILABLE', 'writer');
        const target = this.journalPath;
        await privatePath(target);
        const journal = JSON.parse(await io.readFile(target, 'utf8'));
        if (journal.version !== 1 || !Array.isArray(journal.changes) || !journal.changes.length || new Set(journal.changes.map(entry => entry.name)).size !== journal.changes.length) throw new StorageError('E_STORAGE_INVALID', 'pending.json');
        for (const entry of journal.changes) {
            this.file(entry.name);
            validate(entry.name, entry.after);
            if (hash(encode(entry.after)) !== entry.afterHash) throw new StorageError('E_STORAGE_INVALID', 'pending.json');
            const current = hash((await this.raw(entry.name)).text);
            if (![entry.beforeHash, entry.afterHash].includes(current)) throw new StorageError('E_STORAGE_CONFLICT', entry.name);
        }
        for (const entry of journal.changes) await this.atomic(this.file(entry.name), encode(entry.after));
        await io.unlink(target);
        await syncDirectory(path.dirname(target));
    }
    async close() {
        await this.tail;
        if (!this.lease) return;
        const target = this.lockPath;
        await privatePath(target);
        const actual = JSON.parse(await io.readFile(target, 'utf8'));
        if (actual.nonce !== this.lease.nonce || actual.pid !== process.pid) throw new StorageError('E_STORAGE_LOCK_OWNER', 'writer.lock');
        await io.unlink(target);
        await syncDirectory(path.dirname(target));
        this.lease = null;
    }
}
async function initialize(directory) {
    // Exclusive mkdir: an existing or partially initialized installation is never filled in/reset.
    plainPath(directory);
    await io.mkdir(directory, { mode: 0o700 });
    for (const name of ['private', 'content', 'locks', 'transactions']) await io.mkdir(path.join(directory, name), { mode: 0o700 });
    for (const name of names) {
        const descriptor = await io.open(storeFile(directory, name), 'wx', 0o600);
        try { await descriptor.writeFile(encode(initial[name])); await descriptor.sync(); }
        finally { await descriptor.close(); }
    }
    for (const name of ['private', 'content', 'locks', 'transactions']) await syncDirectory(path.join(directory, name));
    await syncDirectory(directory);
}
module.exports = { JsonStore, StorageError, initialize, names, validate, privatePath, storeFile };
