"""No network, production data, root CLI, systemd or real SSH calls."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import zipfile


def load(n, p):
    s = importlib.util.spec_from_file_location(n, p)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


controller, download, client = [load('synthetic' + str(i), p) for i, p in enumerate(sys.argv[1:])]
checks = 0


def refuses(call):
    try:
        call()
    except Exception:
        return
    raise AssertionError('Expected refusal')


for mode in ('updated-reference', 'closed-maintenance', 'candidate-health-failure', 'both-unhealthy', 'tamper-active', 'rollback-external', 'rollback-explicit-closed'):
    with tempfile.TemporaryDirectory(prefix='cartehesta-auto-synthetic-') as tmp:
        root = Path(tmp)
        base, gates, incoming = (root / n for n in ('base', 'gates', 'incoming'))
        for p in (base, gates, incoming):
            p.mkdir()
        revision, digest = 'a' * 40, 'b' * 64
        candidate = incoming / revision
        candidate.mkdir()
        for group in ('app', 'public'):
            (base / group).mkdir()
            (base / group / 'code').write_text('immediate-healthy-hotfix')
            (candidate / group).mkdir()
            (candidate / group / 'code').write_text('new')
        (base / 'data').mkdir()
        (base / 'data' / 'private').write_text('synthetic-private-canary')
        before = {g: controller.tree(base / g) for g in ('app', 'public')}
        data = controller.tree(base / 'data')
        gate = gates / 'OPEN_APPROVED'
        if mode != 'closed-maintenance':
            gate.touch()
        calls = []
        def health():
            calls.append('health')
            if mode == 'candidate-health-failure' and len(calls) == 1 or mode == 'both-unhealthy':
                raise RuntimeError('synthetic unhealthy')
            if mode == 'tamper-active' and len(calls) == 1:
                (base / 'public' / 'code').write_text('synthetic-tamper')
        d = controller.Deployment(base, gates, incoming, lambda _: None, health, lambda *_: None)
        if mode == 'both-unhealthy':
            refuses(lambda: d.execute(revision, digest, True))
            assert not gate.exists()
        else:
            result = d.execute(revision, digest, mode != 'rollback-explicit-closed')
            run = base / result['receipt']
            # Regression: the immediate pre-deploy hotfix differs from any old baseline.
            assert json.loads((run / 'before.private.json').read_text()) == before
            assert result['manifestSha256'] == digest and result['revision'] == revision
            if mode in ('candidate-health-failure', 'tamper-active'):
                assert result['status'] == 'RolledBackHealthy' and gate.exists()
                assert {g: controller.tree(base / g) for g in ('app', 'public')} == before
                closed = d.maintenance(revision, result['receipt'])
                assert closed['status'] == 'StoppedMaintenance' and not gate.exists()
                refuses(lambda: d.maintenance(revision, result['receipt']))
            elif mode in ('rollback-external', 'rollback-explicit-closed'):
                rollback = d.rollback(revision, result['receipt'])
                assert rollback['status'] == 'RolledBackHealthy'
                assert gate.exists() == (mode == 'rollback-external')
                assert {g: controller.tree(base / g) for g in ('app', 'public')} == before
                refuses(lambda: d.rollback(revision, result['receipt']))
                if mode == 'rollback-external':
                    assert d.maintenance(revision, result['receipt'])['publicReopened'] is False
                    assert not gate.exists()
            else:
                assert result['status'] == 'Activated' and gate.exists() == (mode != 'closed-maintenance')
        assert controller.tree(base / 'data') == data
        checks += 1


def zipped(name='app/code', payload=b'synthetic'):
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w') as z:
        z.writestr(name, payload)
    return b.getvalue()


with tempfile.TemporaryDirectory(prefix='cartehesta-zip-synthetic-') as tmp:
    root = Path(tmp)
    b = zipped()
    digest = hashlib.sha256(b).hexdigest()
    download.extract(b, digest, root / 'good')
    assert (root / 'good' / 'app/code').read_bytes() == b'synthetic'
    refuses(lambda: download.extract(b, digest, root / 'good'))
    refuses(lambda: download.extract(b, '0' * 64, root / 'bad-digest'))
    checks += 3
    for i, name in enumerate(('../private', '/outside', 'public/../outside', 'public//ambiguous', 'data/private.json', 'release-manifest.json/extra')):
        b = zipped(name)
        refuses(lambda: download.extract(b, hashlib.sha256(b).hexdigest(), root / ('bad' + str(i))))
        checks += 1
    code = root / 'code.tar'
    code.write_bytes(b'synthetic-code')
    cfg = {'ARCHIVE_SHA256': hashlib.sha256(code.read_bytes()).hexdigest(), 'REVISION': 'a' * 40,
           'MANIFEST_SHA256': 'b' * 64, 'REOPEN': 'true'}
    for mode in ('external-failure-recovered', 'internal-failure-recovered', 'rollback-also-unhealthy', 'wrong-manifest'):
        calls, health_calls = [], []
        def runner(args, _):
            command = args[-1]
            calls.append(command)
            status = 'StoppedMaintenance' if command.startswith('maintenance ') else 'RolledBackHealthy' if command.startswith('rollback ') or mode == 'internal-failure-recovered' else 'Activated'
            return json.dumps({'status': status, 'revision': cfg['REVISION'], 'manifestSha256': 'c' * 64 if mode == 'wrong-manifest' else cfg['MANIFEST_SHA256'],
                               'receipt': 'deployment-abcdefgh', 'publicReopened': status != 'StoppedMaintenance'}).encode()
        def external(_):
            health_calls.append(True)
            if mode == 'rollback-also-unhealthy' or mode == 'external-failure-recovered' and len(health_calls) == 1:
                raise RuntimeError('synthetic external failure')
        refuses(lambda: client.deploy(cfg, code, ['synthetic-ssh'], runner, external))
        assert len(calls) == {'external-failure-recovered': 2, 'internal-failure-recovered': 1, 'rollback-also-unhealthy': 3, 'wrong-manifest': 1}[mode]
        assert sum(c.startswith('deploy ') for c in calls) == 1
        if mode == 'wrong-manifest':
            assert not health_calls
        checks += 1
print(json.dumps({'scenarios': checks, 'productionWrites': 0, 'networkCalls': 0}))
