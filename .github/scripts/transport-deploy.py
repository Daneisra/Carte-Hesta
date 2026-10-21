#!/usr/bin/env python3
"""GitHub runner transport. No production application secret is used here."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request


def settings(env):
    values = {k: env.get(k, '') for k in ('DEPLOY_HOST', 'DEPLOY_PORT', 'DEPLOY_SSH_KEY', 'DEPLOY_KNOWN_HOSTS',
                                         'REVISION', 'MANIFEST_SHA256', 'ARCHIVE_SHA256', 'REOPEN')}
    values['DEPLOY_PORT'] = values['DEPLOY_PORT'] or '22'
    if not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}', values['DEPLOY_HOST']) or not re.fullmatch('[0-9]{1,5}', values['DEPLOY_PORT']) or not 1 <= int(values['DEPLOY_PORT']) <= 65535:
        raise ValueError('E_SSH_DESTINATION')
    if not re.fullmatch('[a-f0-9]{40}', values['REVISION']) or not all(re.fullmatch('[a-f0-9]{64}', values[k]) for k in ('MANIFEST_SHA256', 'ARCHIVE_SHA256')):
        raise ValueError('E_DEPLOY_REFERENCES')
    if values['REOPEN'] not in ('true', 'false') or not values['DEPLOY_SSH_KEY'].strip() or not values['DEPLOY_KNOWN_HOSTS'].strip():
        raise ValueError('E_DEPLOY_CONFIGURATION')
    if '*' in values['DEPLOY_KNOWN_HOSTS'] or '@cert-authority' in values['DEPLOY_KNOWN_HOSTS']:
        raise ValueError('E_EXACT_HOST_KEY_REQUIRED')
    return values


def connection(config, directory):
    key, known = directory / 'identity', directory / 'known_hosts'
    for file, text in ((key, config['DEPLOY_SSH_KEY']), (known, config['DEPLOY_KNOWN_HOSTS'])):
        fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as target:
            target.write(text.rstrip() + '\n')
    return ['ssh', '-F', '/dev/null', '-T', '-p', config['DEPLOY_PORT'], '-i', str(key),
            '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
            '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'UserKnownHostsFile=' + str(known), '-o', 'GlobalKnownHostsFile=/dev/null',
            '-o', 'PasswordAuthentication=no', '-o', 'ConnectTimeout=15',
            'cartehesta-deploy@' + config['DEPLOY_HOST']]


def external_health(reopened):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    root = 'https://cartehesta.dannytech.fr'
    checks = [('/', 200), ('/health', 200), ('/api/admin/users', 401), ('/assets/users.json', 404),
              ('/.env', 404), ('/server.js', 404)] if reopened else [('/', 503)]
    for endpoint, expected in checks:
        try:
            with opener.open(root + endpoint, timeout=15) as response:
                status = response.status
                payload = response.read(4097) if endpoint == '/health' else b''
        except urllib.error.HTTPError as error:
            status, payload = error.code, b''
        if status != expected:
            raise RuntimeError('E_EXTERNAL_HTTP')
        if endpoint == '/health' and (len(payload) > 4096 or json.loads(payload).get('status') != 'ok'):
            raise RuntimeError('E_EXTERNAL_HEALTH')


def deploy(config, archive, ssh, runner, health):
    size = archive.stat().st_size
    if not archive.is_file() or archive.is_symlink() or size > 40 * 1024 * 1024:
        raise ValueError('E_TRANSPORT_ARCHIVE')
    h = hashlib.sha256()
    with archive.open('rb') as content:
        for block in iter(lambda: content.read(256 * 1024), b''):
            h.update(block)
    if h.hexdigest() != config['ARCHIVE_SHA256']:
        raise ValueError('E_TRANSPORT_DIGEST')
    request = ' '.join(('deploy', config['REVISION'], config['MANIFEST_SHA256'], config['ARCHIVE_SHA256'],
                        'reopen' if config['REOPEN'] == 'true' else 'closed'))
    with archive.open('rb') as content:
        result = runner(ssh + [request], content)
    value = json.loads(result)
    if value.get('status') != 'Activated' or value.get('revision') != config['REVISION'] or not re.fullmatch('deployment-[a-z0-9_]{8}', value.get('receipt', '')) or not isinstance(value.get('publicReopened'), bool):
        raise ValueError('E_CONTROLLER_RECEIPT')
    try:
        health(value['publicReopened'])
    except Exception:
        # One explicit rollback call; never retry a failed deployment or overwrite data.
        rollback = json.loads(runner(ssh + ['rollback ' + config['REVISION'] + ' ' + value['receipt']], None))
        if rollback.get('status') != 'RolledBackMaintenance' or rollback.get('revision') != config['REVISION']:
            raise RuntimeError('E_EXTERNAL_ROLLBACK_UNVERIFIED') from None
        raise RuntimeError('E_EXTERNAL_FAILED_CODE_ROLLED_BACK_MAINTENANCE') from None
    return value


def main():
    config = settings(os.environ)
    directory = Path(tempfile.mkdtemp(prefix='cartehesta-ssh-', dir=os.environ['RUNNER_TEMP']))
    directory.chmod(0o700)
    ssh = connection(config, directory)
    # No agent, token, inherited proxy or shell is passed to SSH.
    clean = {'PATH': '/usr/bin:/bin', 'HOME': str(directory), 'LANG': 'C.UTF-8'}
    def runner(args, source):
        value = subprocess.run(args, stdin=source if source else subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, check=True, timeout=720, env=clean)
        if len(value.stdout) > 8192:
            raise ValueError('E_SSH_RESPONSE_BOUNDS')
        return value.stdout
    result = deploy(config, Path(os.environ['RUNNER_TEMP']) / 'transport' / 'code.tar', ssh, runner, external_health)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'StoppedReviewRequired', 'exceptionType': type(error).__name__}), file=sys.stderr)
        sys.exit(1)
