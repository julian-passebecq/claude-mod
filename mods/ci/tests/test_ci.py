"""Logic tests of the CI routing scanner: python -I -m unittest discover -s mods/ci/tests -p "test_*.py" """
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scanner'))
import ci  # noqa: E402

EXAMPLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ci.config.example.json')
SECRET = 'glpat-' + 'x' * 24  # a fake token value that must never show anywhere


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        with open(EXAMPLE, encoding='utf8') as f:
            cfg = json.load(f)
        cfg['routing_file'] = os.path.join(self.tmp, 'routing.json')
        cfg['status_cache'] = os.path.join(self.tmp, 'cache.json')
        self.cfg_file = os.path.join(self.tmp, 'ci.config.json')
        with open(self.cfg_file, 'w', encoding='utf8') as f:
            json.dump(cfg, f)
        self.cfg = ci.load_config(self.cfg_file)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def backend(self, bid):
        return next(b for b in self.cfg['backends'] if b['id'] == bid)


class ConfigTest(Base):
    def test_example_has_the_presets(self):
        ids = ci.backend_ids(self.cfg)
        self.assertEqual(ids, ['github-hosted', 'gitlab-saas', 'gitlab-local', 'gitlab-oracle-vm', 'github-oracle-vm'])
        for b in self.cfg['backends']:
            for k in ('id', 'label', 'kind', 'host', 'runner_tag', 'status', 'notes'):
                self.assertIn(k, b, f'{b["id"]} lacks {k}')
            self.assertIn(b['kind'], ('github', 'gitlab'))
            self.assertIn(b['status'], ('active', 'coming-soon', 'disabled'))
        self.assertEqual(self.backend('gitlab-local')['runner_tag'], 'local-windows')
        self.assertEqual(self.backend('github-oracle-vm')['status'], 'coming-soon')

    def test_placeholders_are_unset(self):
        self.assertTrue(ci.is_placeholder('<GITLAB_GROUP>'))
        self.assertTrue(ci.is_placeholder(''))
        self.assertFalse(ci.is_placeholder('my-group'))


class RoutingTest(Base):
    def test_route_resolve_clear(self):
        repo = os.path.join(self.tmp, 'repo')
        os.makedirs(os.path.join(repo, '.claude', 'worktrees', 'lane'))
        r = ci.set_route(self.cfg, repo, 'gitlab-local', by='lead')
        self.assertEqual(r['kind'], 'repo')
        self.assertEqual(r['set_by'], 'lead')
        self.assertTrue(r['set_at'].endswith('Z'))
        routes = ci.load_routes(self.cfg)
        # a worktree inside the repo follows the repo's route
        got = ci.resolve(routes, os.path.join(repo, '.claude', 'worktrees', 'lane'))
        self.assertEqual(got['backend'], 'gitlab-local')
        self.assertEqual(got['match'], 'repo')
        self.assertIsNone(ci.resolve(routes, self.tmp))
        # a session route wins over the repo route
        ci.set_route(self.cfg, 'sess-123', 'gitlab-saas', by='julian')
        got = ci.resolve(ci.load_routes(self.cfg), repo, ['sess-123'])
        self.assertEqual((got['backend'], got['match']), ('gitlab-saas', 'session'))
        # same repo again: replaced, not duplicated
        ci.set_route(self.cfg, repo + os.sep, 'github-hosted')
        self.assertEqual(sum(1 for v in ci.load_routes(self.cfg).values() if v['kind'] == 'repo'), 1)
        self.assertEqual(ci.clear_route(self.cfg, repo)['removed'], 1)
        self.assertEqual(ci.clear_route(self.cfg, 'sess-123')['removed'], 1)
        self.assertEqual(ci.load_routes(self.cfg), {})

    def test_deepest_repo_wins(self):
        outer, inner = os.path.join(self.tmp, 'a'), os.path.join(self.tmp, 'a', 'b')
        os.makedirs(inner)
        ci.set_route(self.cfg, outer, 'gitlab-saas')
        ci.set_route(self.cfg, inner, 'gitlab-local')
        self.assertEqual(ci.resolve(ci.load_routes(self.cfg), os.path.join(inner, 'src'))['backend'], 'gitlab-local')
        # a sibling with the same prefix does not match
        self.assertIsNone(ci.resolve(ci.load_routes(self.cfg), os.path.join(self.tmp, 'ab')))

    def test_unknown_backend_refused_and_coming_soon_warned(self):
        with self.assertRaises(ValueError):
            ci.set_route(self.cfg, 'sess', 'nope')
        self.assertIn('coming-soon', ci.set_route(self.cfg, 'sess', 'gitlab-oracle-vm')['warning'])

    def test_key_kinds(self):
        self.assertEqual(ci.route_key('~/x')[0], 'repo')
        self.assertEqual(ci.route_key('C:/code/x')[0], 'repo')
        self.assertEqual(ci.route_key('local_abc-123'), ('session', 'local_abc-123'))

    def test_cli_route_and_bad_usage(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(ci.main(['route', 'sess-9', 'gitlab-local', '--config', self.cfg_file, '--by', 'me']), 0)
        self.assertEqual(json.loads(out.getvalue())['backend'], 'gitlab-local')
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(ci.main(['route', 'sess-9', '--config', self.cfg_file]), 2)
        self.assertIn('usage', json.loads(out.getvalue())['error'])


class CheckTest(Base):
    def test_missing_tools_are_unknown(self):
        with mock.patch.object(ci.shutil, 'which', return_value=None):
            t = ci.token_state(self.cfg, 'gitlab.com', env={})
        self.assertEqual(t, {'present': 'unknown', 'source': ''})

    def test_env_token_presence_only_never_value(self):
        env = {'GITLAB_TOKEN': SECRET}
        calls = []

        def api(cfg, host, path, source):
            calls.append((path, source))
            if path.startswith('groups/') or path.startswith('runners?'):
                return [{'id': 7, 'status': 'online', 'active': True}, {'id': 8, 'status': 'offline', 'active': True}]
            if path.startswith('runners/7/jobs'):
                return [{'id': 1}, {'id': 2}]
            return None

        with mock.patch.object(ci.shutil, 'which', return_value=None):
            res = ci.check_backend(self.cfg, self.backend('gitlab-local'), {}, env=env, api=api)
        self.assertEqual(res['token'], {'present': 'yes', 'source': 'env:GITLAB_TOKEN'})
        self.assertEqual(res['runners'], {'online': 1, 'offline': 1, 'total': 2})
        self.assertEqual(res['jobs'], {'running': 2, 'pending': None})
        self.assertEqual(res['usable'], 'yes')
        # group placeholder: the user's own runners endpoint, filtered by tag
        self.assertTrue(calls[0][0].startswith('runners?tag_list=local-windows'))
        self.assertNotIn(SECRET, json.dumps(res))

    def test_status_cache_has_no_token(self):
        env = {'GITLAB_TOKEN': SECRET, 'GH_TOKEN': SECRET}
        with mock.patch.object(ci.shutil, 'which', return_value=None), mock.patch.dict(os.environ, env):
            data = ci.status(self.cfg, refresh=True, env=env, api=lambda *a: None, gh=lambda p: (1, ''))
        with open(self.cfg['status_cache'], encoding='utf8') as f:
            self.assertNotIn(SECRET, f.read())
        self.assertNotIn(SECRET, json.dumps(data))
        c = data['checks']
        self.assertEqual(c['gitlab-oracle-vm']['usable'], 'no')
        self.assertEqual(c['gitlab-oracle-vm']['why'], 'coming-soon')
        self.assertEqual(c['gitlab-saas']['usable'], 'yes')  # shared runners: token is enough
        self.assertIsNone(c['gitlab-local']['runners'])  # API failed: unknown, no error
        # a second call within cache_minutes reads the cache
        again = ci.status(self.cfg, env={}, api=lambda *a: 1 / 0)
        self.assertEqual(again['generated'], data['generated'])

    def test_usable_rules(self):
        b = {'status': 'active'}
        self.assertEqual(ci.usable(b, {'present': 'no'}, None)[0], 'no')
        self.assertEqual(ci.usable(b, {'present': 'unknown'}, None)[0], 'unknown')
        self.assertEqual(ci.usable(b, {'present': 'yes'}, {'online': 0, 'offline': 1, 'total': 1}), ('no', 'no runner online'))
        self.assertEqual(ci.usable({'status': 'disabled'}, {'present': 'yes'}, None), ('no', 'disabled'))

    def test_github_private_repo_refused_on_public_only(self):
        routes = {'/r/pub': {'kind': 'repo', 'backend': 'github-hosted'}, '/r/priv': {'kind': 'repo', 'backend': 'github-hosted'}}
        slugs = {'/r/pub': 'me/pub', '/r/priv': 'me/priv'}

        def gh(path):
            if path == 'repos/me/pub':
                return 0, json.dumps({'private': False})
            if path == 'repos/me/priv':
                return 0, json.dumps({'private': True})
            if path == 'repos/me/pub/actions/permissions':
                return 0, json.dumps({'enabled': True})
            return 1, ''

        with mock.patch.object(ci, 'github_repo_of', side_effect=lambda p, t: slugs[p]):
            out = ci.github_actions(self.cfg, self.backend('github-hosted'), routes, gh)
        by = {x['repo']: x for x in out}
        self.assertEqual(by['me/pub']['actions'], 'yes')
        self.assertEqual(by['me/priv']['actions'], 'no')

    def test_show_without_cache_is_stale_and_lists_backends(self):
        ci.set_route(self.cfg, 'sess-1', 'gitlab-local', by='lead')
        out = ci.show(self.cfg, self.tmp, ['sess-1'])
        self.assertTrue(out['stale'])
        self.assertIsNone(out['generated'])
        self.assertEqual(len(out['backends']), 5)
        self.assertEqual(out['current']['backend'], 'gitlab-local')
        self.assertEqual(out['routes'][0]['set_by'], 'lead')
        self.assertEqual(out['labels']['title'], 'CI routing')

    def test_prompt_note_off_by_default(self):
        # The note would add text to every request: off unless the config says prompt_note: true.
        self.assertFalse(ci.show(self.cfg, self.tmp, [])['options']['prompt_note'])
        cfg = {k: v for k, v in self.cfg.items() if k != 'prompt_note'}
        self.assertFalse(ci.show(cfg, self.tmp, [])['options']['prompt_note'])


if __name__ == '__main__':
    unittest.main()
