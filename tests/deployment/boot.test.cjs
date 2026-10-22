const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const os = require('node:os');

test('clean restart handoff, maintenance, incident recovery and HTTPS policy use only synthetic paths and services', () => {
    const result = JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3',
        ['-I', '-B', path.join(__dirname, 'boot_synthetic.py'), path.resolve(__dirname, '../../ops/boot-public.py')],
        { encoding: 'utf8', windowsHide: true }));
    assert.equal(result.tests, 33);
    assert.equal(result.failures, 0); assert.equal(result.errors, 0);
    assert.equal(result.skipped, process.platform === 'win32' ? 2 : 0);
});

test('native systemd validates boot unit syntax and ordering without starting a service', { skip: process.platform !== 'linux' ? 'Native systemd verification runs in Linux CI' : false }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cartehesta-systemd-synthetic-'));
    try {
        const source = path.resolve(__dirname, '../../ops/cartehesta-public-boot.service');
        const unit = fs.readFileSync(source, 'utf8').replaceAll('/usr/local/libexec/cartehesta/boot-public.py', path.resolve(__dirname, '../../ops/boot-public.py'));
        const file = path.join(root, 'cartehesta-public-boot.service');
        fs.writeFileSync(file, unit);
        fs.writeFileSync(path.join(root, 'pm2-cartehesta.service'), '[Service]\nType=oneshot\nExecStart=/usr/bin/true\n');
        const result = spawnSync('systemd-analyze', ['verify', '--man=no', file], { encoding: 'utf8', timeout: 15000 });
        assert.equal(result.status, 0, result.stderr);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('boot unit captures before dedicated shutdown without changing Deploy or installing candidate root code', () => {
    const unit = fs.readFileSync(path.resolve(__dirname, '../../ops/cartehesta-public-boot.service'), 'utf8');
    assert(unit.includes('After=network.target pm2-cartehesta.service nginx.service'));
    assert(unit.includes('RemainAfterExit=yes')); assert(unit.includes('RuntimeDirectoryPreserve=yes'));
    assert(unit.includes('StateDirectoryMode=0700')); assert(unit.includes('ProtectSystem=strict'));
    assert(!unit.includes('Requires=')); // Failure must still consume intent and retain 503.
    assert(!/Restart=always|ExecStart=.*touch|systemctl restart|pm2 restart/.test(unit));
    const release = require('../../tools/deployment/release');
    assert(!release.OPS.includes('boot-public.py')); // Frozen root policy remains operator-managed.
    const deploy = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/deploy.yml'), 'utf8');
    assert(deploy.includes('workflow_dispatch:')); assert(!/^  push:/m.test(deploy)); assert(deploy.includes('workflow_run:'));
    assert(deploy.includes('environment: cartehesta-production'));
});
