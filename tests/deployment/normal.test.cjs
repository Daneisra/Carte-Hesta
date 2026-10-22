const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validate } = require('../../.github/scripts/verify-ci-run.cjs');
const REV = 'a'.repeat(40);
function sample() {
    return {
        workflow: { id: 1, path: '.github/workflows/ci.yml', state: 'active' },
        run: { workflow_id: 1, repository: { full_name: 'Daneisra/Carte-Hesta' }, head_repository: { full_name: 'Daneisra/Carte-Hesta' },
            event: 'push', head_branch: 'main', head_sha: REV, status: 'completed', conclusion: 'success' },
        jobs: { total_count: 1, jobs: [{ name: 'Full Linux validation', conclusion: 'success', steps: [
            'Strict index gate (legacy debt must be removed before CI can pass)', 'Encoding and isolated unit/storage/publication suites',
            'Isolation, permissions, offline migration and rollback', 'API with isolation boundary enforcement',
            'Both browsers (Firefox is mandatory)', 'Build and verify a code-only candidate outside the checkout',
            'Preserve verified code-only candidate for reviewed migration'
        ].map(name => ({ name, conclusion: 'success' })) }] },
        artifacts: { total_count: 1, artifacts: [{ id: 3, name: 'cartehesta-code-' + REV, expired: false, size_in_bytes: 100, digest: 'sha256:' + 'b'.repeat(64) }] }
    };
}
test('manual deployment accepts only the exact full Linux push/main candidate', () => assert.equal(validate(sample(), REV, REV).id, 3));
for (const [name, mutate] of [
    ['pull request', s => s.run.event = 'pull_request'],
    ['manually dispatched CI', s => s.run.event = 'workflow_dispatch'],
    ['API diagnostics', s => s.jobs.jobs[0].name = 'API diagnostics only'],
    ['skipped Firefox', s => s.jobs.jobs[0].steps[4].conclusion = 'skipped'],
    ['other repository', s => s.run.head_repository.full_name = 'attacker/Carte-Hesta'],
    ['other workflow', s => s.workflow.path = '.github/workflows/other.yml'],
    ['other revision', s => s.run.head_sha = 'c'.repeat(40)],
    ['failed CI', s => s.run.conclusion = 'failure'],
    ['unfinished CI', s => s.run.status = 'in_progress'],
    ['non-main branch', s => s.run.head_branch = 'feature'],
    ['foreign source run', s => s.run.repository.full_name = 'other/Carte-Hesta'],
    ['expired artifact', s => s.artifacts.artifacts[0].expired = true],
    ['incomplete jobs', s => s.jobs.total_count = 2],
    ['incomplete artifacts', s => s.artifacts.total_count = 2],
    ['ambiguous artifact', s => { s.artifacts.artifacts.push({ ...s.artifacts.artifacts[0] }); s.artifacts.total_count = 2; }],
    ['missing digest', s => delete s.artifacts.artifacts[0].digest]
]) test('manual deployment refuses ' + name, () => { const s = sample(); mutate(s); assert.throws(() => validate(s, REV, REV)); });
test('manual deployment refuses a candidate different from the dispatched main revision', () => assert.throws(() => validate(sample(), REV, 'c'.repeat(40))));

test('prepared host controller preserves data, rolls code back on failed health and never opens a closed gate', () => {
    // Python uses only a fresh TemporaryDirectory, injected service/health/verifier,
    // and fictional files. It never invokes CLI/root/systemctl/network functions.
    const program = String.raw`
import importlib.util, json, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location('controller', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
checks = 0
for mode in ('success-open', 'success-closed', 'health-failure', 'verifier-failure', 'partial-swap-failure'):
  with tempfile.TemporaryDirectory(prefix='cartehesta-controller-synthetic-') as d:
    root = pathlib.Path(d); base=root/'base'; gates=root/'gates'; incoming=root/'incoming'
    for p in (base, gates, incoming): p.mkdir()
    rev='a'*40; candidate=incoming/rev; candidate.mkdir()
    for n in ('app', 'public'):
      (base/n).mkdir(); (base/n/'code.txt').write_text('old')
      (candidate/n).mkdir(); (candidate/n/'code.txt').write_text('new')
    (base/'data').mkdir(); (base/'data'/'private.txt').write_text('synthetic private data')
    data=m.tree(base/'data'); original={n:m.tree(base/n) for n in ('app','public')}
    gate=gates/'OPEN_APPROVED'
    if mode != 'success-closed': gate.touch()
    commands=[]; health_calls=[]; original_rename=pathlib.Path.rename
    def service(action): commands.append(action)
    def health():
      health_calls.append(True)
      if mode == 'health-failure' and len(health_calls)==1: raise RuntimeError('synthetic failure')
    def verify(stage, revision, digest):
      assert revision == rev and digest == 'b'*64
      if mode == 'verifier-failure': raise RuntimeError('synthetic invalid manifest')
      if mode == 'partial-swap-failure':
        # Simulate a filesystem failure on installing public after app was installed.
        def failing_rename(p, target):
          if p.name=='public' and p.parent.name=='candidate': raise OSError('synthetic swap failure')
          return original_rename(p, target)
        pathlib.Path.rename=failing_rename
    deployment=m.Deployment(base,gates,incoming,service,health,verify)
    try:
      outcome=deployment.execute(rev,'b'*64,reopen=True)
      if mode.startswith('success'):
        assert outcome['status']=='Activated'
        assert all((base/n/'code.txt').read_text()=='new' for n in ('app','public'))
        assert gate.exists() == (mode == 'success-open')
      else:
        assert mode in ('health-failure','partial-swap-failure') and outcome['status']=='RolledBackHealthy'
        assert {n:m.tree(base/n) for n in ('app','public')} == original and gate.exists()
    except RuntimeError:
      assert mode.endswith('failure')
      assert {n:m.tree(base/n) for n in ('app','public')} == original
      if mode == 'verifier-failure': assert commands == [] and gate.exists()
      else: assert commands == ['stop','start','stop','start'] if mode=='health-failure' else commands==['stop','stop','start']
      if mode != 'verifier-failure': assert gate.exists()
    finally:
      if mode == 'partial-swap-failure': pathlib.Path.rename=original_rename
    assert m.tree(base/'data') == data
    assert all((candidate/n/'code.txt').read_text()=='new' for n in ('app','public'))
    assert len(list(base.glob('deployment-*'))) == 1
    checks+=1
print(json.dumps({'syntheticScenarios':checks,'dataUntouched':True}))
`;
    const result = JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3',
        ['-I', '-B', '-c', program, path.resolve(__dirname, '../../ops/deploy-code.py')], { encoding: 'utf8', windowsHide: true }));
    assert.deepEqual(result, { syntheticScenarios: 5, dataUntouched: true });
});
