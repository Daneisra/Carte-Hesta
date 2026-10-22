"""Download the immutable CI ZIP, require its API digest, then extract code only."""
import hashlib
import io
import os
from pathlib import Path, PurePosixPath
import re
import stat
import urllib.error
import urllib.request
import urllib.parse
import zipfile


def extract(data, expected, destination):
    if len(data) > 40 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('E_CI_ARCHIVE_DIGEST')
    destination = Path(destination)
    destination.mkdir(mode=0o700)
    seen, total = set(), 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for entry in archive.infolist():
            name = entry.filename.rstrip('/')
            parts = PurePosixPath(name).parts
            mode = entry.external_attr >> 16
            if not name or len(seen) >= 2048 or name in seen or not re.fullmatch('[A-Za-z0-9_./-]+', name) or name.startswith('/') or any(x in ('', '.', '..') for x in name.split('/')):
                raise ValueError('E_CI_ARCHIVE_PATH')
            if parts[0] not in ('app', 'public', 'ops', 'release-manifest.json') or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) and not (stat.S_ISREG(mode) or stat.S_ISDIR(mode))):
                raise ValueError('E_CI_ARCHIVE_TYPE')
            if parts[0] == 'release-manifest.json' and (len(parts) != 1 or entry.is_dir()):
                raise ValueError('E_CI_MANIFEST_PATH')
            seen.add(name)
            target = destination.joinpath(*parts)
            if entry.is_dir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
                continue
            total += entry.file_size
            if total > 32 * 1024 * 1024:
                raise ValueError('E_CI_PAYLOAD_BOUND')
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with target.open('xb') as f:
                f.write(archive.read(entry))


def main():
    identifier, digest, token = (os.environ[k] for k in ('ARTIFACT_ID', 'ARTIFACT_SHA256', 'GH_TOKEN'))
    if not re.fullmatch('[1-9][0-9]*', identifier) or not re.fullmatch('[a-f0-9]{64}', digest) or not token:
        raise ValueError('E_CI_ARTIFACT_INPUT')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            return None
    opener = urllib.request.build_opener(NoRedirect())
    request = urllib.request.Request('https://api.github.com/repos/Daneisra/Carte-Hesta/actions/artifacts/' + identifier + '/zip',
                                     headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json'})
    try:
        opener.open(request, timeout=30)
        raise ValueError('E_CI_REDIRECT_REQUIRED')
    except urllib.error.HTTPError as error:
        if error.code != 302:
            raise ValueError('E_CI_ARTIFACT_HTTP') from None
        location = error.headers.get('Location', '')
    url = urllib.parse.urlparse(location)
    if url.scheme != 'https' or not url.hostname or not url.hostname.endswith('.blob.core.windows.net') or url.username or url.password:
        raise ValueError('E_CI_ARTIFACT_ORIGIN')
    # No GitHub Authorization header is forwarded to the signed storage URL.
    with opener.open(location, timeout=30) as response:
        data = response.read(40 * 1024 * 1024 + 1)
    extract(data, digest, os.environ['CANDIDATE_DIRECTORY'])


if __name__ == '__main__':
    main()
