"""Scanner tests: python -I -m unittest discover -s mods/control/tests -p "test_*.py"
Synthetic transcripts check the counting rules. test_reference_window checks the author's real 2-9 Oct numbers
within 2 %; it runs only with CONTROL_REFERENCE=1 on the machine that holds those transcripts."""
import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'scanner'))
import control_scan as cs  # noqa: E402

CFG = cs.load_config()


def assistant(mid, ts, model='claude-opus-5-5', out=100, cread=1000, effort='medium', tools=(), side=False):
    return {'type': 'assistant', 'timestamp': ts, 'effort': effort, 'isSidechain': side, 'cwd': '/code/x',
            'message': {'id': mid, 'model': model,
                        'usage': {'input_tokens': 10, 'output_tokens': out, 'cache_read_input_tokens': cread,
                                  'cache_creation_input_tokens': 0},
                        'content': [{'type': 'tool_use', 'name': n, 'input': i} for n, i in tools]}}


class Synthetic(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.root = os.path.join(self.tmp, 'projects')
        self.out = os.path.join(self.tmp, 'out')
        os.makedirs(self.out)
        proj = os.path.join(self.root, 'C--code-x')
        os.makedirs(os.path.join(proj, 'sess1', 'subagents'))
        main = [
            assistant('m1', '2026-10-05T10:00:00Z', out=50, tools=[('Agent', {'subagent_type': 'architect'}),
                                                                  ('Read', {})]),
            assistant('m1', '2026-10-05T10:00:01Z', out=120),  # same message streamed: counted once, max usage
            assistant('m2', '2026-10-05T11:00:00Z', cread=310000,
                      tools=[('Agent', {'model': 'haiku', 'subagent_type': 'Explore'}),
                             ('Workflow', {'script': "agent('a', {model: 'haiku'}); agent('b')"}),
                             ('Monitor', {}), ('Skill', {'skill': 'handoff'})]),
            assistant('m3', '2026-10-05T12:00:00Z', model='claude-sonnet-5-5', effort='high', tools=[('Grep', {})]),
            {'type': 'system', 'subtype': 'compact_boundary', 'timestamp': '2026-10-05T12:30:00Z',
             'compactMetadata': {'trigger': 'auto'}},
            {'type': 'user', 'timestamp': '2026-10-05T12:40:00Z', 'message': {'content': '<command-name>/goal</command-name>'}},
            assistant('m4', '2026-10-01T12:00:00Z'),  # before the window
            assistant('<synthetic>', '2026-10-05T12:00:00Z', model='<synthetic>'),
        ]
        with open(os.path.join(proj, 'sess1.jsonl'), 'w', encoding='utf8') as f:
            f.write('\n'.join(json.dumps(x) for x in main) + '\n')
        sub = [assistant('s1', '2026-10-05T10:05:00Z', effort='high', tools=[('Glob', {})]),
               assistant('s2', '2026-10-05T10:06:00Z', model='claude-haiku-5-5', effort='low', tools=[('Read', {})])]
        with open(os.path.join(proj, 'sess1', 'subagents', 'agent-1.jsonl'), 'w', encoding='utf8') as f:
            f.write('\n'.join(json.dumps(x) for x in sub) + '\n')
        with open(os.path.join(proj, 'sess1', 'subagents', 'agent-1.meta.json'), 'w', encoding='utf8') as f:
            json.dump({'agentType': 'general-purpose'}, f)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def scan(self):
        cfg = json.loads(json.dumps(CFG))
        cfg['scan']['windows'] = [{'id': 'w', 'label': 'w', 'from': '2026-10-02T00', 'to': '2026-10-09T23'}]
        return cs.scan_usage(cfg, self.out, now=dt.datetime(2026, 10, 9, 23, tzinfo=dt.timezone.utc), root=self.root)

    def test_counts(self):
        w = self.scan()['windows'][0]
        c = w['counters']
        self.assertEqual(c['turns.main.opus'], 2)
        self.assertEqual(c['out.main.opus'], 120 + 100)  # m1 counted once with its largest usage
        self.assertEqual(c['turns.main.sonnet'], 1)
        self.assertEqual(c['turns.sub.opus'], 1)
        self.assertEqual(c['turns.sub.haiku'], 1)
        self.assertEqual(c['agent_total'], 2)
        self.assertEqual(c['agent_no_model'], 1)
        self.assertEqual(c['workflow_agent_calls'], 2)
        self.assertEqual(c['workflow_model_total'], 1)
        self.assertEqual(c['tool.Monitor'], 1)
        self.assertEqual(c['skill.handoff'], 1)
        self.assertEqual(c['compact_auto'], 1)
        self.assertEqual(c['slash_goal'], 1)
        self.assertEqual(c['main_turns_ctx300k'], 1)
        self.assertEqual(c['opus_sub_high_not_architect'], 1)
        self.assertEqual(c['readonly.main.opus'], 1)
        self.assertEqual(c['readonly.sub.haiku'], 1)
        m = {x['id']: x for x in w['metrics']}
        self.assertEqual(m['sub_no_model']['value'], 50.0)  # 1 Agent + 1 Workflow agent() of 4
        self.assertEqual(m['haiku_readonly_share']['value'], 25.0)
        self.assertEqual(m['handoff_ratio']['value'], 50.0)
        self.assertEqual(m['sonnet_main_high']['state'], 'red')
        # price: opus m2 = 10*4 + 100*20 + 310000*0.4 per M
        self.assertGreater(w['summary']['usd'], 0.12)

    def test_cache_reuses_unchanged_files(self):
        self.assertEqual(self.scan()['rescanned'], 2)
        self.assertEqual(self.scan()['rescanned'], 0)

    def test_rate(self):
        low = {'better': 'low', 'green': 10, 'amber': 30}
        self.assertEqual([cs.rate(v, low) for v in (5, 20, 40, None)], ['green', 'amber', 'red', 'none'])
        high = {'better': 'high', 'green': 80, 'amber': 40}
        self.assertEqual([cs.rate(v, high) for v in (90, 50, 10)], ['green', 'amber', 'red'])


class SetupAndPractices(unittest.TestCase):
    def test_blockers(self):
        tmp = tempfile.mkdtemp()
        try:
            home = os.path.join(tmp, 'home')
            os.makedirs(os.path.join(home, 'hooks'))
            os.makedirs(os.path.join(home, 'mods', 'guard', 'hooks'))
            repo = os.path.join(tmp, 'repo')
            os.makedirs(os.path.join(repo, '.claude'))
            settings = {'hooks': {'PreToolUse': [{'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': 'python x/block.py'}]}]},
                        'permissions': {'deny': ['Bash(rm:*)']}}
            with open(os.path.join(home, 'settings.json'), 'w') as f:
                json.dump(settings, f)
            with open(os.path.join(repo, '.claude', 'settings.json'), 'w') as f:
                json.dump({'hooks': {'Stop': [{'hooks': [{'type': 'command', 'command': 'node stop.js'}]}]}}, f)
            with open(os.path.join(home, 'hooks', 'block.py'), 'w') as f:
                f.write('# blocks things')
            with open(os.path.join(home, 'mods', 'guard', 'hooks', 'register.mjs'), 'w') as f:
                f.write("on('tool.call', () => ({ deny: 'no' }))")
            names = [b['name'] for b in cs.blocker_items(CFG, home, settings, [repo])]
            self.assertTrue(any(n.startswith('settings hook PreToolUse[Bash] block.py') for n in names), names)
            self.assertTrue(any(n.startswith('settings hook Stop') for n in names), names)
            self.assertTrue(any(n.startswith('mod deny path guard (installed, not loaded)') for n in names), names)
            self.assertTrue(any(n == 'hook script block.py' for n in names), names)
            self.assertTrue(any(n.startswith('permission deny Bash(rm:*)') for n in names), names)
            self.assertEqual(cs.blocker_items(CFG, os.path.join(tmp, 'empty'), {}, []), [])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_projects_table_and_stale_clauses(self):
        md = '# Projects (all dev)\n| Project | Group | Effort |\n|---|---|---|\n' \
             '| C:\\code\\app-one, app-two | Main (active) | medium |\n' \
             '| ~/code/app-three (app-four inside), app-five | Main (older) | medium |\n# Next\n'
        g = cs.projects_table(md)
        self.assertEqual(g['app-one'], 'Main (active)')
        self.assertEqual(g['app-two'], 'Main (active)')
        self.assertEqual(g['app-three'], 'Main (older)')
        self.assertEqual(g['app-five'], 'Main (older)')

    def test_practices_from_rules(self):
        tmp = tempfile.mkdtemp()
        try:
            usage = {'windows': [{'id': '7d', 'label': 'Last 7 days', 'metrics': [
                {'id': 'sub_no_model', 'label': 'no model', 'unit': '%', 'value': 89, 'state': 'red', 'target': 't'},
                {'id': 'workflow_per_day', 'label': 'wf', 'unit': '/day', 'value': 9, 'state': 'green', 'target': 't'}]}]}
            setup = {'sections': [{'items': [{'name': 'repo', 'flags': [{'kind': 'stale_clause', 'text': 'never merge'}]},
                                             {'name': 'hook x', 'flags': [{'kind': 'blocker', 'text': 'active hook'}]}]}]}
            p = cs.scan_practices(CFG, tmp, usage, setup)
            by = {x['id']: x for x in p['practices']}
            self.assertEqual(by['model_named']['state'], 'red')
            self.assertEqual(by['no_hidden']['state'], 'red')
            self.assertEqual(by['merge_on_green']['state'], 'red')
            self.assertTrue(p['best'][0].startswith('wf'))
            self.assertTrue(p['worst'][0].startswith('no model'))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


# usage-analysis.md (2-9 Oct): figures the scan must reproduce within 2 %.
REFERENCE = {
    'turns.main.opus': 6659, 'turns.sub.opus': 28543, 'turns.main.sonnet': 831, 'turns.sub.sonnet': 1074,
    'turns.main.haiku': 296, 'turns.sub.haiku': 51, 'effort.main.opus.medium': 6503, 'effort.sub.opus.high': 2477,
    'effort.sub.opus.medium': 25987, 'effort.main.sonnet.high': 512, 'agent_total': 262, 'agent_no_model': 227,
    'workflow': 62, 'workflow_agent_calls': 64, 'tool.Monitor': 239, 'tool.CronCreate': 15, 'compact_auto': 57,
    'opus_main_turns_ctx300k': 1576, 'readonly.main.opus': 379, 'readonly.sub.opus': 3343, 'agent_bg': 253,
    'agent_isolation': 47, 'agent_type.architect': 9,
}
REFERENCE_SUMS = {('out.main.opus', 'out.sub.opus'): 27.4e6, ('cread.main.opus', 'cread.sub.opus', 'cwrite.main.opus',
                                                              'cwrite.sub.opus', 'in.main.opus', 'in.sub.opus'): 5991e6}


@unittest.skipUnless(os.environ.get('CONTROL_REFERENCE') == '1', 'reference window: set CONTROL_REFERENCE=1')
class ReferenceWindow(unittest.TestCase):
    def test_reference_window(self):
        out = tempfile.mkdtemp()
        try:
            data = cs.scan_usage(CFG, out)
            c = next(w for w in data['windows'] if w['id'] == 'ref')['counters']
            for k, want in REFERENCE.items():
                got = c.get(k, 0)
                tol = max(0.02 * want, 2)  # 2 %, or 2 for counts under 100
                self.assertLessEqual(abs(got - want), tol, f'{k}: {got} vs {want}')
            for keys, want in REFERENCE_SUMS.items():
                got = sum(c.get(k, 0) for k in keys)
                self.assertLessEqual(abs(got - want) / want, 0.02, f'{keys}: {got} vs {want}')
        finally:
            shutil.rmtree(out, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
