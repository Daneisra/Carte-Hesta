#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createSandbox, cleanEnvironment, assertPlainPath, removeSandbox, SOURCE_ROOT } = require('../tests/support/sandbox.cjs');
const { startIsolatedServer } = require('./devServerWithStub');

async function run(args) {
    const sandbox = createSandbox();
    const unit = args[0] === '--unit';
    const storage = args[0] === '--storage';
    const publication = args[0] === '--publication';
    let app;
    let runner;
    let interrupted = false;
    const interrupt = () => { interrupted = true; runner?.kill('SIGTERM'); };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    console.log(`[isolated-tests] ${sandbox.root}`);
    let code = 1;
    try {
        if (!unit && !storage && !publication) app = await startIsolatedServer(sandbox);
        const registry = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/server/registry/index.js'));
        const env = cleanEnvironment(sandbox, {
            CARTE_TEST_PROCESS: 'runner', CARTE_TEST_ORIGIN: app?.origin || '',
            CARTE_TEST_DEBUG: process.env.CARTE_TEST_DEBUG === '1' ? '1' : '',
            DEBUG: process.env.CARTE_TEST_DEBUG === '1' ? 'pw:browser,pw:protocol' : '',
            CARTE_TEST_PROXY: app ? `http://127.0.0.1:${app.stubPort}` : '',
            CARTE_TEST_ALLOWED_PORTS: JSON.stringify(app ? [app.port, app.stubPort] : []),
            PLAYWRIGHT_BROWSERS_PATH: registry.registryDirectory, CARTE_TEST_BROWSER_CACHE: registry.registryDirectory
        });
        const command = publication ? ['--test', path.join(SOURCE_ROOT, 'tests/publication/publication.test.cjs')] : storage ? ['--test', path.join(SOURCE_ROOT, 'tests/storage/storage.test.cjs')] : unit ? [path.join(SOURCE_ROOT, 'tests/unit/run.mjs')] : [path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'), 'test', ...args];
        runner = spawn(process.execPath, command, {
            cwd: SOURCE_ROOT, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true
        });
        if (app) app.child.on('exit', () => { if (!app.stopping) { interrupted = true; runner.kill('SIGTERM'); } });
        code = await new Promise((resolve, reject) => {
            runner.once('error', reject);
            runner.once('exit', result => resolve(result ?? 1));
        });
        if (interrupted) code = 1;
    } finally {
        await app?.stop();
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', interrupt);
        const violations = fs.readdirSync(sandbox.root).filter(name => /^boundary-\d+\.jsonl$/.test(name));
        if (violations.length) {
            console.error(`[isolated-tests] Boundary violations recorded: ${violations.join(', ')}`);
            const knownSystemProbes = new Set(['/proc/version', '/proc/self/cgroup', '/etc/os-release', '/usr/lib/os-release']);
            for (const name of violations) for (const line of fs.readFileSync(path.join(sandbox.root, name), 'utf8').split(/\r?\n/).filter(Boolean)) {
                try {
                    const entry = JSON.parse(line);
                    const target = String(entry.target);
                    console.error('[isolated-tests] blocked ' + JSON.stringify({ kind: entry.kind, target: knownSystemProbes.has(target) ? target : 'sha256:' + crypto.createHash('sha256').update(target).digest('hex') }));
                } catch { console.error('[isolated-tests] blocked record could not be decoded; raw content withheld'); }
            }
            code = 1;
        }
        // Export diagnostics only, not stores, browser profiles or application copies.
        const destination = path.join(SOURCE_ROOT, 'test-results', path.basename(sandbox.root));
        assertPlainPath(destination);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.mkdirSync(destination);
        function copyResults(source, target) {
            assertPlainPath(source);
            assertPlainPath(target);
            fs.mkdirSync(target, { recursive: true });
            for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
                const from = path.join(source, entry.name);
                const to = path.join(target, entry.name);
                assertPlainPath(from);
                if (entry.isDirectory()) copyResults(from, to);
                else if (entry.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
                else throw new Error('Unexpected diagnostics entry');
            }
        }
        copyResults(path.join(sandbox.root, 'results'), destination);
        fs.copyFileSync(path.join(sandbox.root, 'copied-code.json'), path.join(destination, 'copied-code.json'), fs.constants.COPYFILE_EXCL);
        const summary = {
            exitCode: code, sandbox: sandbox.root, testArgs: args, violations,
            serverStopped: !app || app.child.exitCode !== null || app.child.signalCode !== null,
            stubStopped: !app || app.stubStopped, runtimeRetained: true
        };
        if (code === 0) {
            try { removeSandbox(sandbox.root, sandbox.token); summary.runtimeRetained = false; }
            catch (error) { code = 1; summary.cleanupError = error.message; summary.exitCode = 1; }
        }
        fs.writeFileSync(path.join(destination, 'isolation-summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx' });
        console.log(`[isolated-tests] exit=${code}; diagnostics=${destination}`);
    }
    return code;
}

async function main() {
    const args = process.argv.slice(2);
    if (['--unit', '--storage', '--publication'].includes(args[0])) {
        if (args.length !== 1) throw new Error('Unsupported unit-test arguments');
        process.exitCode = await run(args);
        return;
    }
    // No overrides that could substitute another server, config or persistent storageState.
    const allowed = /^(?:--project=(?:api|chromium|firefox)|--headed|--update-snapshots|--list|--grep=.+|--reporter=(?:list|line))$/;
    if (args.some(arg => !allowed.test(arg))) throw new Error('Unsupported test option: use the documented isolated commands');
    const projects = args.filter(arg => arg.startsWith('--project='));
    if (projects.length > 1) throw new Error('Select a single project per isolated run');
    if (projects.length) process.exitCode = await run(args);
    else {
        for (const project of ['api', 'chromium', 'firefox']) {
            const code = await run([...args, `--project=${project}`]);
            if (code) { process.exitCode = code; break; }
        }
    }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
