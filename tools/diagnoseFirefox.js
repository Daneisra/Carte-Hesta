#!/usr/bin/env node
// No application is executed. All HTML, identities, profiles and stores are synthetic.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createSandbox, cleanEnvironment, removeSandbox, assertPlainPath, SOURCE_ROOT, installFirefoxUpdatePolicy } = require('../tests/support/sandbox.cjs');

async function main() {
    const options = { mode: 'library', attempts: 6, ipc: 'on', channelRef: 'off' };
    for (const arg of process.argv.slice(2)) {
        const match = /^--(mode|attempts|ipc|channelRef)=(.+)$/.exec(arg);
        if (!match) throw Error('Use --mode=library|runner --attempts=1..12 --ipc=on|off');
        options[match[1]] = match[1] === 'attempts' ? Number(match[2]) : match[2];
    }
    if (!['library', 'runner'].includes(options.mode) || !['on', 'off'].includes(options.ipc) || !['on', 'off'].includes(options.channelRef) || !Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 12) throw Error('Invalid diagnostic options');
    const sandbox = createSandbox();
    const requests = {};
    const server = http.createServer((req, res) => {
        requests[req.url] = (requests[req.url] || 0) + 1;
        res.setHeader('X-Carte-Test-Run', sandbox.token);
        if (req.url === '/_test/identity') {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ token: sandbox.token, pid: process.pid }));
        }
        if (req.url === '/_firefox/updates.xml') {
            res.setHeader('Content-Type', 'application/xml');
            return res.end('<?xml version="1.0"?><updates/>');
        }
        if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html');
            return res.end('<!doctype html><title>Synthetic</title><h1>Firefox synthetic probe</h1>');
        }
        res.writeHead(404); res.end();
    });
    server.on('connect', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    installFirefoxUpdatePolicy(path.join(sandbox.root, 'tmp'), origin);
    const core = path.dirname(require.resolve('playwright-core/package.json'));
    const cache = require(path.join(core, 'lib/server/registry/index.js')).registryDirectory;
    const env = cleanEnvironment(sandbox, {
        CARTE_TEST_PROCESS: 'runner', CARTE_TEST_ORIGIN: origin, CARTE_TEST_PROXY: origin,
        CARTE_TEST_ALLOWED_PORTS: JSON.stringify([server.address().port]),
        CARTE_TEST_BROWSER_CACHE: cache, PLAYWRIGHT_BROWSERS_PATH: cache,
        CARTE_FIREFOX_ATTEMPTS: String(options.attempts), CARTE_FIREFOX_CHANNEL_REF: options.channelRef
    });
    env.NODE_OPTIONS += ` --require="${path.join(SOURCE_ROOT, 'tests/firefox/parentWatch.cjs').split(path.sep).join('/')}"`;
    const args = options.mode === 'library' ? [path.join(SOURCE_ROOT, 'tests/firefox/library.cjs')] : [
        path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'), 'test',
        '--config=tests/firefox/playwright.config.cjs'
    ];
    console.log(`[firefox-probe] ${JSON.stringify(options)} ${sandbox.root}`);
    let child;
    let code = 1;
    let timedOut = false;
    const interrupt = () => child?.kill('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    try {
        child = spawn(process.execPath, args, { cwd: SOURCE_ROOT, env, windowsHide: true,
            stdio: ['ignore', 'inherit', 'inherit', ...(options.ipc === 'on' ? ['ipc'] : [])] });
        const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 120_000);
        try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', result => resolve(result ?? 1)); }); }
        finally { clearTimeout(timeout); }
    } finally {
        process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
        const violations = fs.readdirSync(sandbox.root).filter(name => /^boundary-\d+\.jsonl$/.test(name));
        if (violations.length) code = 1;
        const destination = path.join(SOURCE_ROOT, 'test-results', path.basename(sandbox.root));
        assertPlainPath(destination);
        fs.mkdirSync(destination);
        function copyResults(from, to) {
            assertPlainPath(from); assertPlainPath(to);
            fs.mkdirSync(to, { recursive: true });
            for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
                if (entry.isDirectory()) copyResults(path.join(from, entry.name), path.join(to, entry.name));
                else if (entry.isFile()) fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name), fs.constants.COPYFILE_EXCL);
                else throw Error('Unexpected diagnostic entry');
            }
        }
        copyResults(path.join(sandbox.root, 'results'), destination);
        fs.writeFileSync(path.join(destination, 'probe-summary.json'), JSON.stringify({ options, exitCode: code, timedOut, requests, versions: { node: process.versions.node, playwright: require('playwright/package.json').version, platform: process.platform, release: require('node:os').release() }, violations, serverStopped: !server.listening, childStopped: !child || child.exitCode !== null || child.signalCode !== null, sandbox: sandbox.root }, null, 2), { flag: 'wx' });
        console.log(`[firefox-probe] exit=${code}; diagnostics=${destination}`);
        if (code === 0) removeSandbox(sandbox.root, sandbox.token);
    }
    process.exitCode = code;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
