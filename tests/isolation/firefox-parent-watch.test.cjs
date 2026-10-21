const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { SOURCE_ROOT, verifySandbox, removeSandbox } = require('../support/sandbox.cjs');

test('minimal Firefox diagnostics without IPC stop their child when the owner dies', async () => {
    // The supervisor executes only this synthetic control program; its child retains the full guard.
    const source = `
        const path = require('node:path');
        const { spawn } = require('node:child_process');
        const { createSandbox, cleanEnvironment } = require(${JSON.stringify(path.join(SOURCE_ROOT, 'tests/support/sandbox.cjs'))});
        const sandbox = createSandbox();
        const env = cleanEnvironment(sandbox, { CARTE_TEST_PROCESS: 'runner' });
        env.NODE_OPTIONS += ' --require=' + JSON.stringify(${JSON.stringify(path.join(SOURCE_ROOT, 'tests/firefox/parentWatch.cjs').split(path.sep).join('/'))});
        const child = spawn(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000);'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stderr.pipe(process.stderr);
        child.stdout.once('data', () => process.stdout.write(JSON.stringify({ root: sandbox.root, token: sandbox.token, owner: process.pid, child: child.pid }) + '\\n'));
    `;
    const env = { TMP: os.tmpdir(), TEMP: os.tmpdir(), TMPDIR: os.tmpdir() };
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key];
    const owner = spawn(process.execPath, ['-e', source], { env, cwd: SOURCE_ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let child;
    let identity;
    let stderr = '';
    owner.stderr.on('data', data => { stderr += data.toString(); });
    try {
        identity = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(Error('Synthetic child did not start: ' + stderr)), 10_000);
            owner.once('error', error => { clearTimeout(timeout); reject(error); });
            owner.stdout.once('data', data => { clearTimeout(timeout); try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
        });
        assert.equal(identity.owner, owner.pid);
        assert.equal(verifySandbox(identity.root, identity.token).ownerPid, owner.pid);
        child = identity.child;
        const exit = new Promise(resolve => owner.once('exit', resolve));
        owner.kill('SIGTERM');
        await exit;
        const deadline = Date.now() + 5000;
        let alive = true;
        while (alive && Date.now() < deadline) {
            try { process.kill(child, 0); }
            catch (error) { if (error.code !== 'ESRCH') throw error; alive = false; }
            if (alive) await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(alive, false, 'The guarded child must exit after losing its diagnostic owner');
        child = undefined;
    } finally {
        if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGTERM');
        if (child) { try { process.kill(child, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
        if (identity) removeSandbox(identity.root, identity.token);
    }
});
