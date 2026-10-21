#!/usr/bin/env python3
"""Forced SSH command; install root-owned, run as cartehesta-deploy only.
No shell, SCP, SFTP, forwarding or general sudo access is provided by this key.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import stat
import subprocess
import sys
import tarfile
import uuid

INCOMING = Path('/srv/cartehesta-incoming')
CONTROLLER = '/usr/local/sbin/cartehesta-deploy-reviewed'
MAX_ARCHIVE = 40 * 1024 * 1024


def command(value):
    args = shlex.split(value)
    if len(args) == 5 and args[0] == 'deploy' and re.fullmatch('[a-f0-9]{40}', args[1]) and all(
            re.fullmatch('[a-f0-9]{64}', x) for x in args[2:4]) and args[4] in ('closed', 'reopen'):
        return args
    if len(args) == 3 and args[0] == 'rollback' and re.fullmatch('[a-f0-9]{40}', args[1]) and re.fullmatch('deployment-[a-z0-9_]{8}', args[2]):
        return args
    raise ValueError('E_SSH_COMMAND')


def receive(stream, directory, digest):
    directory.mkdir(mode=0o700)  # No overwrite or implicit retry of an existing revision.
    archive = directory / '.transport.tar'
    h = hashlib.sha256()
    size = 0
    with archive.open('xb') as target:
        os.chmod(archive, 0o600)
        while True:
            b = stream.read(256 * 1024)
            if not b:
                break
            size += len(b)
            if size > MAX_ARCHIVE:
                raise ValueError('E_ARCHIVE_BOUNDS')
            target.write(b)
            h.update(b)
    if h.hexdigest() != digest:
        raise ValueError('E_TRANSPORT_DIGEST')
    # Extract to a separate new directory, retaining the original transport file.
    payload = directory / 'payload'
    payload.mkdir(mode=0o700)
    total = 0
    seen = set()
    with tarfile.open(archive, 'r:') as tar:
        for n, member in enumerate(tar):
            name = member.name.rstrip('/')
            parts = PurePosixPath(name).parts
            if n >= 2048 or not name or not re.fullmatch('[A-Za-z0-9_./-]+', name) or name.startswith('/') or any(
                    p in ('', '.', '..') for p in name.split('/')) or name in seen:
                raise ValueError('E_ARCHIVE_PATH')
            seen.add(name)
            if parts[0] not in ('app', 'public', 'ops', 'release-manifest.json') or (
                    parts[0] == 'release-manifest.json' and len(parts) != 1) or not (member.isdir() or member.isfile()):
                raise ValueError('E_ARCHIVE_TYPE')
            p = payload.joinpath(*parts)
            if member.isdir():
                p.mkdir(mode=0o700, parents=True, exist_ok=True)
                continue
            total += member.size
            if member.size < 0 or total > 32 * 1024 * 1024:
                raise ValueError('E_PAYLOAD_BOUNDS')
            p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            # All ancestors were created in this new private directory; tar links
            # and special files are rejected before any write.
            with tar.extractfile(member) as source, p.open('xb') as target:
                os.chmod(p, 0o600)
                remaining = member.size
                while remaining:
                    block = source.read(min(remaining, 256 * 1024))
                    if not block:
                        raise ValueError('E_TRUNCATED_PAYLOAD')
                    target.write(block)
                    remaining -= len(block)
    if not {'app', 'public', 'ops', 'release-manifest.json'}.issubset(seen):
        raise ValueError('E_PAYLOAD_INCOMPLETE')
    return payload


def main():
    args = command(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    if args[0] == 'rollback':
        result = subprocess.run(['/usr/bin/sudo', '-n', CONTROLLER, '--rollback', args[1], args[2]],
                                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=240)
    else:
        if INCOMING.is_symlink() or not INCOMING.is_dir() or stat.S_IMODE(INCOMING.stat().st_mode) != 0o700:
            raise PermissionError('E_INCOMING_PERMISSIONS')
        ticket = 'transfer-' + uuid.uuid4().hex
        receive(sys.stdin.buffer, INCOMING / ticket, args[3])
        invocation = ['/usr/bin/sudo', '-n', CONTROLLER, args[1], args[2], '--ticket', ticket]
        if args[4] == 'reopen':
            invocation.append('--reopen')
        result = subprocess.run(invocation, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=660)
    value = json.loads(result.stdout)
    # Do not relay arbitrary stdout/stderr from a failed process.
    if value.get('revision') != args[1] or value.get('status') not in ('Activated', 'RolledBackMaintenance'):
        raise ValueError('E_CONTROLLER_RECEIPT')
    print(json.dumps(value))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'StoppedReviewRequired', 'exceptionType': type(error).__name__}), file=sys.stderr)
        sys.exit(1)
