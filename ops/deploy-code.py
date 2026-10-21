#!/usr/bin/python3 -I
"""Prepared host controller. Never install/run on production without separate approval.

Only app/public are replaced. Nginx, data, media, secrets, PM2 configuration and
other services are not edited. A failed activation leaves public maintenance on.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import urllib.request

NODE = '/opt/node-v22.23.2-linux-x64/bin/node'
SERVICE = 'pm2-cartehesta.service'
VERIFIER = Path('/usr/local/lib/cartehesta-release-verifier')


def verify_release(candidate, revision, checksum):
    subprocess.run([NODE, str(VERIFIER / 'tools/deployment.js'), 'verify', str(candidate), revision, checksum],
                   check=True, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                   env={'PATH': '/usr/bin:/bin', 'HOME': '/root'})


def tree(root):
    result = {}
    total = 0
    def visit(p):
        nonlocal total
        s = p.lstat()
        if stat.S_ISLNK(s.st_mode):
            raise ValueError('E_CODE_LINK')
        key = p.relative_to(root).as_posix()
        if stat.S_ISDIR(s.st_mode):
            result[key] = {'directory': True, 'mode': stat.S_IMODE(s.st_mode)}
            for child in sorted(p.iterdir()):
                visit(child)
        elif stat.S_ISREG(s.st_mode) and s.st_nlink == 1:
            total += s.st_size
            if total > 32 * 1024 * 1024 or len(result) >= 2048:
                raise ValueError('E_CODE_BOUNDS')
            h = hashlib.sha256()
            with p.open('rb') as content:
                for block in iter(lambda: content.read(256 * 1024), b''):
                    h.update(block)
            result[key] = {'size': s.st_size, 'mode': stat.S_IMODE(s.st_mode), 'sha256': h.hexdigest()}
        else:
            raise ValueError('E_CODE_TYPE')
    visit(root)
    return result


class Deployment:
    # Injectable services/health for synthetic tests; CLI always uses fixed roots.
    def __init__(self, base, gates, incoming, service, health, verify, payload_layout=False):
        self.base, self.gates, self.incoming = map(Path, (base, gates, incoming))
        self.service, self.health, self.verify = service, health, verify
        self.payload_layout = payload_layout

    def execute(self, revision, checksum, reopen=False, ticket=None):
        if not re.fullmatch('[a-f0-9]{40}', revision) or not re.fullmatch('[a-f0-9]{64}', checksum):
            raise ValueError('E_REVISION_OR_CHECKSUM')
        # All locations must already exist as real directories, never aliases.
        for p in (self.base, self.gates, self.incoming):
            for ancestor in (p, *p.parents):
                if ancestor.is_symlink():
                    raise ValueError('E_ROOT_LINK')
            if not p.is_dir():
                raise ValueError('E_ROOT_MISSING')
        candidate = self.incoming / revision
        if self.payload_layout:
            if not re.fullmatch('transfer-[a-f0-9]{32}', ticket or ''):
                raise ValueError('E_INCOMING_TICKET')
            candidate = self.incoming / ticket / 'payload'
        tree(candidate)
        before = {n: tree(self.base / n) for n in ('app', 'public')}
        gate = self.gates / 'OPEN_APPROVED'
        if os.path.lexists(gate) and (not stat.S_ISREG(gate.lstat().st_mode) or gate.is_symlink() or gate.stat().st_size):
            raise ValueError('E_GATE_TYPE')
        # Exclusive receipt directory retained even on failure: never retry implicitly.
        run = Path(tempfile.mkdtemp(prefix='deployment-', dir=self.base))
        run.chmod(0o700)
        (run / 'before.private.json').write_text(json.dumps(before) + '\n')
        stage = run / 'candidate'
        shutil.copytree(candidate, stage, symlinks=True)
        if tree(candidate) != tree(stage):
            raise ValueError('E_INCOMING_CHANGED')
        # The CLI verifier is frozen outside app/public and outside deploy-key
        # authority. Never execute any current or previous application as root.
        self.verify(stage, revision, checksum)
        for n in ('app', 'public'):
            for p in (stage / n, *(stage / n).rglob('*')):
                p.chmod(0o755 if p.is_dir() else 0o644)
        previous = run / 'previous'
        previous.mkdir(mode=0o700)
        held = self.gates / (run.name + '.OPEN_APPROVED.held')
        had_gate = gate.exists()
        stopped = False
        moved, installed = [], []
        try:
            if had_gate:
                # Same filesystem: never rename /run into /srv.
                gate.rename(held)
            self.service('stop')
            stopped = True
            if {n: tree(self.base / n) for n in ('app', 'public')} != before:
                raise ValueError('E_OLD_CODE_CHANGED')
            for n in ('app', 'public'):
                (self.base / n).rename(previous / n)
                moved.append(n)
                (stage / n).rename(self.base / n)
                installed.append(n)
            self.service('start')
            self.health()
            if {n: tree(previous / n) for n in moved} != before:
                raise ValueError('E_ROLLBACK_CODE_CHANGED')
            (run / 'active.private.json').write_text(json.dumps({n: tree(self.base / n) for n in ('app', 'public')}) + '\n')
            outcome = {'status': 'Activated', 'revision': revision, 'receipt': run.name, 'publicReopened': bool(had_gate and reopen)}
            (run / 'result.private.json').write_text(json.dumps(outcome) + '\n')
            # External verification is still required by the caller. Reopen only
            # on explicit approval, and never turn a previously closed site on.
            if had_gate and reopen:
                if os.path.lexists(gate):
                    raise ValueError('E_CONCURRENT_GATE')
                held.rename(gate)
        except Exception as failure:
            # First preserve fail-closed public routing. Rollback code only, never data.
            if gate.exists():
                gate.rename(self.gates / (run.name + '.OPEN_APPROVED.failed'))
            rollback_error = None
            try:
                self.service('stop')
                if moved:
                    failed = run / 'failed'
                    failed.mkdir(mode=0o700)
                    for n in reversed(moved):
                        if n in installed:
                            (self.base / n).rename(failed / n)
                        (previous / n).rename(self.base / n)
                    if {n: tree(self.base / n) for n in ('app', 'public')} != before:
                        raise ValueError('E_ROLLBACK_INTEGRITY')
                if stopped:
                    self.service('start')
                    self.health()
            except Exception as rollback:
                rollback_error = type(rollback).__name__
            outcome = {'status': 'StoppedMaintenance', 'exceptionType': type(failure).__name__,
                       'rollbackVerified': stopped and rollback_error is None, 'rollbackExceptionType': rollback_error}
            (run / 'result.private.json').write_text(json.dumps(outcome) + '\n')
            raise RuntimeError('E_DEPLOYMENT_STOPPED_MAINTENANCE') from None
        return outcome

    def rollback(self, revision, receipt):
        if not re.fullmatch('[a-f0-9]{40}', revision) or not re.fullmatch('deployment-[a-z0-9_]{8}', receipt):
            raise ValueError('E_ROLLBACK_REFERENCE')
        run = self.base / receipt
        for p in (run, *run.parents):
            if p.is_symlink():
                raise ValueError('E_ROLLBACK_LINK')
        value = json.loads((run / 'result.private.json').read_text())
        before = json.loads((run / 'before.private.json').read_text())
        active = json.loads((run / 'active.private.json').read_text())
        if value.get('status') != 'Activated' or value.get('revision') != revision or value.get('receipt') != receipt:
            raise ValueError('E_ROLLBACK_STATE')
        if {n: tree(self.base / n) for n in ('app', 'public')} != active or {n: tree(run / 'previous' / n) for n in ('app', 'public')} != before:
            raise ValueError('E_ROLLBACK_CODE_CHANGED')
        (run / 'rollback-started').open('x').close()
        gate = self.gates / 'OPEN_APPROVED'
        if os.path.lexists(gate):
            if gate.is_symlink() or not gate.is_file() or gate.stat().st_size:
                raise ValueError('E_GATE_TYPE')
            gate.rename(self.gates / (receipt + '.OPEN_APPROVED.external-failed'))
        failed = run / 'failed-external'
        failed.mkdir(mode=0o700)
        try:
            self.service('stop')
            for n in ('app', 'public'):
                (self.base / n).rename(failed / n)
                (run / 'previous' / n).rename(self.base / n)
            if {n: tree(self.base / n) for n in ('app', 'public')} != before:
                raise ValueError('E_ROLLBACK_INTEGRITY')
            self.service('start')
            self.health()
            outcome = {'status': 'RolledBackMaintenance', 'revision': revision, 'receipt': receipt, 'publicReopened': False}
        except Exception as error:
            (run / 'rollback.private.json').write_text(json.dumps({'status': 'StoppedMaintenance', 'exceptionType': type(error).__name__}) + '\n')
            raise RuntimeError('E_ROLLBACK_STOPPED_MAINTENANCE') from None
        (run / 'rollback.private.json').write_text(json.dumps(outcome) + '\n')
        return outcome


def health():
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    deadline = time.monotonic() + 30
    # Readiness polling is bounded; it is not a fixed delay masking a test race.
    while True:
        try:
            with opener.open('http://127.0.0.1:4173/health', timeout=3) as response:
                payload = response.read(4097)
                if len(payload) <= 4096 and response.status == 200 and json.loads(payload).get('status') == 'ok':
                    return
        except (OSError, ValueError):
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError('E_BACKEND_HEALTH')
        time.sleep(0.5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('revision')
    parser.add_argument('manifest_sha256')
    parser.add_argument('--reopen', action='store_true')
    parser.add_argument('--rollback', action='store_true')
    parser.add_argument('--ticket')
    args = parser.parse_args()
    if os.name != 'posix' or os.geteuid() != 0:
        raise PermissionError('E_ROOT_CONTROLLER_REQUIRED')
    os.umask(0o077)
    watched_signals = (signal.SIGTERM, signal.SIGHUP, signal.SIGINT)
    def interrupted(_signal, _frame):
        # Finish the bounded rollback rather than letting a second disconnect
        # interrupt it. SIGKILL/power loss remain fail-closed operator incidents.
        for watched in watched_signals:
            signal.signal(watched, signal.SIG_IGN)
        raise RuntimeError('E_DEPLOYMENT_INTERRUPTED')
    for watched in watched_signals:
        signal.signal(watched, interrupted)
    for root in (Path('/srv/cartehesta'), Path('/run/cartehesta-gates')):
        if root.is_symlink() or root.stat().st_uid != 0 or root.stat().st_mode & 0o022:
            raise PermissionError('E_CONTROLLER_ROOT_PERMISSIONS')
    # The installed verifier is trusted root code. No candidate-supplied code is
    # ever executed as root; the application runs under its dedicated service UID.
    for code_root in (VERIFIER, Path('/srv/cartehesta/app'), Path('/srv/cartehesta/public')):
        tree(code_root)
        for p in (code_root, *code_root.rglob('*')):
            if p.stat().st_uid != 0 or p.stat().st_mode & 0o022:
                raise PermissionError('E_INSTALLED_CODE_PERMISSIONS')
    # Lock is ephemeral kernel state. No writer-lock or old receipt is removed.
    import fcntl
    fd = os.open('/run/lock/cartehesta-deploy.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    with os.fdopen(fd, 'a', encoding='utf8') as lock:
        st = os.fstat(lock.fileno())
        if st.st_uid != 0 or st.st_nlink != 1 or not stat.S_ISREG(st.st_mode) or stat.S_IMODE(st.st_mode) != 0o600:
            raise PermissionError('E_CONTROLLER_LOCK_PERMISSIONS')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def service(action):
            subprocess.run(['/usr/bin/systemctl', action, SERVICE], check=True, timeout=90,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # The incoming directory must be private to the restricted deployment account.
        # Its ownership and the dedicated unit/Node pin are installation preconditions.
        controller = Deployment('/srv/cartehesta', '/run/cartehesta-gates',
                                '/srv/cartehesta-incoming', service, health, verify_release, payload_layout=True)
        if args.rollback:
            if args.reopen:
                raise ValueError('E_ROLLBACK_REOPEN')
            result = controller.rollback(args.revision, args.manifest_sha256)
        else:
            result = controller.execute(args.revision, args.manifest_sha256, args.reopen, args.ticket)
        print(json.dumps(result))


if __name__ == '__main__':
    main()
