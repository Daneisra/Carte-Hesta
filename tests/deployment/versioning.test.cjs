const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { yaml } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'));
const { validateRelease } = require('../../tools/checkRelease');
const pkg = require('../../package.json'), lock = require('../../package-lock.json');
const { CHANGELOG } = require('../../js/shared/changelog.mjs');
const steps = yaml.parse(fs.readFileSync(path.join(__dirname, '../../.github/workflows/ci.yml'), 'utf8')).jobs['isolated-validation'].steps;
const gateName = 'Release publication readiness (main and PRs targeting main)';
const gate = steps.find(step => step.name === gateName);

test('preparation and publication checks are separate, with no successful main-targeted draft CI', () => {
    const preparation = steps.find(step => step.name === 'Encoding and isolated unit/storage/publication suites');
    assert(preparation.run.includes('node tools/checkRelease.js --base=HEAD^1'));
    assert(!preparation.run.includes('--ready'));
    assert.equal(gate.run, 'node tools/checkRelease.js --ready');
    assert(!gate['continue-on-error']);
    assert(steps.indexOf(gate) > steps.findIndex(step => step.name === 'Firefox isolated tests without retries'));
    assert(steps.indexOf(gate) < steps.findIndex(step => step.name === 'Build and verify a code-only candidate outside the checkout'));
    const draft = [{ ...CHANGELOG[0], status: 'draft', date: '' }, ...CHANGELOG.slice(1)];
    assert.equal(validateRelease(pkg, lock, draft).status, 'draft');
    assert.throws(() => validateRelease(pkg, lock, draft, { ready: true }), /E_RELEASE_NOT_READY.*fusion/);
});

for (const [name, event, ref, base, apiOnly, expected] of [
    ['push main', 'push', 'refs/heads/main', '', false, true],
    ['PR targeting main, including draft PRs', 'pull_request', 'refs/pull/42/merge', 'main', false, true],
    ['PR targeting another branch', 'pull_request', 'refs/pull/42/merge', 'develop', false, false],
    ['feature push', 'push', 'refs/heads/feature', '', false, false],
    ['full manual validation of main', 'workflow_dispatch', 'refs/heads/main', '', false, true],
    ['API-only diagnostics', 'workflow_dispatch', 'refs/heads/main', '', true, false]
]) test(`publication readiness condition: ${name}`, () => {
    const expression = gate.if.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
    const result = vm.runInNewContext(expression, { cancelled: () => false, steps: { tooling: { outcome: 'success' }, index: { outcome: 'success' } }, github: { event_name: event, ref, base_ref: base, event: { pull_request: { draft: true } } }, inputs: { api_only: apiOnly } }, { timeout: 1000 });
    assert.equal(result, expected);
});
