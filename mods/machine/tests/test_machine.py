"""machine mod scanner: parsers, process summary, runner extraction, and one real sample on this platform.

    python -I -m unittest discover -s mods/machine/tests -p "test_*.py"
No fixture holds real machine data; the runner tests use a fake ci module (no network, no token).
"""
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'scanner'))

import machine  # noqa: E402

FAMS = {'claude': ['claude'], 'node': ['node'], 'python': ['python', 'py'], 'git': ['git']}


class Parsers(unittest.TestCase):
    def test_nvidia(self):
        g = machine.parse_nvidia('Test GPU, 35, 1625, 12282, 61\nOther, [N/A], 10, 20, [N/A]\n\n')
        self.assertEqual(g[0], {'name': 'Test GPU', 'util': 35.0, 'mem_used_mb': 1625.0, 'mem_total_mb': 12282.0, 'temp_c': 61.0})
        self.assertIsNone(g[1]['util'])
        self.assertEqual(machine.parse_nvidia(''), [])

    def test_typeperf(self):
        text = '\n"(PDH-CSV 4.0)","\\\\PC\\GPU Engine(a)\\Utilization Percentage","\\\\PC\\GPU Engine(b)\\Utilization Percentage"\n' \
               '"10/16/2026 12:00:00.000","30.5","0.8"\nExiting, please wait...\n'
        self.assertEqual(machine.parse_typeperf(text), 31.3)
        self.assertEqual(machine.parse_typeperf('"a","90"\n"t","60","70"'), 100.0)
        self.assertIsNone(machine.parse_typeperf('nothing'))

    def test_core_pcts(self):
        self.assertEqual(machine.core_pcts([(0, 0), (0, 0)], [(25, 100), (100, 100)]), [75.0, 0.0])
        self.assertEqual(machine.core_pcts([(5, 10)], [(5, 10)]), [0.0])

    def test_family(self):
        self.assertEqual(machine.family_of('Claude.exe', FAMS), 'claude')
        self.assertEqual(machine.family_of('python3.14.exe', FAMS), 'python')
        self.assertEqual(machine.family_of('git-remote-https.exe', FAMS), 'git')
        self.assertEqual(machine.family_of('chrome.exe', FAMS), '')


class Procs(unittest.TestCase):
    def test_summary(self):
        req = {**machine.SAMPLE_DEFAULTS, 'families': FAMS, 'top_n': 2}
        procs = {
            1: ('gitlab-runner.exe', 0, 0, 1, 50),
            2: ('pwsh.exe', 1, 2_000_000, 1, 10),          # a job of the runner
            3: ('node.exe', 0, 10_000_000, 7, 300),
            4: ('claude.exe', 0, 1_000_000, 7, 900),
            5: ('chrome.exe', 0, 5_000_000, 9, 600),
            6: ('System', 0, None, None, 0),                # unreadable
        }
        prev = {'1': [0, 1], '2': [0, 1], '3': [0, 7], '4': [0, 7], '5': [0, 8]}  # pid 5 restarted: no %
        out = machine.summarize_procs(procs, prev, 10_000_000, 2, req)
        self.assertEqual(out['count'], 6)
        self.assertEqual((out['unreadable'], out['cpu_attributed']), (1, 65.0))
        self.assertEqual([p['name'] for p in out['top_cpu']], ['node.exe', 'pwsh.exe'])
        self.assertEqual(out['top_cpu'][0]['cpu'], 50.0)
        self.assertEqual([p['name'] for p in out['top_ram']], ['claude.exe', 'chrome.exe'])
        self.assertEqual(out['families']['node'], {'count': 1, 'cpu': 50.0, 'ram': 300})
        self.assertNotIn('git', out['families'])
        self.assertEqual(out['runner'], {'present': True, 'children': 1})


class Runner(unittest.TestCase):
    CFG = {'backends': [
        {'id': 'github-hosted', 'kind': 'github', 'runner_tag': 'ubuntu-latest'},
        {'id': 'gitlab-local', 'kind': 'gitlab', 'label': 'Local', 'runner_tag': 'local-windows', 'concurrent': 18},
        {'id': 'gitlab-saas', 'kind': 'gitlab', 'runner_tag': ''},
    ]}
    ST = {'generated': '2026-10-16T12:00:00Z', 'checks': {'gitlab-local': {
        'token': {'present': 'yes', 'source': 'glab'}, 'usable': 'yes', 'why': '1 runner(s) online',
        'runners': {'online': 1, 'offline': 0, 'total': 1}, 'jobs': {'running': 2, 'pending': None}}}}

    def test_counts_only_never_the_token(self):
        out = machine.runner_from_status(self.CFG, self.ST, ['gitlab-local'])
        self.assertEqual(len(out['backends']), 1)
        b = out['backends'][0]
        self.assertEqual((b['concurrent'], b['jobs']['running'], b['runners']['online']), (18, 2, 1))
        self.assertNotIn('token', json.dumps(out))
        # no ids: every gitlab backend with a runner tag
        self.assertEqual([b['id'] for b in machine.runner_from_status(self.CFG, self.ST, [])['backends']], ['gitlab-local'])

    def test_through_a_ci_module(self):
        with tempfile.TemporaryDirectory() as d:
            fake = os.path.join(d, 'ci.py')
            with open(fake, 'w', encoding='utf8') as f:
                f.write('import json\nCFG=json.loads(%r)\nST=json.loads(%r)\n' %(json.dumps(self.CFG), json.dumps(self.ST)))
                f.write('def load_config(p=None):\n    return CFG\n')
                f.write('def status(cfg, refresh=False):\n    return dict(ST, refreshed=refresh)\n')
            sys.modules.pop('ci', None)
            try:
                out = machine.runner(fake, None, True, ['gitlab-local'])
            finally:
                sys.modules.pop('ci', None)
                sys.path.remove(d) if d in sys.path else None
            self.assertEqual(out.get('backends', [{}])[0].get('jobs', {}).get('running'), 2, out)
        self.assertIn('error', machine.runner(os.path.join(HERE, 'missing', 'ci.py')))


class RealSample(unittest.TestCase):
    def test_one_sample_here(self):
        out = machine.sample({'families': FAMS, 'first_delta_ms': 100, 'gpu': False})
        self.assertIn('raw', out)
        self.assertGreater(out['procs']['count'], 0)
        self.assertIsNone(out['gpu'])
        if out['cpu']['cores']:
            self.assertTrue(all(0 <= c <= 100 for c in out['cpu']['cores']))
        again = machine.sample({'families': FAMS, 'prev': out['raw']})
        self.assertEqual(len(again['cpu']['cores']), len(out['cpu']['cores']))
        json.dumps(again)


if __name__ == '__main__':
    unittest.main()
