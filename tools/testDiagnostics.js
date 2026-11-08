#!/usr/bin/env node
// CI-only export of verified synthetic results. Never uploads the raw results tree.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SOURCE_ROOT, verifySandbox, assertPlainPath } = require('../tests/support/sandbox.cjs');
const MAX_FILE = 64 * 1024 * 1024;
const MAX_TOTAL = 512 * 1024 * 1024;
const projects = ['api', 'chromium', 'firefox'];
const receipts = new WeakSet();
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const selected = name => ['results.json', 'isolation-summary.json'].includes(name) ||
    /^artifacts\/[^/]+\/(?:trace\.zip|video\.webm|test-failed-\d+\.png|synthetic-home-config\.json)$/.test(name);
const sensitive = (name, context = '') => /cookie|authorization|authentication|token|secret|password|credential|storageState|localStorage|sessionStorage/i.test(name) ||
    /^(?:sessionid|code_verifier|code_challenge)$/i.test(name) ||
    (/^(?:state|code|session)$/i.test(name) && /(?:^|\/)(?:oauth\d*|auth|authentication|authorization|credentials?|login|queryString)(?:\/|$)/i.test(context));
const childContext = (context, key) => context ? `${context}/${key}` : key;
const oauthParameter = /([?&#](?:code|state|access_token|refresh_token|token|session|client_secret)=)([^&#\s"<>]*)/gi;

function read(file) {
    assertPlainPath(file);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE) throw Error('E_DIAGNOSTIC_FILE');
    return fs.readFileSync(file);
}
function secretValues(value, found = new Set(), context = '', privateValue = false) {
    const add = text => { if (typeof text === 'string' && text.length >= 8) found.add(text); };
    if (typeof value === 'string') {
        if (privateValue) add(value);
        for (const match of value.matchAll(oauthParameter)) {
            add(match[2]);
            try { add(decodeURIComponent(match[2])); } catch { /* Invalid encoding stays masked in the URL. */ }
        }
        try { if (/^\s*[\[{]/.test(value)) secretValues(JSON.parse(value), found, context, privateValue); }
        catch { /* Not a serialized JSON value. */ }
    } else if (Array.isArray(value)) {
        if (value.length === 2 && typeof value[0] === 'string' && sensitive(value[0], context)) add(value[1]);
        for (const entry of value) secretValues(entry, found, context, privateValue);
    }
    else if (value && typeof value === 'object') {
        const name = String(value.name || '');
        if (sensitive(name, context) || /^x-carte-test-run$/i.test(name)) {
            add(value.value);
            if (/cookie/i.test(name) && typeof value.value === 'string') add(value.value.split(';')[0].split('=').slice(1).join('='));
            if (/authorization/i.test(name) && typeof value.value === 'string') add(value.value.replace(/^Bearer\s+/i, ''));
        }
        for (const [key, entry] of Object.entries(value)) {
            // Private containers contain metadata too (cookie domain/path, storage origin).
            // Discover their values, not those public addresses, for cross-field redaction.
            const inheritedValue = privateValue && (key === 'value' || typeof entry !== 'string');
            secretValues(entry, found, childContext(context, key), inheritedValue || sensitive(key, context));
        }
    }
    return found;
}
function scrub(value, roots = [], secrets = [], context = '') {
    if (typeof value === 'string') {
        let text = value;
        try {
            if (/^\s*[\[{]/.test(text)) return JSON.stringify(scrub(JSON.parse(text), roots, secrets, context));
        } catch { /* Not a serialized JSON value. */ }
        for (const root of roots.filter(Boolean)) text = text.split(root).join('<synthetic-root>');
        for (const secret of secrets) text = text.split(secret).join('[redacted]');
        return text.replace(oauthParameter, '$1[redacted]')
            .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
            .replace(/\b(?:Set-Cookie|Cookie|Authorization)\s*:\s*[^\r\n]+/gi, '[redacted header]')
            // Consume HTTP URLs first: neither their scheme nor public stack paths are local files.
            .replace(/https?:\/\/[^\s"'<>]+|(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|Users|tmp)\/)[^\s"')<>]+/gi,
                match => /^https?:\/\//i.test(match) ? match : '<absolute-path>');
    }
    if (Array.isArray(value)) {
        if (value.length === 2 && typeof value[0] === 'string' && sensitive(value[0], context)) return [value[0], '[redacted]'];
        return value.map(entry => scrub(entry, roots, secrets, context));
    }
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
        sensitive(key, context) || (key === 'value' && sensitive(String(value.name || value.id || ''), context))
            ? (Array.isArray(entry) ? [] : entry && typeof entry === 'object' ? {} : '[redacted]') : scrub(entry, roots, secrets, childContext(context, key))]));
    return value;
}

function filesIn(root, prefix = '') {
    assertPlainPath(root);
    const result = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const name = prefix + entry.name;
        const file = path.join(root, entry.name);
        assertPlainPath(file);
        if (entry.isDirectory()) {
            // HTML reports embed raw reports and ZIPs; never even enumerate them for export.
            if (name === 'artifacts' || /^artifacts\/[^/]+$/.test(name)) result.push(...filesIn(file, name + '/'));
        } else if (entry.isFile() && selected(name)) result.push(name);
        else if (!entry.isFile()) throw Error('E_DIAGNOSTIC_LINK');
    }
    return result.sort();
}

function beginRun(sandbox) {
    verifySandbox(sandbox.root, sandbox.token);
    const receipt = Object.freeze({ root: sandbox.root });
    receipts.add(receipt);
    return receipt;
}
// The parent's in-memory receipt survives cleanup; no marker/token is exported.
function recordRun(receipt, destination, project, sourceRoot = SOURCE_ROOT) {
    if (!projects.includes(project)) throw Error('E_DIAGNOSTIC_PROJECT');
    if (!receipts.delete(receipt)) throw Error('E_DIAGNOSTIC_RECEIPT');
    const run = path.basename(receipt.root);
    if (path.resolve(destination) !== path.join(sourceRoot, 'test-results', run)) throw Error('E_DIAGNOSTIC_DESTINATION');
    const files = filesIn(destination).map(name => {
        const bytes = read(path.join(destination, name));
        return { name, size: bytes.length, sha256: digest(bytes) };
    });
    if (!files.some(f => f.name === 'isolation-summary.json')) throw Error('E_DIAGNOSTIC_SUMMARY');
    const manifest = Buffer.from(JSON.stringify({ version: 1, synthetic: true, project, run, files }));
    fs.writeFileSync(path.join(destination, 'diagnostic-manifest.json'), manifest, { flag: 'wx' });
    fs.writeFileSync(path.join(sourceRoot, 'test-results', `ci-${project}.json`), JSON.stringify({ run, sha256: digest(manifest) }), { flag: 'wx' });
}

async function zipEntries(bytes) {
    const { yauzl } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/zipBundle.js'));
    return new Promise((resolve, reject) => {
        yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
            if (error) return reject(error);
            const entries = [], names = new Set(); let total = 0;
            zip.on('error', reject);
            zip.on('end', () => resolve(entries));
            zip.on('entry', entry => {
                const name = entry.fileName;
                if (name.startsWith('/') || name.split('/').some(p => !p || p === '..' || p === '.') || /[\\:\x00-\x1f]/.test(name) || names.has(name) ||
                    ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 || entry.uncompressedSize > MAX_FILE ||
                    (total += entry.uncompressedSize) > MAX_TOTAL || names.size > 20000) {
                    zip.close(); return reject(Error('E_DIAGNOSTIC_ZIP'));
                }
                names.add(name);
                zip.openReadStream(entry, (err, stream) => {
                    if (err) return reject(err);
                    const chunks = []; let size = 0;
                    stream.on('error', reject);
                    stream.on('data', data => {
                        size += data.length;
                        if (size > MAX_FILE) stream.destroy(Error('E_DIAGNOSTIC_ZIP_SIZE'));
                        else chunks.push(data);
                    });
                    stream.on('end', () => { entries.push({ name, bytes: Buffer.concat(chunks) }); zip.readEntry(); });
                });
            });
            zip.readEntry();
        });
    });
}
async function makeZip(entries) {
    const { yazl } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/zipBundle.js'));
    const zip = new yazl.ZipFile();
    const result = new Promise((resolve, reject) => {
        const chunks = [];
        zip.outputStream.on('data', chunk => chunks.push(chunk));
        zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
        zip.outputStream.on('error', reject);
    });
    for (const entry of entries) zip.addBuffer(entry.bytes, entry.name);
    zip.end(); return result;
}
const png = bytes => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
const jpeg = bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
async function inspectTrace(bytes, secrets = new Set()) {
    const entries = await zipEntries(bytes), parsed = new Map();
    for (const entry of entries) {
        if (/^(?:test|\d+-trace)\.(?:trace|network|stacks)$/.test(entry.name)) {
            const events = entry.bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
            parsed.set(entry.name, events); secretValues(events, secrets);
        } else if (/^resources\/[a-f0-9]{40}(?:\.json)?$/.test(entry.name)) {
            try { const body = JSON.parse(entry.bytes.toString('utf8')); parsed.set(entry.name, body); secretValues(body, secrets); }
            catch { /* Not an approved structured response body. */ }
        }
    }
    return { entries, parsed, secrets };
}
async function sanitizeTrace(bytes, roots, sharedSecrets = new Set()) {
    const { entries, parsed, secrets } = await inspectTrace(bytes, sharedSecrets), safe = [];
    for (const entry of entries) {
        if (/^(?:test|\d+-trace)\.(?:trace|network|stacks)$/.test(entry.name)) {
            let events = parsed.get(entry.name);
            const privateCalls = new Set(events.filter(e => /cookies|storageState|setHTTPCredentials/i.test(e.method || '')).map(e => e.callId));
            events = events.filter(e => !e.callId || !privateCalls.has(e.callId));
            safe.push({ name: entry.name, bytes: Buffer.from(events.map(e => JSON.stringify(scrub(e, roots, secrets))).join('\n') + '\n') });
        } else if (/^resources\/[a-f0-9]{40}(?:\.json)?$/.test(entry.name)) {
            if (parsed.has(entry.name)) safe.push({ name: entry.name, bytes: Buffer.from(JSON.stringify(scrub(parsed.get(entry.name), roots, secrets))) });
        } else if (/^resources\/page@[a-f0-9-]+-\d+\.(?:jpeg|png)$/.test(entry.name) && (jpeg(entry.bytes) || png(entry.bytes))) safe.push(entry);
    }
    if (!safe.some(e => e.name.endsWith('.trace'))) throw Error('E_DIAGNOSTIC_TRACE');
    return makeZip(safe);
}

function report(payload, project) {
    const tests = [];
    function visit(suites) {
        for (const suite of suites || []) {
            for (const spec of suite.specs || []) for (const test of spec.tests || []) {
                if (test.projectName !== project) throw Error('E_DIAGNOSTIC_REPORT_PROJECT');
                tests.push({ title: spec.title, file: spec.file, line: spec.line, status: test.status,
                    results: (test.results || []).map(r => ({ status: r.status, retry: r.retry, duration: r.duration, errors: r.errors })) });
            }
            visit(suite.suites);
        }
    }
    visit(payload.suites);
    const retryAttempts = tests.flatMap(t => t.results).filter(r => r.retry > 0).length;
    const firstPass = tests.filter(t => t.results[0]?.status === 'passed' && t.results[0].retry === 0).length;
    return { project, stats: payload.stats, retries: payload.config?.projects?.find(p => p.name === project)?.retries,
        retryAttempts, firstPass, stable: tests.length > 0 && firstPass === tests.length && retryAttempts === 0 && payload.stats?.flaky === 0, tests };
}
function requireZeroFirefoxRetries(payload) {
    const result = report(payload, 'firefox');
    if (result.retries !== 0 || result.retryAttempts !== 0 || payload.stats?.flaky !== 0 || result.tests.length === 0) throw Error('E_FIREFOX_RETRIES_OR_MISSING_RESULTS');
}

async function collect(output, sourceRoot = SOURCE_ROOT, expectedProjects = projects) {
    if (!Array.isArray(expectedProjects) || expectedProjects.some(p => !projects.includes(p))) throw Error('E_DIAGNOSTIC_PROJECT');
    if (!path.isAbsolute(output)) throw Error('E_DIAGNOSTIC_OUTPUT');
    assertPlainPath(output);
    if (fs.existsSync(output)) throw Error('E_DIAGNOSTIC_OUTPUT_EXISTS');
    fs.mkdirSync(output, { recursive: true });
    const exported = [], reports = [];
    for (const project of projects) {
        const pointer = path.join(sourceRoot, 'test-results', `ci-${project}.json`);
        if (!fs.existsSync(pointer)) continue;
        const ref = JSON.parse(read(pointer));
        if (!/^cartehesta-test-[A-Za-z0-9]+$/.test(ref.run) || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw Error('E_DIAGNOSTIC_POINTER');
        const run = path.join(sourceRoot, 'test-results', ref.run);
        const manifestBytes = read(path.join(run, 'diagnostic-manifest.json'));
        if (digest(manifestBytes) !== ref.sha256) throw Error('E_DIAGNOSTIC_MANIFEST_DIGEST');
        const manifest = JSON.parse(manifestBytes);
        if (manifest.version !== 1 || manifest.synthetic !== true || manifest.project !== project || manifest.run !== ref.run || !Array.isArray(manifest.files) || manifest.files.length > 10000) throw Error('E_DIAGNOSTIC_MANIFEST');
        const names = new Set(), verifiedFiles = new Map(), secrets = new Set(); let total = 0;
        const summary = JSON.parse(read(path.join(run, 'isolation-summary.json')));
        const roots = [sourceRoot, summary.sandbox].flatMap(root => root ? [root, root.replaceAll('\\', '/')] : []);
        for (const file of manifest.files) {
            if (!selected(file.name) || file.name.includes('..') || file.name.includes('\\') || names.has(file.name)) throw Error('E_DIAGNOSTIC_SELECTION');
            names.add(file.name);
            const bytes = read(path.join(run, file.name));
            if (bytes.length !== file.size || digest(bytes) !== file.sha256 || (total += bytes.length) > MAX_TOTAL) throw Error('E_DIAGNOSTIC_INTEGRITY');
            verifiedFiles.set(file.name, bytes);
            if (file.name.endsWith('.json')) secretValues(JSON.parse(bytes), secrets);
            if (file.name.endsWith('.zip')) await inspectTrace(bytes, secrets);
        }
        const dest = path.join(output, project); fs.mkdirSync(dest);
        for (const [name, bytes] of verifiedFiles) {
            let cleaned;
            if (name.endsWith('.json')) {
                let value = JSON.parse(bytes);
                if (name === 'results.json') { value = report(value, project); reports.push(value); }
                if (name === 'isolation-summary.json') {
                    const keys = ['exitCode', 'testArgs', 'violations', 'serverStopped', 'stubStopped', 'runtimeRetained'];
                    value = Object.fromEntries(keys.map(key => [key, value[key]]));
                }
                cleaned = Buffer.from(JSON.stringify(scrub(value, roots, secrets), null, 2));
            } else if (name.endsWith('.zip')) cleaned = await sanitizeTrace(bytes, roots, secrets);
            else if (name.endsWith('.png') && png(bytes)) cleaned = bytes;
            else if (name.endsWith('.webm') && bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) cleaned = bytes;
            else throw Error('E_DIAGNOSTIC_TYPE');
            const target = path.join(dest, name);
            fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, cleaned, { flag: 'wx' });
            exported.push({ project, name, size: cleaned.length, sha256: digest(cleaned) });
        }
        if (!names.has('isolation-summary.json')) throw Error('E_DIAGNOSTIC_SUMMARY');
    }
    fs.writeFileSync(path.join(output, 'export-manifest.json'), JSON.stringify({ synthetic: true, sanitized: true, files: exported }, null, 2), { flag: 'wx' });
    const summary = '| Project | Report | First attempt passed | Flaky | Retry attempts | Stable first attempt |\n| --- | --- | ---: | ---: | ---: | --- |\n' +
        projects.map(project => {
            const r = reports.find(report => report.project === project);
            return r ? `| ${project} | disponible | ${r.firstPass} | ${Number(r.stats?.flaky || 0)} | ${r.retryAttempts} | ${r.stable} |` :
                `| ${project} | ${expectedProjects.includes(project) ? 'rapport absent (attendu)' : 'non exécuté (non attendu)'} | — | — | — | — |`;
        }).join('\n') + '\n';
    fs.writeFileSync(path.join(output, 'summary.md'), summary, { flag: 'wx' });
    console.log(JSON.stringify({ syntheticDiagnostics: exported.length, projects: [...new Set(exported.map(f => f.project))] }));
    return exported;
}
if (require.main === module) {
    if (process.argv.length !== 3) throw Error('Usage: node tools/testDiagnostics.js ABSOLUTE_NEW_OUTPUT');
    collect(process.argv[2], SOURCE_ROOT, process.env.DIAGNOSTIC_API_ONLY === 'true' ? ['api'] : projects)
        .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { beginRun, recordRun, collect, scrub, selected, sanitizeTrace, zipEntries, makeZip, report, requireZeroFirefoxRetries };
