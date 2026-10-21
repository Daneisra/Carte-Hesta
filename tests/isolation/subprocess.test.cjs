const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createSandbox, removeSandbox, cleanEnvironment } = require('../support/sandbox.cjs');

test('test workers cannot escape through shell clients or unguarded Node children', () => {
    const sandbox = createSandbox();
    try {
        const code = `
            const assert = require('node:assert/strict');
            const cp = require('node:child_process');
            const blocked = fn => assert.throws(fn, { code: 'E_TEST_BOUNDARY' });
            blocked(() => cp.execFileSync('curl', ['https://example.invalid']));
            blocked(() => cp.spawn('curl', ['https://example.invalid']));
            blocked(() => cp.spawnSync('curl', ['https://example.invalid']));
            blocked(() => cp.spawn(process.execPath, ['-e', ''], { env: {} }));
            blocked(() => cp.exec('echo should-not-run'));
        `;
        const result = spawnSync(process.execPath, ['-e', code], {
            cwd: sandbox.app, env: cleanEnvironment(sandbox, { CARTE_TEST_PROCESS: 'runner' }),
            encoding: 'utf8', timeout: 15_000, windowsHide: true
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally { removeSandbox(sandbox.root, sandbox.token); }
});
