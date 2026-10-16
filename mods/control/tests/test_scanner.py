"""Scanner tests: python -I -m unittest discover -s mods/control/tests -p "test_*.py"
Synthetic transcripts check the counting rules. test_reference_window checks the author's real 2-9 Oct numbers
within 2 %; it runs only with CONTROL_REFERENCE=1 on the machine that holds those transcripts."""
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'scanner'))
import control_scan as cs  # noqa: E402

CFG = cs.load_config(user_override=False)


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
            home = os.path.join(tmp, 'home')
            os.makedirs(home)
            with open(os.path.join(home, 'CLAUDE.md'), 'w', encoding='utf8') as f:
                f.write(RULES_MD)
            with open(os.path.join(tmp, 'PRACTICES.md'), 'w', encoding='utf8') as f:
                f.write('# P\n- **B2** Cache reads are half of the spend.\n')
            cfg = json.loads(json.dumps(CFG))
            cfg['paths'].update(claude_home=home, practices_md=os.path.join(tmp, 'PRACTICES.md'),
                                audit_report=os.path.join(tmp, 'none.md'), history_md='')
            cfg['v6']['repo'] = '<CLAUDE_CONTROL_REPO>'
            usage = {'windows': [{'id': '7d', 'label': 'Last 7 days', 'metrics': [
                {'id': 'sub_no_model', 'label': 'no model', 'unit': '%', 'value': 89, 'state': 'red', 'target': 't'},
                {'id': 'workflow_per_day', 'label': 'wf', 'unit': '/day', 'value': 9, 'state': 'green', 'target': 't'}]}]}
            setup = {'sections': [{'items': [{'name': 'repo', 'flags': [{'kind': 'stale_clause', 'text': 'never merge'}]},
                                             {'name': 'hook x', 'flags': [{'kind': 'blocker', 'text': 'active hook'}]}]}]}
            p = cs.scan_practices(cfg, tmp, usage, setup)
            self.assertEqual(p['version'], '9.1')
            self.assertEqual(p['rules_version'], 'Team Rules V9.1 (1 Jan 2030)')
            self.assertEqual([s['title'] for s in p['sections']], ['How a package runs', 'Models', 'Visible rules only'])
            by = {s['num']: s for s in p['sections']}
            self.assertEqual(by['1']['state'], 'red')  # workflow green, PR merge red (stale clause)
            self.assertEqual(by['2']['state'], 'red')  # model named: 89 %
            self.assertEqual(by['3']['state'], 'red')  # a blocker
            wf = by['1']['lines'][0]
            self.assertEqual(wf['state'], 'green')
            self.assertIn({'kind': 'cite', 'text': 'standing opt-in; Julian, 13 Oct: "faster"', 'state': 'info'}, wf['evidence'])
            cache = by['2']['lines'][1]
            self.assertTrue(any(e['kind'] == 'practices' and 'Cache reads' in e['text'] for e in cache['evidence']))
            self.assertEqual(p['v6']['state'], 'no_repo')
            self.assertTrue(p['best'][0].startswith('wf'))
            self.assertTrue(p['worst'][0].startswith('no model'))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


RULES_MD = '''# Team Rules V9.1 (1 Jan 2030)
Intro.

# 1. How a package runs
1. **Workflow** (standing opt-in; Julian, 13 Oct: "faster"): parts run as one Workflow.
2. The session that opened the PR merges it on green (PR #12).

# 2. Models
- Every Agent and Workflow `agent()` call names its `model` (2-9 Oct: 87 % named none).
- Context costs (PRACTICES B2) (see the table).

# 3. Visible rules only
- **No hidden blockers**: no hook blocks a tool call.
'''


class LiveRules(unittest.TestCase):
    def test_parse_title_version_and_citations(self):
        r = cs.parse_rules(RULES_MD, CFG)
        self.assertEqual((r['title'], r['version'], r['label']), ('Team Rules V9.1 (1 Jan 2030)', '9.1', 'V9.1'))
        self.assertEqual([s['num'] for s in r['sections']], ['1', '2', '3'])
        self.assertEqual(r['sections'][0]['lines'][1]['citations'], ['PR #12'])
        self.assertEqual(r['sections'][1]['lines'][1]['citations'], ['PRACTICES B2'])  # '(see the table)' is no evidence
        self.assertEqual(cs.parse_rules('# No version here\n', CFG)['version'], '')
        self.assertTrue(cs.rule_ref(r, r'No hidden blockers').startswith('§3 Visible rules only: No hidden blockers'))
        self.assertEqual(cs.rule_ref(r, r'nothing like this'), '')

    def test_metric_rule_comes_from_the_live_file(self):
        r = cs.parse_rules(RULES_MD, CFG)
        m = {'rule': 'fallback', 'rule_find': r'call names its .?model'}
        self.assertTrue(cs.metric_rule(m, r).startswith('§2 Models: Every Agent'))
        self.assertEqual(cs.metric_rule(m, {'sections': []}), 'fallback (not in the live rules)')
        self.assertFalse(any('V5' in json.dumps(x) for x in CFG['metrics']))

    def test_settings_values_never_shown_except_allowlist(self):
        tmp = tempfile.mkdtemp()
        try:
            home = os.path.join(tmp, 'home')
            os.makedirs(os.path.join(home, 'workflows'))
            with open(os.path.join(home, 'CLAUDE.md'), 'w', encoding='utf8') as f:
                f.write(RULES_MD)
            settings = {'env': {'MY_API_TOKEN': 'tok-should-not-leak', 'SOME_URL': 'value-should-not-leak',
                                'CLAUDE_CODE_SUBAGENT_MODEL': 'claude-sonnet-5-5'},
                        'hooks': {'Stop': [{'hooks': [{'type': 'command', 'command': 'python x/notify.py --token abc123'}]}]}}
            with open(os.path.join(home, 'settings.json'), 'w', encoding='utf8') as f:
                json.dump(settings, f)
            with open(os.path.join(home, 'workflows', 'wave.js'), 'w', encoding='utf8') as f:
                f.write("export const meta = { name: 'wave', description: 'one coder per package' }")
            cfg = json.loads(json.dumps(CFG))
            cfg['paths'].update(claude_home=home, projects_root=os.path.join(tmp, 'none'))
            out = os.path.join(tmp, 'out')
            os.makedirs(out)
            data = cs.scan_setup(cfg, out, run_schtasks=False, environ={})
            with open(os.path.join(out, 'setup.json'), encoding='utf8') as f:
                text = f.read()
            self.assertNotIn('should-not-leak', text)
            self.assertNotIn('abc123', text)
            names = [it['name'] for s in data['sections'] for it in s['items']]
            self.assertIn('env MY_API_TOKEN', names)
            self.assertIn('env SOME_URL', names)
            self.assertIn('env CLAUDE_CODE_SUBAGENT_MODEL = claude-sonnet-5-5', names)
            self.assertIn('Stop[*] notify.py', names)
            self.assertIn('wave', names)
            self.assertEqual(data['live']['version'], '9.1')
            self.assertEqual(data['live']['workflows'], 1)
            self.assertEqual(data['rules_version'], 'Team Rules V9.1 (1 Jan 2030)')
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_mod_states(self):
        tmp = tempfile.mkdtemp()
        try:
            home = os.path.join(tmp, 'home')
            repo_mods = os.path.join(tmp, 'repo', 'mods')
            for d in (os.path.join(home, 'mods', 'old'), os.path.join(home, 'mods', 'band'), os.path.join(repo_mods, 'band'),
                      os.path.join(repo_mods, 'ci')):
                os.makedirs(os.path.join(d, '.claude-plugin'))
                with open(os.path.join(d, '.claude-plugin', 'plugin.json'), 'w') as f:
                    json.dump({'name': os.path.basename(d), 'version': '0.1.0'}, f)
            cfg = json.loads(json.dumps(CFG))
            cfg['mods']['extra_roots'] = [repo_mods]
            band = os.path.join(repo_mods, 'band')
            gone = os.path.join(tmp, 'gone')
            sep = ';' if os.name == 'nt' else ':'
            res = cs.mod_states(cfg, home, {'env': {'CLAUDE_CODE_PLUGIN_DIRS': band + sep + gone}},
                                environ={'CLAUDE_CODE_PLUGIN_DIRS': band})
            st = {m['name']: m['state'] for m in res['items'] if m['state'] != 'shadowed'}
            self.assertEqual([m['path'] for m in res['items'] if m['state'] == 'shadowed'],
                             [os.path.join(home, 'mods', 'band').replace(os.sep, '/')])
            self.assertEqual(st, {'band': 'loaded', 'gone': 'missing', 'ci': 'installed', 'old': 'installed'})
            band_row = next(m for m in res['items'] if m['name'] == 'band')
            self.assertEqual(sorted(band_row['sources']), ['environment of this session', 'settings.json env'])
            self.assertTrue(res['differ'])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_v6_changes_from_main_branch(self):
        md = ('# V6 changes\n## Kept\n- One lane one session\n- Merge on green\n'
              '## Changed\n- Workflow by default\n## Dropped\n- Night mode\n')
        r = cs.parse_changes(md, CFG)
        self.assertEqual({k: v['count'] for k, v in r['groups'].items()}, {'kept': 2, 'changed': 1, 'dropped': 1})
        t = cs.parse_changes('# T\n| Rule | Verdict |\n|---|---|\n| Hooks | dropped |\n| Routing | kept |\n', CFG)
        self.assertEqual(t['groups']['dropped']['items'], ['Hooks'])
        tmp = tempfile.mkdtemp()
        try:
            git = ['git', '-C', tmp, '-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false']
            subprocess.run(['git', 'init', '-q', '-b', 'main', tmp], check=True)
            cfg = json.loads(json.dumps(CFG))
            cfg['v6'].update(repo=tmp, refs=['main'])
            subprocess.run(git + ['commit', '-q', '--allow-empty', '-m', 'init'], check=True)
            self.assertEqual(cs.read_v6(cfg)['state'], 'none')
            os.makedirs(os.path.join(tmp, 'docs'))
            with open(os.path.join(tmp, 'docs', 'V6-CHANGES.md'), 'w', encoding='utf8') as f:
                f.write(md)
            self.assertEqual(cs.read_v6(cfg)['state'], 'none')  # on disk but not committed on main
            subprocess.run(git + ['add', '.'], check=True)
            subprocess.run(git + ['commit', '-q', '-m', 'v6'], check=True)
            v = cs.read_v6(cfg)
            self.assertEqual((v['state'], v['source']), ('pending', 'main:docs/V6-CHANGES.md'))
            self.assertEqual(v['groups']['kept']['items'], ['One lane one session', 'Merge on green'])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_user_override_merges(self):
        merged = cs.deep_merge({'a': {'b': 1, 'c': [1]}, 'd': 2}, {'a': {'c': [2]}, '_doc': 'x'})
        self.assertEqual(merged, {'a': {'b': 1, 'c': [2]}, 'd': 2})


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
