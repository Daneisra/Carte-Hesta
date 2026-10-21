#!/usr/bin/env node
// Independent Linux validation only. No host configuration changes or production paths.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
function main(args = process.argv.slice(2)) {
    if (process.platform !== 'linux' || process.versions.node.split('.')[0] !== '22') throw Error('Supported isolated Linux with Node 22 is required; preparation is not a passing result');
    if (args.length && (args.length !== 1 || args[0] !== '--routing-only')) throw Error('Use no arguments or --routing-only');
    const root = path.resolve(__dirname, '..');
    const registry = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/server/registry/index.js'));
    const env = { PATH: process.env.PATH, HOME: '/tmp', TMPDIR: '/tmp', LANG: 'C.UTF-8', CI: '1', PLAYWRIGHT_BROWSERS_PATH: registry.registryDirectory };
    if (!args.length) {
        for (const toolArgs of [['-version'], ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']]) {
            const result = spawnSync('actionlint', toolArgs, { cwd: root, stdio: 'inherit', env });
            if (result.error || result.status !== 0) throw Error('Independent actionlint validation is mandatory and did not pass');
        }
    }
    const suites = args.length ? [['--test', 'tests/deployment/linux.test.cjs']] : [
        ['tools/lintEncoding.js'], ['tools/runIsolatedTests.js', '--unit'], ['tools/runIsolatedTests.js', '--storage'],
        ['tools/runIsolatedTests.js', '--publication'], ['--test', 'tests/isolation/*.test.cjs'], ['--test', 'tests/deployment/*.test.cjs'],
        ['tools/runIsolatedTests.js', '--project=api'], ['tools/runIsolatedTests.js', '--project=chromium'], ['tools/runIsolatedTests.js', '--project=firefox'],
        ['tools/benchmarkSynthetic.js']
    ];
    for (const suite of suites) {
        const result = spawnSync(process.execPath, suite, { cwd: root, stdio: 'inherit', env });
        if (result.error || result.status !== 0) throw Error(`Linux validation failed: ${suite.join(' ')}`);
    }
    console.log(JSON.stringify({ linuxExecuted: true, fullValidation: !args.length, actionlintPassed: !args.length, suites: suites.length }));
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { main };
