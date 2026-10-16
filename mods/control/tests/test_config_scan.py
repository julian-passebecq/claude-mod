"""CONFIG scanner tests on a fixture home (no real data): python -I -m unittest discover -s mods/control/tests -p "test_*.py"
Checks every category is filled, settings precedence, and that no secret value is ever written."""
import datetime as dt
import glob
import json
import os
import shutil
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'scanner'))
import config_scan  # noqa: E402
import control_scan as cs  # noqa: E402

CFG = cs.load_config(user_override=False)
SECRETS = ['fixture-token-value-111', 'sk-' + 'ant-api03-fixturefixture', 'hunter2-password', 'ghp_' + 'A' * 30,
           'mcp-env-secret-222', 'header-secret-333', 'url-user:url-pass', 'oauth-fixture-444']


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf8') as f:
        f.write(text if isinstance(text, str) else json.dumps(text))


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        t = self.tmp
        self.home = os.path.join(t, 'home', '.claude')
        self.projects = os.path.join(t, 'code')
        self.repo = os.path.join(self.projects, 'app-one')
        self.control = os.path.join(self.projects, 'rules-repo')
        self.out = os.path.join(t, 'out')
        self.appdata = os.path.join(t, 'appdata')
        os.makedirs(self.out)
        h = self.home
        write(os.path.join(h, 'CLAUDE.md'), '# Team Rules V9.1 (1 Jan 2030)\n\n# 1. Decide\n- Agents decide.\n')
        write(os.path.join(h, 'settings.json'), {
            'model': 'opus', 'outputStyle': 'Concise', 'apiKeyHelper': 'hunter2-password',
            'env': {'CLAUDE_CODE_SUBAGENT_MODEL': 'sonnet', 'MY_TOKEN': 'fixture-token-value-111',
                    'ANTHROPIC_API_KEY': 'sk-' + 'ant-api03-fixturefixture', 'ANTHROPIC_BASE_URL': 'https://example.test',
                    'NOTE': 'uses ghp_' + 'A' * 30},
            'permissions': {'defaultMode': 'bypassPermissions', 'allow': ['Bash(git:*)', 'Read']},
            'enabledPlugins': {'helper@market': True, 'off@market': False}})
        write(os.path.join(h, 'agents', 'coder.md'),
              '---\nname: coder\ndescription: Builds one package\nmodel: opus\neffort: medium\ntools: Read, Edit\n---\nBody of the coder.\n')
        write(os.path.join(h, 'skills', 'handoff', 'SKILL.md'), '---\nname: handoff\ndescription: Write a hand-off\n---\nSteps.\n')
        write(os.path.join(h, 'commands', 'ship.md'), '---\ndescription: Ship it\n---\nShip.\n')
        write(os.path.join(h, 'workflows', 'wave.js'), "export default { name: 'package-wave', description: 'Run a wave' }\n")
        write(os.path.join(h, 'output-styles', 'terse.md'), '---\nname: Terse\ndescription: Short answers\n---\nBe short.\n')
        write(os.path.join(h, 'projects', 'C--code-app-one', 'memory', 'MEMORY.md'), '- [pref](pref.md) a preference\n')
        write(os.path.join(h, 'projects', 'C--code-app-one', 'memory', 'pref.md'), '---\ndescription: likes tests\n---\nLikes tests.\n')
        write(os.path.join(h, 'mods', 'oldmod', '.claude-plugin', 'plugin.json'), {'name': 'oldmod', 'version': '0.0.1'})
        mkt = os.path.join(h, 'plugins', 'marketplaces', 'market', 'plugins', 'helper')
        write(os.path.join(mkt, '.claude-plugin', 'plugin.json'), {'name': 'helper', 'version': '1.0.0'})
        write(os.path.join(mkt, 'skills', 'help', 'SKILL.md'), '---\nname: help\ndescription: Plugin skill\n---\nHelp.\n')
        write(os.path.join(mkt, 'hooks', 'hooks.json'), {'hooks': {}})
        write(os.path.join(h, 'plugins', 'known_marketplaces.json'),
              {'market': {'source': {'source': 'git', 'url': 'https://url-user:url-pass@example.test/m.git'}}})
        # repos: a project with local settings that override the user's model, and the rules repo
        os.makedirs(os.path.join(self.repo, '.git'))
        write(os.path.join(self.repo, 'CLAUDE.md'), '# App one\nProject rules.\n')
        write(os.path.join(self.repo, 'AGENTS.md'), '# Agents\n')
        write(os.path.join(self.repo, '.claude', 'settings.json'),
              {'model': 'sonnet', 'permissions': {'allow': ['Edit']},
               'hooks': {'PreToolUse': [{'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': 'python guard.py --token fixture-token-value-111'}]}]}})
        write(os.path.join(self.repo, '.claude', 'settings.local.json'), {'model': 'haiku', 'theme': 'dark'})
        write(os.path.join(self.repo, '.claude', 'agents', 'local.md'), '---\nname: local\nmodel: haiku\n---\nLocal agent.\n')
        write(os.path.join(self.repo, '.mcp.json'), {'mcpServers': {'db': {
            'command': 'npx', 'args': ['db-mcp', '--api-key', 'mcp-env-secret-222'],
            'env': {'DB_PASSWORD': 'mcp-env-secret-222'}, 'headers': {'Authorization': 'header-secret-333'}}}})
        os.makedirs(os.path.join(self.control, '.git'))
        write(os.path.join(self.control, 'config', 'claude', 'CLAUDE.md'), '# Team Rules V9.2 (2 Jan 2030)\n')
        write(os.path.join(self.control, 'config', 'claude', 'agents', 'coder.md'),
              '---\nname: coder\ndescription: Builds one package\nmodel: opus\neffort: medium\ntools: Read, Edit\n---\nBody of the coder.\n')
        write(os.path.join(self.control, 'tools', 'deploy.py'), '# deploy\n')
        write(os.path.join(self.control, 'docs', 'RULES-INVENTORY.md'), '# Rules inventory\n| Place | What |\n')
        os.makedirs(os.path.join(h, 'effort-board', '_deploy_backups', '20300101-120000'))
        write(os.path.join(self.appdata, 'Claude', 'claude_desktop_config.json'), {
            'mcpServers': {'desk': {'command': 'node', 'args': ['srv.js']}},
            'preferences': {'keepAwakeEnabled': True, 'ccAutoArchiveInactiveDays': 2,
                            'bypassPermissionsOptInByAccount': {'acct': True}, 'oauthToken': 'oauth-fixture-444'}})
        write(os.path.join(t, 'home', '.claude.json'), {'mcpServers': {'web': {'type': 'http', 'url': 'https://example.test/mcp?key=fixture-token-value-111'}},
                                                        'oauthAccount': {'token': 'oauth-fixture-444'}})
        # an old file, outside the 7-day Changes window
        old = time.time() - 30 * 86400
        os.utime(os.path.join(self.repo, 'AGENTS.md'), (old, old))

        cfg = json.loads(json.dumps(CFG))
        cfg['paths']['claude_home'] = self.home
        cfg['paths']['projects_root'] = self.projects
        cfg['paths']['user_config'] = ''  # never the real override file of the machine running the tests
        cfg['config_claude']['claude_json'] = os.path.join(t, 'home', '.claude.json')
        cfg['config_claude']['claude_control_repo'] = self.control
        cfg['config_claude']['managed_paths'] = {'nt': [os.path.join(t, 'managed', 'managed-settings.json')],
                                                 'posix': [os.path.join(t, 'managed', 'managed-settings.json')]}
        cfg['mods']['extra_roots'] = []
        self.cfg = cfg
        self.env = {'APPDATA': self.appdata, 'CLAUDE_CODE_EFFORT_LEVEL': 'low', 'ANTHROPIC_AUTH_TOKEN': 'oauth-fixture-444',
                    'PATH': '/bin'}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def scan(self, project=None):
        return config_scan.scan_config(self.cfg, self.out, project=project or self.repo, environ=self.env)

    def items(self, data, cat):
        c = next(c for c in data['categories'] if c['id'] == cat)
        return {it['name']: it for s in c['subs'] for it in s['items']}

    def contents(self):
        out = {}
        for p in glob.glob(os.path.join(self.out, 'config-claude.content.*.json')):
            with open(p, encoding='utf8') as f:
                out.update(json.load(f))
        return out

    def test_every_category_is_filled(self):
        data = self.scan()
        self.assertEqual([c['id'] for c in data['categories']],
                         ['rules', 'agents', 'skills', 'settings', 'defaults', 'hooks', 'mods', 'mcp', 'desktop', 'control'])
        for c in data['categories']:
            self.assertGreater(c['count'], 0, c['id'])
        rules = self.items(data, 'rules')
        self.assertIn('Team Rules V9.1 (1 Jan 2030)', dict(rules['CLAUDE.md']['meta'])['version'])
        self.assertIn('app-one/CLAUDE.md', rules)
        self.assertIn('app-one/AGENTS.md', rules)
        self.assertIn('pref.md', rules)
        self.assertIn('Terse (user)', rules)
        agents = self.items(data, 'agents')
        self.assertEqual(dict(agents['coder']['meta'])['model'], 'opus')
        self.assertEqual(dict(agents['coder']['meta'])['tools'], 'Read, Edit')
        self.assertIn('local', agents)
        self.assertTrue(any(n.startswith('Explore') and it['badge'] == 'intégré' for n, it in agents.items()))
        skills = self.items(data, 'skills')
        self.assertIn('handoff (user)', skills)
        self.assertIn('help (plugin helper@market)', skills)
        self.assertIn('/ship (user)', skills)
        self.assertIn('package-wave (user)', skills)
        # full text of an item is in a content shard
        self.assertIn('Body of the coder.', self.contents()[agents['coder']['id']])

    def test_precedence(self):
        data = self.scan()
        eff = self.items(data, 'settings')
        model = dict(eff['model']['meta'])
        self.assertEqual(model['valeur'], 'haiku')  # local > project > user
        self.assertEqual(model['défini par'], 'local')
        self.assertEqual(model['écrase'], 'project, user')
        allow = dict(eff['permissions.allow']['meta'])
        self.assertEqual(allow['défini par'], 'project, user')  # lists merge
        self.assertIn('Edit', allow['valeur'])
        self.assertIn('Bash(git:*)', allow['valeur'])
        self.assertEqual(dict(eff['theme']['meta'])['défini par'], 'local')
        rows, _ = config_scan.effective_settings(config_scan.settings_sources(self.cfg, self.home, self.repo),
                                                 config_scan.Masker(self.cfg['config_claude']))
        self.assertEqual([r['key'] for r in rows if r['key'] == 'model'][0], 'model')
        # managed wins over everything
        write(os.path.join(self.tmp, 'managed', 'managed-settings.json'), {'model': 'opus'})
        model = dict(self.items(self.scan(), 'settings')['model']['meta'])
        self.assertEqual((model['valeur'], model['défini par'], model['écrase']), ('opus', 'managed', 'local, project, user'))

    def test_no_secret_value_is_written(self):
        self.scan()
        for p in glob.glob(os.path.join(self.out, 'config-claude*.json')):
            with open(p, encoding='utf8') as f:
                text = f.read()
            for s in SECRETS:
                self.assertNotIn(s, text, f'{s} leaked in {os.path.basename(p)}')
        data = self.scan()
        eff = self.items(data, 'settings')
        self.assertEqual(dict(eff['env.MY_TOKEN']['meta'])['valeur'], config_scan.MASK)
        self.assertEqual(dict(eff['env.ANTHROPIC_BASE_URL']['meta'])['valeur'], config_scan.MASK)
        self.assertEqual(dict(eff['env.CLAUDE_CODE_SUBAGENT_MODEL']['meta'])['valeur'], 'sonnet')
        self.assertIn('ANTHROPIC_AUTH_TOKEN (processus)', eff)
        self.assertEqual(dict(eff['ANTHROPIC_AUTH_TOKEN (processus)']['meta'])['valeur'], 'nom seulement')
        mcp = self.items(data, 'mcp')
        db = dict(mcp['db (project app-one)']['meta'])
        self.assertEqual(db['env (noms)'], 'DB_PASSWORD')
        self.assertEqual(db['headers (noms)'], 'Authorization')

    def test_masker(self):
        m = config_scan.Masker(self.cfg['config_claude'])
        self.assertEqual(m.value('apiKeyHelper', 'x'), config_scan.MASK)
        self.assertEqual(m.value('enabled', True), True)
        self.assertEqual(m.doc({'env': {'ANTHROPIC_MODEL': 'opus', 'X': 'y'}})['env'], {'ANTHROPIC_MODEL': config_scan.MASK, 'X': 'y'})
        self.assertNotIn('sk-' + 'ant-api03-zzzzzzzz', m.text('use sk-' + 'ant-api03-zzzzzzzz now'))

    def test_defaults_hooks_mods_desktop_control(self):
        data = self.scan()
        d = self.items(data, 'defaults')
        self.assertEqual(dict(d['Modèle']['meta'])['chez nous'], 'haiku (local)')
        self.assertIn('processus', dict(d['Effort']['meta'])['chez nous'])
        self.assertEqual(dict(d['Compaction au repos']['meta'])['vérifié'], 'non vérifié')
        self.assertTrue(dict(d['Fenêtre d\'auto-compact']['meta'])['doc'].startswith('https://code.claude.com/docs/'))
        h = self.items(data, 'hooks')
        self.assertIn('PreToolUse[Bash] (project)', h)
        self.assertIn('defaultMode bypassPermissions', h)
        m = self.items(data, 'mods')
        self.assertEqual(m['oldmod 0.0.1']['badge'], 'copie ancienne')
        self.assertIn('helper@market', m)
        self.assertEqual(dict(m['off@market']['meta'])['état'], 'désactivé')
        self.assertNotIn('url-pass', dict(m['market']['meta'])['source'])
        desk = self.items(data, 'desktop')
        self.assertEqual(dict(desk['Garder le PC éveillé']['meta'])['valeur'], 'true')
        self.assertEqual(dict(desk['Bypass permissions autorisé']['meta'])['valeur'], 'true')
        self.assertEqual(dict(desk['Préfixe des branches']['meta'])['valeur'], 'non lisible depuis un mod')
        ctl = next(c for c in data['categories'] if c['id'] == 'control')
        self.assertEqual(ctl['badge'], '1 écarts')  # CLAUDE.md differs, the agent matches
        items = self.items(data, 'control')
        self.assertIn('config/claude/CLAUDE.md → ~/.claude/CLAUDE.md', items)
        self.assertEqual(dict(items['Dernier déploiement (sauvegarde)']['meta'])['dernière'], '20300101-120000')
        self.assertIn('RULES-INVENTORY.md', items)

    def test_changes_last_7_days_newest_first(self):
        data = self.scan()
        names = [c['name'] for c in data['changes']]
        self.assertIn('CLAUDE.md', names)
        self.assertNotIn('app-one/AGENTS.md', names)
        times = [c['mtime'] for c in data['changes']]
        self.assertEqual(times, sorted(times, reverse=True))

    def test_shards_split_and_old_ones_removed(self):
        self.cfg['config_claude']['shard_chars'] = 50
        data = self.scan()
        self.assertGreater(len(data['shards']), 1)
        self.cfg['config_claude']['shard_chars'] = 10 ** 7
        data = self.scan()
        self.assertEqual(data['shards'], ['config-claude.content.0.json'])
        self.assertEqual(len(glob.glob(os.path.join(self.out, 'config-claude.content.*.json'))), 1)

    def test_cli_entry_point(self):
        """`control_scan.py config` writes the index (as python -I runs it from the mod)."""
        import subprocess
        cfgp = os.path.join(self.tmp, 'cfg.json')
        write(cfgp, self.cfg)
        r = subprocess.run([sys.executable, '-I', os.path.join(os.path.dirname(HERE), 'scanner', 'control_scan.py'), 'config',
                            '--config', cfgp, '--out', self.out, '--project', self.repo], capture_output=True, text=True,
                           timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(self.out, 'config-claude.json')))


if __name__ == '__main__':
    unittest.main()
