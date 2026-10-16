"""machine: the shared health record for « Santé des mods » (mods/sante/README.md).

python -I -m unittest discover -s mods/machine/tests -p "test_*.py"
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'scanner'))

import machine as scanner  # noqa: E402

NOW = 1792152000.0  # 2026-10-16T12:00:00Z


class HealthTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='machine-health-')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_record_window_and_error(self):
        env = {'MODS_HEALTH_DIR': self.tmp}
        a = scanner.write_health('machine', None, env, NOW)
        b = scanner.write_health('machine', 'boom', env, NOW + 1)
        with open(os.path.join(self.tmp, 'machine.json'), encoding='utf-8') as fh:
            rec = json.load(fh)
        self.assertEqual(rec, b)
        self.assertEqual(a['lastRun'], '2026-10-16T12:00:00.000Z')
        self.assertEqual(rec['error'], 'boom')
        self.assertEqual(rec['lastOk'], a['lastRun'])
        self.assertEqual((rec['window']['start'], rec['window']['runs'], rec['window']['errors']), (a['lastRun'], 2, 1))
        self.assertGreaterEqual(rec['cpuMs'], 0)
        self.assertEqual(scanner.write_health('machine', None, env, NOW + 25 * 3600)['window']['runs'], 1)

    def test_off_and_bad_folder(self):
        off = os.path.join(self.tmp, 'off')
        self.assertIsNone(scanner.write_health('machine', None, {'MODS_HEALTH': '0', 'MODS_HEALTH_DIR': off}, NOW))
        self.assertFalse(os.path.exists(off))
        self.assertIsNone(scanner.write_health('machine', None, {'MODS_HEALTH_DIR': '\0bad'}, NOW))


if __name__ == '__main__':
    unittest.main()
