#!/usr/bin/env node
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DISCORD_ID } = require('../tests/fixtures/application.cjs');
const { cleanEnvironment, verifySandbox, installFirefoxUpdatePolicy } = require('../tests/support/sandbox.cjs');

async function startIsolatedServer(sandbox, overrides = {}) {
    verifySandbox(sandbox.root, sandbox.token);
    const allowedOverrides = ['ADMIN_API_TOKEN', 'USER_API_TOKENS', 'SESSION_SECRET', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI', 'DISCORD_ADMIN_IDS'];
    if (Object.keys(overrides).some(key => !allowedOverrides.includes(key))) throw new Error('Unsafe test server override');
    const stub = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET' && pathname === '/_firefox/updates.xml') {
            res.setHeader('Content-Type', 'application/xml');
            res.end('<?xml version="1.0"?><updates/>');
        } else if (req.method === 'POST' && pathname === '/api/oauth2/token') {
            req.resume();
            res.end(JSON.stringify({ access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in: 3600 }));
        } else if (req.method === 'GET' && pathname === '/api/v10/users/@me') {
            res.end(JSON.stringify({ id: DISCORD_ID, username: 'Test User', global_name: 'Test User' }));
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ status: 'error', message: 'No external service in tests' }));
        }
    });
    // A rejecting local proxy is a second barrier below browser request routing.
    stub.on('connect', (_req, socket) => { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
    await new Promise((resolve, reject) => {
        stub.once('error', reject);
        stub.listen(0, '127.0.0.1', resolve);
    });
    const stubPort = stub.address().port;
    let child;
    let stopping = false;
    const stop = async () => {
        stopping = true;
        if (child && child.exitCode === null && child.signalCode === null) {
            const exited = new Promise(resolve => child.once('exit', resolve));
            if (child.connected) child.send({ type: 'carte-test-stop', token: sandbox.token });
            else child.kill('SIGTERM');
            const watchdog = setTimeout(() => child.kill('SIGTERM'), 10_000);
            await exited;
            clearTimeout(watchdog);
        }
        stub.closeAllConnections?.();
        await new Promise(resolve => stub.close(resolve));
    };
    try {
        const firefoxDirectory = path.join(sandbox.root, 'tmp', 'firefox-' + stubPort);
        require('node:fs').mkdirSync(firefoxDirectory);
        installFirefoxUpdatePolicy(firefoxDirectory, `http://127.0.0.1:${stubPort}`);
        sandbox.firefoxPolicy = path.join(firefoxDirectory, 'distribution', 'policies.json');
        const env = cleanEnvironment(sandbox, {
            CARTE_TEST_PROCESS: 'app', CARTE_TEST_ALLOWED_PORTS: JSON.stringify([stubPort]),
            HOST: '127.0.0.1', PORT: '0',
            ADMIN_API_TOKEN: 'synthetic-admin-token', USER_API_TOKENS: '',
            SESSION_SECRET: 'synthetic-test-session-secret-not-for-production', COOKIE_SECURE: 'false',
            DISCORD_CLIENT_ID: 'synthetic-client', DISCORD_CLIENT_SECRET: 'synthetic-secret',
            DISCORD_ADMIN_IDS: DISCORD_ID, DISCORD_API_ORIGIN: `http://127.0.0.1:${stubPort}`,
            DISCORD_REDIRECT_URI: 'http://127.0.0.1/auth/discord/callback',
            REMOTE_SYNC_URL: '', REMOTE_SYNC_TOKEN: '',
            ...overrides
        });
        child = spawn(process.execPath, [path.join(sandbox.app, 'server.js')], {
            cwd: sandbox.app, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true
        });
        const port = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Copied test server did not start')), 15_000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('exit', code => { clearTimeout(timer); reject(new Error(`Copied test server exited (${code})`)); });
            child.on('message', message => {
                if (message?.type === 'carte-test-ready' && message.token === sandbox.token) {
                    clearTimeout(timer);
                    resolve(message.port);
                }
            });
        });
        const origin = `http://127.0.0.1:${port}`;
        const identity = await new Promise((resolve, reject) => {
            http.get(`${origin}/_test/identity`, response => {
                let body = '';
                response.on('data', chunk => { body += chunk; });
                response.on('end', () => {
                    try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
                });
            }).on('error', reject);
        });
        if (identity.token !== sandbox.token || identity.pid !== child.pid) throw new Error('Wrong test server identity');
        return { origin, port, stubPort, child, stop, get stopping() { return stopping; }, get stubStopped() { return !stub.listening; } };
    } catch (error) {
        await stop();
        throw error;
    }
}

if (require.main === module) {
    console.error('Use npm run test:api or npm run test:ui:chromium. Direct server startup is disabled.');
    process.exitCode = 1;
}
module.exports = { startIsolatedServer };
