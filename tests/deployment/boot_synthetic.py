"""No production path, subprocess or socket is used by these synthetic tests."""
import importlib.util
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('boot', sys.argv.pop(1))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
OWNER = os.getuid() if os.name == 'posix' else 0
A, B, C = 'a' * 36, 'b' * 36, 'c' * 36


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='cartehesta-boot-synthetic-')
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.state, self.gates = root / 'private', root / 'run'
        self.state.mkdir(mode=0o700)
        self.gates.mkdir(mode=0o755)
        self.boot, self.digest, self.healthy = A, 'd' * 64, True
        self.health_calls = 0
        self.h = m.Handoff(self.state, self.gates, lambda: self.boot, lambda: self.digest, self.health, OWNER)
        if not hasattr(os, 'fchmod'):
            self.fchmod = patch.object(os, 'fchmod', lambda *_args: None, create=True)
            self.fchmod.start()
            self.addCleanup(self.fchmod.stop)

    def health(self):
        self.health_calls += 1
        if not self.healthy:
            raise m.Refused('E_SYNTHETIC_HEALTH')

    def open(self):
        self.h.gate.touch(mode=0o644)

    def reboot(self):
        # Only our fictional /run gate disappears; no real reboot or service call.
        if self.h.gate.exists():
            self.h.gate.unlink()
        self.boot = B

    def arm(self):
        self.open()
        self.assertEqual(self.h.capture(True)['status'], 'CleanShutdownArmed')

    def refused(self, action, code):
        # Same fail-closed handling as the CLI, including unknown exceptions.
        with self.assertRaisesRegex(Exception, code):
            try:
                action()
            except Exception:
                self.h.closed()
                self.h.fail_closed()
                raise
        self.assertFalse(self.h.gate.exists())

    def test_normal_clean_restart(self):
        self.arm()
        self.reboot()
        self.assertEqual(self.h.restore()['status'], 'PublicRestored')
        self.assertEqual(self.h.load()['status'], 'consumed')

    def test_intent_is_single_use(self):
        self.arm(); self.reboot(); self.h.restore()
        self.h.gate.unlink(); self.boot = C
        self.assertEqual(self.h.restore()['status'], 'Maintenance')

    def test_voluntary_maintenance_stays_closed(self):
        self.arm(); self.h.gate.unlink()
        self.assertEqual(self.h.capture(True)['reason'], 'VoluntaryMaintenance')
        self.reboot()
        self.assertEqual(self.h.restore()['status'], 'Maintenance')

    def test_missing_state_stays_closed(self):
        self.assertEqual(self.h.restore()['status'], 'Maintenance')
        self.assertEqual(self.health_calls, 0)

    def test_manual_service_stop_is_not_shutdown_authorization(self):
        self.open(); self.h.capture(False); self.reboot()
        self.assertEqual(self.h.restore()['status'], 'Maintenance')

    def test_same_boot_cannot_reopen(self):
        self.arm(); self.h.gate.unlink()
        self.assertEqual(self.h.restore()['reason'], 'SameBootAuthorizationRefused')

    def test_health_failure_consumes_intent(self):
        self.arm(); self.reboot(); self.healthy = False
        self.refused(self.h.restore, 'E_SYNTHETIC_HEALTH')
        self.healthy = True
        self.assertEqual(self.h.restore()['status'], 'Maintenance')

    def test_shutdown_health_failure_invalidates_old_intent(self):
        self.arm(); self.healthy = False
        self.refused(lambda: self.h.capture(True), 'E_SYNTHETIC_HEALTH')
        self.assertEqual(self.h.load()['status'], 'consumed')

    def test_changed_code_or_configuration(self):
        self.arm(); self.reboot(); self.digest = 'e' * 64
        self.refused(self.h.restore, 'E_CODE_OR_CONFIGURATION_CHANGED')

    def test_change_during_startup(self):
        self.arm(); self.reboot()
        self.h.health = lambda: setattr(self, 'digest', 'e' * 64)
        self.refused(self.h.restore, 'E_STARTUP_CHANGED')

    def test_change_during_shutdown(self):
        self.open()
        self.h.health = lambda: setattr(self, 'digest', 'e' * 64)
        self.refused(lambda: self.h.capture(True), 'E_SHUTDOWN_CHANGED')

    def test_corrupt_state(self):
        f = self.state / 'handoff.json'; f.write_text('{broken'); f.chmod(0o600)
        self.refused(self.h.restore, '.*')

    def test_invalid_state_schema(self):
        self.h.save({'format': 1, 'status': 'armed', 'bootId': A, 'fingerprint': 'not-a-digest'})
        self.refused(self.h.restore, 'E_STATE_DIGEST')

    def test_unknown_exception_does_not_open(self):
        self.arm(); self.reboot()
        self.h.health = lambda: (_ for _ in ()).throw(ValueError('fictional'))
        self.refused(self.h.restore, 'fictional')

    def test_existing_open_site_is_not_interrupted_on_install(self):
        self.open()
        self.assertEqual(self.h.restore()['status'], 'AlreadyOpenValidated')
        self.assertTrue(self.h.gate.exists())

    def test_existing_open_but_unhealthy_closes_and_preserves_gate(self):
        self.open(); self.healthy = False
        self.refused(self.h.restore, 'E_SYNTHETIC_HEALTH')
        self.assertEqual(len(list(self.gates.glob('boot-refused-*.gate'))), 1)

    def test_recovery_requires_explicit_new_opening(self):
        self.arm(); self.reboot(); self.healthy = False
        self.refused(self.h.restore, 'E_SYNTHETIC_HEALTH')
        self.healthy = True
        self.assertEqual(self.h.restore()['status'], 'Maintenance')
        self.open()  # Fictional, separately approved operator opening.
        self.assertEqual(self.h.restore()['status'], 'AlreadyOpenValidated')
        self.assertEqual(self.h.capture(True)['status'], 'CleanShutdownArmed')
        self.h.gate.unlink(); self.boot = C
        self.assertEqual(self.h.restore()['status'], 'PublicRestored')

    def test_power_loss_after_open_does_not_reuse_shutdown(self):
        self.open(); self.h.restore(); self.reboot()
        self.assertEqual(self.h.restore()['status'], 'Maintenance')

    def test_persistent_data_sentinels_are_untouched(self):
        sentinels = [Path(self.tmp.name) / name for name in ('data.json', 'media.bin', 'secret.env')]
        for f in sentinels: f.write_bytes(b'fictional-only')
        self.arm(); self.reboot(); self.h.restore()
        self.assertTrue(all(f.read_bytes() == b'fictional-only' for f in sentinels))

    @unittest.skipUnless(os.name == 'posix', 'Native ownership/modes are checked by Linux CI')
    def test_writable_state_is_refused(self):
        self.state.chmod(0o777)
        self.refused(self.h.restore, 'E_FILE_PERMISSIONS')

    @unittest.skipUnless(os.name == 'posix', 'Native links are checked by Linux CI')
    def test_symlink_gate_is_refused(self):
        target = Path(self.tmp.name) / 'target'; target.touch()
        self.h.gate.symlink_to(target)
        self.refused(self.h.restore, 'E_FILE_TYPE')
        self.assertTrue(target.exists())


class Health(unittest.TestCase):
    def fixture(self, mode):
        tmp = tempfile.TemporaryDirectory(prefix='cartehesta-boot-health-synthetic-')
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        def fake_path(p): return root / str(p).lstrip('/')
        for port, suffix in (('104D', 'tcp'), ('1055', 'tcp6')):
            f = fake_path('/proc/net/' + suffix); f.parent.mkdir(parents=True, exist_ok=True)
            # Both listeners in IPv4, empty IPv6 table.
            f.write_text('header\n' + ('0: '+('00000000' if mode == 'listener' else '0100007F')+':104D 0:0 0A\n1: 0100007F:1055 0:0 0A\n' if suffix == 'tcp' else ''))
        lock = fake_path('/srv/cartehesta/data/locks/writer.lock'); lock.parent.mkdir(parents=True); lock.write_text('{"pid":12345}')
        recipe = fake_path('/run/cartehesta-gates/RECIPE_ALLOWED'); recipe.parent.mkdir(parents=True); recipe.touch(mode=0o644)
        class Response:
            def __init__(self, endpoint, method, headers):
                self.status, self.body = 404, b''
                if endpoint == '/health': self.status, self.body = (500 if mode == 'health' else 200), b'{"status":"ok"}'
                if endpoint in ('/api/groups','/api/planning/sessions','/api/annotations'):
                    key = {'/api/groups':'groups','/api/planning/sessions':'sessions','/api/annotations':'annotations'}[endpoint]
                    self.status, self.body = 200, json.dumps({key: [123] if mode == 'privacy' else []}).encode()
                if endpoint == '/.env' and mode == 'exposure': self.status = 200
                if endpoint == '/assets/map.png': self.status, self.body = (206, b'x') if headers.get('Range') else (200, b'')
                if mode == 'range' and endpoint == '/assets/map.png' and headers.get('Range'): self.status = 200
            def read(self, _limit): return self.body
        class Connection:
            def __init__(self, *_a, **_kw): pass
            def request(self, method, endpoint, headers):
                if mode == 'tls': raise ssl.SSLError('fictional TLS refusal')
                self.response = Response(endpoint, method, headers)
            def getresponse(self): return self.response
            def close(self): pass
        def run(args, **_kw):
            if 'show' in args: return subprocess.CompletedProcess(args, 0, b'cartehesta\n')
            return subprocess.CompletedProcess(args, 1 if mode == 'service' else 0, b'active\n')
        return fake_path, Connection, run

    def run_health(self, mode):
        fake_path, connection, run = self.fixture(mode)
        with patch.object(m, 'Path', fake_path), patch.object(m, 'trusted'), patch.object(m.subprocess, 'run', run), patch.object(m.os, 'readlink', return_value='/opt/node-v22.23.2-linux-x64/bin/node'), patch.object(m.http.client, 'HTTPSConnection', connection):
            m.production_health()

    def test_complete_https_checks(self): self.run_health('success')
    def test_failed_service(self):
        with self.assertRaisesRegex(m.Refused, 'E_SERVICE_OR_NGINX'): self.run_health('service')
    def test_non_loopback_listener(self):
        with self.assertRaisesRegex(m.Refused, 'E_NON_LOOPBACK_LISTENER'): self.run_health('listener')
    def test_invalid_tls(self):
        with self.assertRaises(ssl.SSLError): self.run_health('tls')
    def test_bad_health(self):
        with self.assertRaisesRegex(m.Refused, 'E_HEALTH'): self.run_health('health')
    def test_exposed_sensitive_path(self):
        with self.assertRaisesRegex(m.Refused, 'E_SENSITIVE_PATH_EXPOSED'): self.run_health('exposure')
    def test_exposed_private_response(self):
        with self.assertRaisesRegex(m.Refused, 'E_PRIVATE_API_EXPOSED'): self.run_health('privacy')
    def test_failed_range(self):
        with self.assertRaisesRegex(m.Refused, 'E_MEDIA_RANGE'): self.run_health('range')


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=0).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    print(json.dumps({'tests': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors), 'skipped': len(result.skipped)}))
    sys.exit(not result.wasSuccessful())
