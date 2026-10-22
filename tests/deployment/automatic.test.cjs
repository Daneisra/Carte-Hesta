const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trigger } = require('../../.github/scripts/verify-ci-run.cjs');
const revision = 'a'.repeat(40), id = '123';
const event = () => ({ action: 'completed', repository: { full_name: 'Daneisra/Carte-Hesta' }, workflow_run: {
    id: 123, name: 'CI isolated security', conclusion: 'success', event: 'push', head_sha: revision,
    head_branch: 'main', head_repository: { full_name: 'Daneisra/Carte-Hesta' }
} });
test('automatic deployment accepts an exact successful push/main CI and keeps exceptional dispatch confirmation', () => {
    assert.deepEqual(trigger('workflow_run', event(), revision, id), { revision, id });
    assert.deepEqual(trigger('workflow_dispatch', {}, revision, id, 'DEPLOY CARTE HESTA'), { revision, id });
    assert.throws(() => trigger('workflow_dispatch', {}, revision, id, ''));
});
for (const [name, change] of [
    ['failed CI', x => x.workflow_run.conclusion = 'failure'], ['manual CI', x => x.workflow_run.event = 'workflow_dispatch'],
    ['PR CI', x => x.workflow_run.event = 'pull_request'], ['fork', x => x.workflow_run.head_repository.full_name = 'other/Carte-Hesta'],
    ['other branch', x => x.workflow_run.head_branch = 'feature'], ['other workflow', x => x.workflow_run.name = 'Other'],
    ['other commit', x => x.workflow_run.head_sha = 'b'.repeat(40)], ['other run', x => x.workflow_run.id = 124],
    ['other repository', x => x.repository.full_name = 'other/Carte-Hesta'], ['unfinished CI', x => x.action = 'requested']
]) test('automatic trigger refuses ' + name, () => { const x = event(); change(x); assert.throws(() => trigger('workflow_run', x, revision, id)); });

test('fresh deployment references, safe reopening, rollback, maintenance and immutable ZIP use synthetic files only', () => {
    const result = JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', '-B',
        path.join(__dirname, 'automatic_synthetic.py'), path.resolve(__dirname, '../../ops/deploy-code.py'),
        path.resolve(__dirname, '../../.github/scripts/download-ci-artifact.py'),
        path.resolve(__dirname, '../../.github/scripts/transport-deploy.py')], { encoding: 'utf8', windowsHide: true }));
    assert(result.scenarios >= 15); assert.equal(result.productionWrites, 0); assert.equal(result.networkCalls, 0);
});
