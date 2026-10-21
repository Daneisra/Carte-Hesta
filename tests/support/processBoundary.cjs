// Preloaded in the copied application, test runner and every Playwright worker.
// Defense against accidental access by these trusted tests, not an OS sandbox for hostile code.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const childProcess = require('node:child_process');
const { fileURLToPath } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');
const installWorkerSubprocessBoundary = require('./workerSubprocessBoundary.cjs');

const original = {
    readFileSync: fs.readFileSync.bind(fs), openSync: fs.openSync.bind(fs),
    writeSync: fs.writeSync.bind(fs), closeSync: fs.closeSync.bind(fs),
    realpathSync: fs.realpathSync.bind(fs), lstatSync: fs.lstatSync.bind(fs)
};
const root = process.env.CARTE_TEST_ROOT;
const source = process.env.CARTE_TEST_SOURCE_ROOT;
const token = process.env.CARTE_TEST_TOKEN;
const appMode = process.env.CARTE_TEST_PROCESS === 'app';
if (!root || !source || !token || !path.isAbsolute(root) || !path.isAbsolute(source)) throw new Error('Missing isolated test environment');
if (original.realpathSync(root) !== root || !path.basename(root).startsWith('cartehesta-test-')) throw new Error('Invalid sandbox root');
const marker = JSON.parse(original.readFileSync(path.join(root, '.carte-test-sandbox.json'), 'utf8'));
if (marker.root !== root || marker.token !== token || marker.sourceRoot !== source) throw new Error('Invalid sandbox marker');
const app = path.join(root, 'app');
const ports = new Set(JSON.parse(process.env.CARTE_TEST_ALLOWED_PORTS || '[]').map(Number));

function within(parent, target) {
    const relative = path.relative(parent, target);
    return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function resolved(target) {
    if (target instanceof URL) target = fileURLToPath(target);
    if (Buffer.isBuffer(target)) target = target.toString();
    if (typeof target !== 'string') return null; // Already-open descriptors were checked by open().
    return path.resolve(target);
}

function realTarget(target) {
    let cursor = target;
    const tail = [];
    while (true) {
        try { return path.join(original.realpathSync(cursor), ...tail); }
        catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
        const parent = path.dirname(cursor);
        if (parent === cursor) throw new Error('Cannot resolve filesystem boundary');
        tail.unshift(path.basename(cursor));
        cursor = parent;
    }
}

function deny(kind, target, record = true) {
    const error = new Error(`Isolated tests forbid ${kind}: ${target}`);
    error.code = 'E_TEST_BOUNDARY';
    if (record) {
        const descriptor = original.openSync(path.join(root, `boundary-${process.pid}.jsonl`), 'a');
        try { original.writeSync(descriptor, JSON.stringify({ kind, target: String(target) }) + '\n'); }
        finally { original.closeSync(descriptor); }
    }
    throw error;
}

function assertRead(target, record = true) {
    const absolute = resolved(target);
    if (!absolute) return;
    const actual = realTarget(absolute);
    for (const candidate of [absolute, actual]) {
        if (/^\.env(?:\.|$)/i.test(path.basename(candidate))) deny('environment-file read', candidate, record);
        if (appMode) {
            if (![app, ...['public', 'data', 'logs', 'media'].map(name => path.join(root, name))].some(directory => within(directory, candidate))) deny('application read outside copied roots', candidate, record);
        } else if (!within(root, candidate)) {
            if (['/etc/os-release', '/usr/lib/os-release'].includes(candidate)) continue;
            if (process.env.CARTE_TEST_BROWSER_CACHE && within(process.env.CARTE_TEST_BROWSER_CACHE, candidate)) continue;
            if (!within(source, candidate)) deny('read outside test/code roots', candidate, record);
            const relative = path.relative(source, candidate);
            const first = relative.split(path.sep)[0].toLowerCase();
            if (['assets', '.git', '.codex', '.agents', '.aws', 'data', 'logs', 'test-results', 'playwright-report'].includes(first)) deny('real data read', candidate, record);
            if (/\.json$/i.test(candidate) && first !== 'node_modules' && !within(path.join(source, 'tests', 'fixtures'), candidate) && !['package.json', 'package-lock.json'].includes(relative)) deny('non-fixture JSON read', candidate, record);
            if (/\.(?:log|jsonl|env|bak)$/i.test(candidate)) deny('private file read', candidate, record);
        }
    }
}

function assertWrite(target, record = true) {
    const absolute = resolved(target);
    if (!absolute) return;
    if (!within(root, absolute) || !within(root, realTarget(absolute))) deny('write outside owned test directory', absolute, record);
    if (appMode && !['data', 'logs', 'media', 'tmp'].some(name => within(path.join(root, name), absolute) && within(path.join(root, name), realTarget(absolute)))) deny('application write outside mutable test roots', absolute, record);
}

function wrap(name, check) {
    if (typeof fs[name] !== 'function') return;
    const fn = fs[name];
    fs[name] = function (...args) {
        // Playwright's Linux WSL detection only needs a non-WSL marker. Never read host procfs.
        if (name === 'readFileSync' && !appMode && process.platform === 'linux' && args[0] === '/proc/version') {
            const fixture = Buffer.from('Linux version 0.0.0-cartehesta-synthetic\n');
            const encoding = typeof args[1] === 'string' ? args[1] : args[1]?.encoding;
            return encoding ? fixture.toString(encoding) : fixture;
        }
        check(...args);
        return Reflect.apply(fn, this, args);
    };
}

for (const name of ['readFile', 'readFileSync', 'createReadStream', 'readdir', 'readdirSync', 'opendir', 'opendirSync']) wrap(name, target => assertRead(target));
for (const name of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream', 'unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'truncate', 'truncateSync', 'chmod', 'chmodSync']) wrap(name, target => assertWrite(target));
for (const name of ['rename', 'renameSync']) wrap(name, (from, to) => { assertWrite(from); assertWrite(to); });
for (const name of ['copyFile', 'copyFileSync', 'cp', 'cpSync']) wrap(name, (from, to) => { assertRead(from); assertWrite(to); });
for (const name of ['link', 'linkSync', 'symlink', 'symlinkSync']) wrap(name, () => deny('filesystem links', 'link creation'));
const openCheck = (target, flags) => {
    assertRead(target);
    const writes = typeof flags === 'number' ? flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND) : /[wa+]/.test(flags || 'r');
    if (writes) assertWrite(target);
};
for (const name of ['open', 'openSync']) wrap(name, openCheck);
const promiseChecks = {
    readFile: assertRead, readdir: assertRead, opendir: assertRead,
    writeFile: assertWrite, appendFile: assertWrite, unlink: assertWrite, rm: assertWrite,
    rmdir: assertWrite, mkdir: assertWrite, mkdtemp: assertWrite, truncate: assertWrite, chmod: assertWrite,
    rename: (from, to) => { assertWrite(from); assertWrite(to); },
    copyFile: (from, to) => { assertRead(from); assertWrite(to); },
    cp: (from, to) => { assertRead(from); assertWrite(to); }, open: openCheck,
    link: () => deny('filesystem links', 'link creation'), symlink: () => deny('filesystem links', 'link creation')
};
for (const [name, check] of Object.entries(promiseChecks)) {
    const fn = fs.promises[name];
    if (fn) fs.promises[name] = async function (...args) { check(...args); return Reflect.apply(fn, this, args); };
}

function assertConnection(host, port, record = true) {
    if (host !== '127.0.0.1' || !ports.has(Number(port))) deny('network connection', `${host}:${port}`, record);
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    let options = args[0];
    if (Array.isArray(options)) options = options[0];
    if (options && typeof options === 'object') assertConnection(options.host || options.hostname || 'localhost', options.port);
    else assertConnection(typeof args[1] === 'string' ? args[1] : 'localhost', options);
    return Reflect.apply(connect, this, args);
};
require('node:dgram').createSocket = () => deny('UDP sockets', 'UDP');

const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
    if (!appMode || String(args[0]) !== '0' || args[1] !== '127.0.0.1') deny('server bind', 'only the copied app may bind an ephemeral loopback port');
    this.once('listening', () => process.send?.({ type: 'carte-test-ready', token, port: this.address().port }));
    return Reflect.apply(listen, this, args);
};

if (appMode) {
    const createServer = http.createServer;
    http.createServer = function (handler) {
        return createServer((req, res) => {
            res.setHeader('X-Carte-Test-Run', token);
            if (req.url === '/_test/identity') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ token, pid: process.pid }));
                return;
            }
            handler(req, res);
        });
    };
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => deny('application subprocess', name);
    // The controller owns the IPC channel. A controller crash stops this exact child.
    process.on('disconnect', () => process.exit(process.exitCode ?? 1));
}
if (!appMode) installWorkerSubprocessBoundary({ childProcess, path, root, token, source, within, deny });
if (process.env.CARTE_TEST_PROCESS === 'runner' && process.ppid === marker.ownerPid) {
    process.on('disconnect', () => process.exit(1));
    process.channel?.unref();
}
syncBuiltinESMExports();

module.exports = {
    assertRead: target => assertRead(target, false),
    assertWrite: target => assertWrite(target, false),
    assertConnection: (host, port) => assertConnection(host, port, false)
};
