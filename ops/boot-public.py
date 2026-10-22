#!/usr/bin/python3 -I
"""Clean-shutdown handoff of an existing public gate. Never installed by Deploy."""
import contextlib
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import subprocess
import sys
import uuid


class Refused(RuntimeError):
    pass


def require(value, code):
    if not value:
        raise Refused(code)


def trusted(path, owner=0, directory=False, private=False):
    s = path.lstat()
    require(not path.is_symlink() and (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)), 'E_FILE_TYPE')
    require(directory or s.st_nlink == 1, 'E_FILE_LINK')
    if os.name == 'posix':
        require(s.st_uid == owner and not s.st_mode & (0o077 if private else 0o022), 'E_FILE_PERMISSIONS')


def read_plain(path, limit=2 * 1024 * 1024, owner=0, private=False):
    trusted(path, owner, private=private)
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as f:
        b = f.read(limit + 1)
    require(len(b) <= limit, 'E_FILE_BOUND')
    return b


class Handoff:
    def __init__(self, state, gates, boot_id, fingerprint, health, owner=0):
        self.state, self.gates = Path(state), Path(gates)
        self.boot_id, self.fingerprint, self.health, self.owner = boot_id, fingerprint, health, owner

    @property
    def gate(self):
        return self.gates / 'OPEN_APPROVED'

    def roots(self):
        trusted(self.state, self.owner, directory=True, private=True)
        trusted(self.gates, self.owner, directory=True)

    def save(self, value):
        self.roots()
        target = self.state / 'handoff.json'
        if os.path.lexists(target):
            trusted(target, self.owner, private=True)
        temporary = self.state / ('handoff-' + uuid.uuid4().hex + '.tmp')
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump(value, f, sort_keys=True)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, target)
        if os.name == 'posix':
            fd = os.open(self.state, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)

    def closed(self):
        self.save({'format': 1, 'status': 'consumed', 'bootId': self.boot_id()})

    def load(self):
        target = self.state / 'handoff.json'
        if not os.path.lexists(target):
            return None
        value = json.loads(read_plain(target, owner=self.owner, private=True))
        require(isinstance(value, dict) and value.get('format') == 1 and value.get('status') in ('armed', 'consumed'), 'E_STATE_FORMAT')
        require(isinstance(value.get('bootId'), str) and re.fullmatch('[a-f0-9-]{36}', value['bootId']), 'E_BOOT_ID')
        if value['status'] == 'armed':
            require(re.fullmatch('[a-f0-9]{64}', value.get('fingerprint', '')) is not None, 'E_STATE_DIGEST')
        return value

    def gate_present(self):
        if not os.path.lexists(self.gate):
            return False
        trusted(self.gate, self.owner)
        require(self.gate.stat().st_size == 0, 'E_GATE_CONTENT')
        return True

    def fail_closed(self):
        # Preserve any existing gate for diagnosis, on the same /run filesystem.
        if os.path.lexists(self.gate):
            self.gate.rename(self.gates / ('boot-refused-' + uuid.uuid4().hex + '.gate'))

    def capture(self, stopping):
        self.roots()
        self.closed()  # Invalidate any old authorization before a potentially failing check.
        if not stopping:
            return {'status': 'Maintenance', 'reason': 'NotSystemShutdown'}
        if not self.gate_present():
            return {'status': 'Maintenance', 'reason': 'VoluntaryMaintenance'}
        digest = self.fingerprint()
        self.health()
        require(self.fingerprint() == digest and self.gate_present(), 'E_SHUTDOWN_CHANGED')
        self.save({'format': 1, 'status': 'armed', 'bootId': self.boot_id(), 'fingerprint': digest})
        return {'status': 'CleanShutdownArmed'}

    def restore(self):
        self.roots()
        value = self.load()
        self.closed()  # One use only, even if health, TLS or policy checks fail.
        if self.gate_present():
            self.fingerprint()
            self.health()
            return {'status': 'AlreadyOpenValidated'}
        if not value or value['status'] != 'armed':
            return {'status': 'Maintenance', 'reason': 'NoCleanShutdownAuthorization'}
        if value['bootId'] == self.boot_id():
            return {'status': 'Maintenance', 'reason': 'SameBootAuthorizationRefused'}
        require(self.fingerprint() == value['fingerprint'], 'E_CODE_OR_CONFIGURATION_CHANGED')
        self.health()
        require(self.fingerprint() == value['fingerprint'], 'E_STARTUP_CHANGED')
        fd = os.open(self.gate, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0), 0o644)
        try:
            os.fchmod(fd, 0o644)
            os.fsync(fd)
        finally:
            os.close(fd)
        return {'status': 'PublicRestored', 'reason': 'VerifiedCleanRestart'}


def production_fingerprint():
    entries = {}
    total = 0

    def visit(p):
        nonlocal total
        if p.is_dir() and not p.is_symlink():
            trusted(p, directory=True)
            for child in sorted(p.iterdir()):
                visit(child)
        else:
            b = read_plain(p, limit=32 * 1024 * 1024)
            total += len(b)
            require(total <= 32 * 1024 * 1024 and len(entries) < 2048, 'E_CODE_BOUND')
            entries[str(p)] = hashlib.sha256(b).hexdigest()
    for root in ('/srv/cartehesta/app', '/srv/cartehesta/public'):
        visit(Path(root))
    for name in ('/etc/systemd/system/pm2-cartehesta.service', '/etc/cartehesta/ecosystem.config.cjs',
                 '/etc/nginx/sites-available/cartehesta.conf', '/etc/nginx/snippets/cartehesta-routing.conf',
                 '/etc/nginx/snippets/cartehesta-recipe-routing.conf',
                 '/usr/local/libexec/cartehesta/boot-public.py', '/etc/systemd/system/cartehesta-public-boot.service'):
        visit(Path(name))
    return hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()


def production_health():
    clean = {'PATH': '/usr/sbin:/usr/bin:/bin', 'LANG': 'C.UTF-8'}
    for args in (['/usr/bin/systemctl', 'is-active', 'pm2-cartehesta.service'], ['/usr/bin/systemctl', 'is-active', 'nginx.service']):
        result = subprocess.run(args, capture_output=True, timeout=10, env=clean)
        require(result.returncode == 0, 'E_SERVICE_OR_NGINX')
    # Both public-backend and HTTPS-recipe listeners must remain loopback-only.
    for port in (4173, 4181):
        listeners = []
        for name in ('/proc/net/tcp', '/proc/net/tcp6'):
            for line in Path(name).read_text().splitlines()[1:]:
                fields = line.split()
                if fields[3] == '0A' and int(fields[1].split(':')[1], 16) == port:
                    listeners.append(fields[1].split(':')[0])
        require(listeners == ['0100007F'], 'E_NON_LOOPBACK_LISTENER')
    identity = subprocess.run(['/usr/bin/systemctl', 'show', 'pm2-cartehesta.service', '--property=User', '--value'], capture_output=True, timeout=5, env=clean)
    require(identity.returncode == 0 and identity.stdout.strip() == b'cartehesta', 'E_SERVICE_IDENTITY')
    lock = json.loads(Path('/srv/cartehesta/data/locks/writer.lock').read_text())
    require(isinstance(lock.get('pid'), int) and lock['pid'] > 1, 'E_BACKEND_PID')
    require(os.readlink('/proc/' + str(lock['pid']) + '/exe') == '/opt/node-v22.23.2-linux-x64/bin/node', 'E_NODE_RUNTIME')
    # RECIPE_ALLOWED is loopback-only and never authorizes public access.
    recipe = Path('/run/cartehesta-gates/RECIPE_ALLOWED')
    if not os.path.lexists(recipe):
        fd = os.open(recipe, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o644)
        os.fchmod(fd, 0o644)
        os.close(fd)
    trusted(recipe)
    require(recipe.stat().st_size == 0, 'E_RECIPE_GATE')

    class PrivateTLS(http.client.HTTPSConnection):
        def connect(self):
            self.sock = self._context.wrap_socket(socket.create_connection(('127.0.0.1', 4181), timeout=3), server_hostname='cartehesta.dannytech.fr')

    def request(target, method='GET', headers=None):
        connection = PrivateTLS('cartehesta.dannytech.fr', 4181, timeout=3, context=ssl.create_default_context())
        try:
            connection.request(method, target, headers={'Host': 'cartehesta.dannytech.fr', **(headers or {})})
            response = connection.getresponse()
            body = response.read(65537)
            require(len(body) <= 65536, 'E_HEALTH_RESPONSE_BOUND')
            return response.status, body
        finally:
            connection.close()
    status, body = request('/health')
    require(status == 200 and json.loads(body).get('status') == 'ok', 'E_HEALTH')
    for endpoint in ('/.env', '/.git/HEAD', '/server.js', '/data/private/users.json', '/assets/users.json', '/assets/.published-media.json', '/api/admin/users'):
        require(request(endpoint)[0] in (401, 403, 404), 'E_SENSITIVE_PATH_EXPOSED')
    for endpoint, key in (('/api/groups', 'groups'), ('/api/planning/sessions', 'sessions'), ('/api/annotations', 'annotations')):
        status, body = request(endpoint)
        require(status == 200 and json.loads(body).get(key) == [], 'E_PRIVATE_API_EXPOSED')
    for target in ('/assets%2fimages/test.png', '/%2561ssets/images/test.png', '/assets/images/%ZZ.png'):
        require(request(target, 'HEAD')[0] in (400, 404), 'E_MEDIA_PATH_BYPASS')
    require(request('/assets/map.png', 'HEAD')[0] == 200, 'E_PUBLIC_MEDIA')
    status, body = request('/assets/map.png', headers={'Range': 'bytes=0-0'})
    require(status == 206 and len(body) == 1, 'E_MEDIA_RANGE')


@contextlib.contextmanager
def deployment_lock():
    import fcntl
    fd = os.open('/run/lock/cartehesta-deploy.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'a') as lock:
        s = os.fstat(lock.fileno())
        require(s.st_uid == 0 and stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and stat.S_IMODE(s.st_mode) == 0o600, 'E_LOCK_PERMISSIONS')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused('E_DEPLOYMENT_IN_PROGRESS') from None
        yield


def main():
    require(os.name == 'posix' and os.geteuid() == 0 and sys.argv[1:] in (['restore'], ['capture'], ['maintenance']), 'E_INVOCATION')
    gate = Handoff('/var/lib/cartehesta-boot', '/run/cartehesta-gates',
                   lambda: Path('/proc/sys/kernel/random/boot_id').read_text().strip(), production_fingerprint, production_health)
    try:
        with deployment_lock():
            if sys.argv[1] == 'maintenance':
                gate.closed()
                gate.fail_closed()
                result = {'status': 'Maintenance', 'reason': 'OperatorMaintenance'}
            elif sys.argv[1] == 'capture':
                stopping = subprocess.run(['/usr/bin/systemctl', 'is-system-running'], capture_output=True, timeout=5).stdout.strip() == b'stopping'
                result = gate.capture(stopping)
            else:
                result = gate.restore()
        print(json.dumps(result))
    except Exception as error:
        # Failure also invalidates prior intent; an unknown error never becomes success.
        try:
            gate.closed()
        except Exception:
            pass
        gate_preserved = False
        try:
            gate.fail_closed()
            gate_preserved = True
        except Exception:
            pass
        print(json.dumps({'status': 'Maintenance', 'reason': str(error) if isinstance(error, Refused) else 'E_BOOT_CHECK_FAILED', 'exceptionType': type(error).__name__, 'gateClosureVerified': gate_preserved}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
