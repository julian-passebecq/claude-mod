"""Diagramme view of the ci mod (scanner/pipelines.py), with invented repos, runs and transcripts.
python -I -m unittest discover -s mods/ci/tests -p "test_*.py" """
import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scanner'))
import ci  # noqa: E402
import pipelines as pl  # noqa: E402

EXAMPLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ci.config.example.json')
NOW = dt.datetime(2026, 10, 16, 20, 0, 0, tzinfo=dt.timezone.utc)
SECRET = 'glpat-' + 'y' * 24


def z(t):
    return t.replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def ago(minutes):
    return z(NOW - dt.timedelta(minutes=minutes))


class Fake:
    """Answers the gh / glab / git argv the scanner sends, from invented data; records every call."""

    def __init__(self, gh_runs=None, gh_jobs=None, gl_pipes=None, gl_jobs=None, remotes=None, commits=None):
        self.gh_runs, self.gh_jobs = gh_runs or {}, gh_jobs or {}
        self.gl_pipes, self.gl_jobs = gl_pipes or {}, gl_jobs or {}
        self.remotes, self.commits = remotes or {}, commits or {}
        self.calls = []

    def __call__(self, argv):
        self.calls.append(argv)
        if argv[:2] == ['git', '-C'] and argv[3:5] == ['remote', '-v']:
            urls = self.remotes.get(argv[2])
            return (0, ''.join(f'{n}\t{u} (fetch)\n' for n, u in urls)) if urls else (128, '')
        if argv[:2] == ['git', '-C'] and argv[3] == 'log':
            c = self.commits.get(argv[-1])
            return (0, f'{c[0]}\x00{c[1]}') if c else (128, '')
        if argv[:3] == ['gh', 'run', 'list']:
            slug = argv[4]
            return (0, json.dumps(self.gh_runs[slug])) if slug in self.gh_runs else (1, '')
        if argv[:3] == ['gh', 'run', 'view']:
            jobs = self.gh_jobs.get(int(argv[3]))
            return (0, json.dumps({'jobs': jobs})) if jobs is not None else (1, '')
        if argv[:2] == ['glab', 'api']:
            path = argv[4]
            for key, val in self.gl_jobs.items():
                if f'/pipelines/{key}/jobs' in path:
                    return 0, json.dumps(val)
            for key, val in self.gl_pipes.items():
                if path.startswith(f'projects/{key}/pipelines?'):
                    return 0, json.dumps(val)
            return 1, ''
        return None, ''


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        with open(EXAMPLE, encoding='utf8') as f:
            cfg = json.load(f)
        cfg['routing_file'] = os.path.join(self.tmp, 'routing.json')
        cfg['status_cache'] = os.path.join(self.tmp, 'cache.json')
        cfg['pipelines'].update({
            'roots': [], 'repos': ['/code/app-one', '/code/app-two'],
            'projects_dir': os.path.join(self.tmp, 'projects'),
            'pipelines_cache': os.path.join(self.tmp, 'pc.json'),
            'conversations_cache': os.path.join(self.tmp, 'cc.json'),
            'runs_per_repo': 10, 'jobs_runs': 2, 'concurrency': 2,
        })
        for b in cfg['backends']:
            if b['id'] == 'gitlab-local':
                b['concurrent'] = 18
        path = os.path.join(self.tmp, 'ci.config.json')
        with open(path, 'w', encoding='utf8') as f:
            json.dump(cfg, f)
        self.cfg = ci.load_config(path)
        self.helpers = (ci.expand, ci.read_json, ci.write_json, ci.is_placeholder)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def transcript(self, project, session, lines):
        d = os.path.join(self.tmp, 'projects', project)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, session + '.jsonl'), 'w', encoding='utf8') as f:
            for line in lines:
                f.write(json.dumps(line) + '\n')

    def world(self):
        """app-one on GitHub (public), app-two on GitHub with a GitLab CI mirror on the local runner."""
        gh_runs = {
            'acme/app-one': [
                {'databaseId': 11, 'status': 'completed', 'conclusion': 'failure', 'headBranch': 'claude/fix-lint',
                 'headSha': 'a1', 'createdAt': ago(30), 'startedAt': ago(30), 'updatedAt': ago(25), 'event': 'pull_request',
                 'workflowName': 'tests', 'displayTitle': 'Fix lint', 'url': 'https://github.com/acme/app-one/actions/runs/11'},
                {'databaseId': 10, 'status': 'completed', 'conclusion': 'success', 'headBranch': 'codex/speedup',
                 'headSha': 'a0', 'createdAt': ago(600), 'startedAt': ago(600), 'updatedAt': ago(598), 'event': 'pull_request',
                 'workflowName': 'tests', 'displayTitle': 'Speed up', 'url': 'u10'},
                {'databaseId': 9, 'status': 'completed', 'conclusion': 'success', 'headBranch': 'main',
                 'headSha': 'a9', 'createdAt': ago(60 * 24 * 3), 'startedAt': ago(60 * 24 * 3), 'updatedAt': ago(60 * 24 * 3 - 3),
                 'event': 'push', 'workflowName': 'tests', 'displayTitle': 'x', 'url': 'u9'},
            ],
            'acme/app-two': [],
        }
        gh_jobs = {11: [{'databaseId': 111, 'name': 'lint', 'status': 'completed', 'conclusion': 'failure',
                         'startedAt': ago(30), 'completedAt': ago(28), 'url': 'https://github.com/acme/app-one/actions/runs/11/job/111'}],
                   10: [{'databaseId': 101, 'name': 'lint', 'status': 'completed', 'conclusion': 'success',
                         'startedAt': ago(600), 'completedAt': ago(599), 'url': ''}]}
        enc = 'mirrors%2Fapp-two'
        gl_pipes = {enc: [
            {'id': 501, 'status': 'running', 'ref': 'claude/feature-x', 'sha': 'b1', 'created_at': ago(6), 'updated_at': ago(1),
             'source': 'push', 'web_url': 'https://gitlab.com/mirrors/app-two/-/pipelines/501'},
            {'id': 500, 'status': 'success', 'ref': 'main', 'sha': 'b0', 'created_at': ago(120), 'updated_at': ago(110),
             'source': 'push', 'web_url': 'w500'},
            {'id': 499, 'status': 'success', 'ref': 'refs/merge-requests/7/head', 'sha': 'b9', 'created_at': ago(300),
             'updated_at': ago(290), 'source': 'merge_request_event', 'web_url': 'w499'},
        ]}
        job = lambda i, name, stage, status, c, s, f, dur, q: {  # noqa: E731
            'id': i, 'name': name, 'stage': stage, 'status': status, 'created_at': c, 'started_at': s, 'finished_at': f,
            'duration': dur, 'queued_duration': q, 'tag_list': ['local-windows'], 'runner': {'is_shared': False},
            'web_url': f'https://gitlab.com/mirrors/app-two/-/jobs/{i}', 'allow_failure': False}
        gl_jobs = {
            501: [job(9001, 'build', 'build', 'success', ago(6), ago(5), ago(3), 120.0, 60.0),
                  job(9002, 'test', 'test', 'running', ago(3), ago(2), None, None, 60.0)],
            500: [job(8001, 'build', 'build', 'success', ago(120), ago(119), ago(117), 120.0, 60.0),
                  job(8002, 'test', 'test', 'success', ago(117), ago(116), ago(111), 300.0, 60.0)],
        }
        remotes = {'/code/app-one': [('origin', 'https://github.com/acme/app-one.git')],
                   '/code/app-two': [('origin', 'https://github.com/acme/app-two.git'),
                                     ('gitlab', 'https://gitlab.com/mirrors/app-two.git')]}
        commits = {'a9': ('Someone', 'Merge\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>\n'),
                   'b0': ('Someone', 'plain commit\n')}
        return Fake(gh_runs, gh_jobs, gl_pipes, gl_jobs, remotes, commits)


class AttributionTest(unittest.TestCase):
    def test_classify(self):
        self.assertEqual(pl.classify('claude/x'), 'claude')
        self.assertEqual(pl.classify('worktree-agent-abc'), 'claude')
        self.assertEqual(pl.classify('main', 'fix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'), 'claude')
        self.assertEqual(pl.classify('codex/r5'), 'codex')
        self.assertEqual(pl.classify('main', 'x\n\nCo-authored-by: Codex <codex@example.com>'), 'codex')
        self.assertEqual(pl.classify('main', '', 'chatgpt-codex-connector[bot]'), 'codex')
        self.assertEqual(pl.classify('feature/y', 'plain'), 'unknown')
        self.assertEqual(pl.classify('', ''), 'unknown')

    def test_remotes(self):
        self.assertEqual(pl.parse_remote('https://github.com/acme/app.git'), ('github', 'acme/app'))
        ssh = 'git' + '@github.com:acme/app.git'
        self.assertEqual(pl.parse_remote(ssh), ('github', 'acme/app'))
        self.assertEqual(pl.parse_remote('https://gitlab.com/grp/sub/app'), ('gitlab:gitlab.com', 'grp/sub/app'))
        self.assertIsNone(pl.parse_remote('https://example.org/x/y'))

    def test_status_maps(self):
        self.assertEqual(pl.gh_status('completed', 'timed_out'), 'failed')
        self.assertEqual(pl.gh_status('completed', 'cancelled'), 'cancelled')
        self.assertEqual(pl.gh_status('in_progress', None), 'running')
        self.assertEqual(pl.gh_status('queued', None), 'queued')
        self.assertEqual(pl.gl_status('canceled'), 'cancelled')
        self.assertEqual(pl.gl_status('created'), 'queued')
        self.assertEqual(pl.gl_status('manual'), 'skipped')


class EstimatorTest(unittest.TestCase):
    """ETA from the median of the same job's past successful runs; invented history only."""

    def run_(self, jobs, status='running', created=None):
        return {'slug': 'g/app', 'status': status, 'created': created or ago(10), 'jobs': jobs}

    def test_median(self):
        self.assertEqual(pl.median([3, 1, 2]), 2)
        self.assertEqual(pl.median([4, 1, 2, 3]), 2.5)
        self.assertIsNone(pl.median([]))

    def test_running_job_uses_its_start_plus_median(self):
        hist = {'g/app|build': [[3, 100], [2, 120], [1, 140]], 'g/app|test': [[3, 300], [2, 240], [1, 360], [0, 9999]]}
        r = self.run_([
            {'name': 'build', 'stage': 'build', 'status': 'success', 'finished': ago(5)},
            {'name': 'test', 'stage': 'test', 'status': 'running', 'started': ago(2)},
        ])
        e = pl.estimate(r, hist, [], 0, NOW)
        self.assertEqual(e['basis'], 'jobs')
        self.assertEqual(e['samples'], 4)
        # test started 2 min ago, median of (300, 240, 360, 9999) = 330 s -> ends 3.5 min from now
        self.assertEqual(e['eta'], z(NOW - dt.timedelta(minutes=2) + dt.timedelta(seconds=330)))
        self.assertEqual(e['jobs']['test']['median_s'], 330)

    def test_later_stage_waits_for_previous_stage_and_queue(self):
        hist = {'g/app|build': [[1, 60], [2, 60], [3, 60]], 'g/app|deploy': [[1, 30], [2, 30], [3, 30]]}
        r = self.run_([
            {'name': 'build', 'stage': 'build', 'status': 'running', 'started': ago(0)},
            {'name': 'deploy', 'stage': 'deploy', 'status': 'queued'},
        ])
        e = pl.estimate(r, hist, [], 20, NOW)
        # build ends now+60; deploy starts after it plus 20 s queue wait, then 30 s
        self.assertEqual(e['jobs']['deploy']['start'], z(NOW + dt.timedelta(seconds=80)))
        self.assertEqual(e['eta'], z(NOW + dt.timedelta(seconds=110)))

    def test_overrun_job_ends_now_not_in_the_past(self):
        hist = {'g/app|t': [[1, 10], [2, 10], [3, 10]]}
        e = pl.estimate(self.run_([{'name': 't', 'stage': 's', 'status': 'running', 'started': ago(30)}]), hist, [], 0, NOW)
        self.assertEqual(e['eta'], z(NOW))

    def test_not_enough_history_falls_back_to_pipeline_median_then_says_so(self):
        hist = {'g/app|t': [[1, 10], [2, 10]]}  # 2 samples < 3
        r = self.run_([{'name': 't', 'stage': 's', 'status': 'running', 'started': ago(1)}], created=ago(4))
        e = pl.estimate(r, hist, [600, 300, 420], 0, NOW)
        self.assertEqual((e['basis'], e['samples']), ('pipeline', 3))
        self.assertEqual(e['eta'], z(NOW - dt.timedelta(minutes=4) + dt.timedelta(seconds=420)))
        e = pl.estimate(r, hist, [600], 0, NOW)
        self.assertIsNone(e['eta'])
        self.assertEqual(e['reason'], "pas assez d'historique")
        self.assertEqual(e['jobs']['t']['n'], 2)

    def test_finished_pipeline_has_no_estimate(self):
        self.assertIsNone(pl.estimate(self.run_([], status='success'), {}, [1, 2, 3], 0, NOW))

    def test_history_keeps_successes_only_without_duplicates(self):
        runs = [{'slug': 'g/app', 'jobs': [{'id': 5, 'name': 't', 'status': 'success', 'duration_s': 50},
                                           {'id': 6, 'name': 't', 'status': 'failed', 'duration_s': 2}]}]
        h = pl.merge_history({'g/app|t': [[4, 40]]}, runs)
        h = pl.merge_history(h, runs)
        self.assertEqual(h['g/app|t'], [[5, 50], [4, 40]])

    def test_queue_wait_needs_three_samples(self):
        runs = [{'backend': 'gitlab-local', 'jobs': [{'queued_s': 10}, {'queued_s': 30}]}]
        self.assertEqual(pl.queue_wait(runs, 'gitlab-local'), (None, 2))
        runs[0]['jobs'].append({'queued_s': 20})
        self.assertEqual(pl.queue_wait(runs, 'gitlab-local'), (20, 3))


class ConversationTest(Base):
    def test_pr_create_output_maps_to_the_session(self):
        tid = 'toolu_01'
        self.transcript('C--code-app-one', 'sess-aaa', [
            {'type': 'custom-title', 'customTitle': 'LINT FIX lane', 'sessionId': 'sess-aaa'},
            {'type': 'assistant', 'gitBranch': 'claude/fix-lint', 'message': {'content': [
                {'type': 'tool_use', 'id': tid, 'name': 'Bash', 'input': {'command': 'gh pr create --title "Fix lint" --body x'}}]}},
            {'type': 'user', 'message': {'content': [
                {'type': 'tool_result', 'tool_use_id': tid, 'content': 'https://github.com/acme/app-one/pull/42\n'}]}},
        ])
        self.transcript('C--code-app-two', 'sess-bbb', [
            {'type': 'assistant', 'gitBranch': 'main', 'message': {'content': [
                {'type': 'tool_use', 'id': 't2', 'name': 'Bash', 'input': {'command': 'glab mr create --source-branch claude/feature-x -t y'}}]}},
            {'type': 'user', 'message': {'content': [
                {'type': 'tool_result', 'tool_use_id': 't2', 'content': [{'type': 'text', 'text': 'https://gitlab.com/mirrors/app-two/-/merge_requests/7'}]}]}},
        ])
        self.transcript('C--code-other', 'sess-ccc', [{'type': 'user', 'message': {'content': 'hello'}}])
        p = pl.settings(self.cfg)
        convs = pl.conversations(p, ci.expand, ci.read_json, ci.write_json)
        by = {c['session']: c for c in convs}
        self.assertEqual(sorted(by), ['sess-aaa', 'sess-bbb'])
        self.assertEqual(by['sess-aaa']['title'], 'LINT FIX lane')
        self.assertEqual(by['sess-aaa']['prs'][0], {'forge': 'github', 'repo': 'acme/app-one', 'number': 42,
                                                    'url': 'https://github.com/acme/app-one/pull/42', 'branch': 'claude/fix-lint'})
        self.assertEqual(by['sess-bbb']['prs'][0]['branch'], 'claude/feature-x')  # --source-branch wins over gitBranch
        self.assertEqual(by['sess-bbb']['prs'][0]['number'], 7)
        # cached: a second pass reads nothing new and gives the same answer
        again = pl.conversations(p, ci.expand, ci.read_json, ci.write_json)
        self.assertEqual(len(again), 2)


class CollectTest(Base):
    def test_full_model_from_invented_forges(self):
        self.transcript('C--code-app-one', 'sess-aaa', [
            {'type': 'custom-title', 'customTitle': 'LINT FIX lane'},
            {'type': 'assistant', 'gitBranch': 'claude/fix-lint', 'message': {'content': [
                {'type': 'tool_use', 'id': 'x1', 'input': {'command': 'gh pr create -t a -b b'}}]}},
            {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'x1',
                                                       'content': 'https://github.com/acme/app-one/pull/42'}]}},
        ])
        status = {'gitlab-local': {'jobs': {'running': 6, 'pending': 1}, 'runners': {'online': 1}}}
        fake = self.world()
        m = pl.collect(self.cfg, {}, status, fake, self.helpers, refresh=True, now=NOW)
        apps = {a['app']: a for a in m['apps']}
        self.assertEqual(sorted(apps), ['app-one', 'app-two'])
        self.assertEqual(apps['app-two']['gitlab'], ['gitlab.com/mirrors/app-two'])
        one = {r['id']: r for r in apps['app-one']['runs']}
        self.assertEqual(one[11]['who'], 'claude')
        self.assertEqual(one[11]['conv']['title'], 'LINT FIX lane')
        self.assertEqual(one[11]['jobs'][0]['name'], 'lint')
        self.assertEqual(one[11]['jobs'][0]['status'], 'failed')
        self.assertEqual(one[10]['who'], 'codex')
        self.assertEqual(one[9]['who'], 'claude')  # trailer in the local commit
        self.assertEqual(one[11]['backend'], 'github-hosted')
        two = {r['id']: r for r in apps['app-two']['runs']}
        self.assertEqual(two[501]['backend'], 'gitlab-local')
        self.assertEqual(two[501]['status'], 'running')
        self.assertEqual(two[499]['mr'], 7)
        self.assertEqual(two[499]['backend'], 'gitlab-local')  # no jobs read: host of this project's other pipelines
        self.assertTrue(two[499]['host_inferred'])
        self.assertEqual(two[500]['who'], 'unknown')  # plain commit on main: never guessed
        self.assertEqual(two[500]['duration_s'], 480)  # first job start (119 min ago) -> last job end (111 min ago)
        # running pipeline: build history has 1 sample, so the lane's pipeline median is not enough either
        self.assertIsNone(two[501]['estimate']['eta'])
        s = m['summary']
        self.assertEqual(s['today']['runs'], 5)
        self.assertEqual(s['week']['runs'], 6)
        self.assertEqual(s['queue']['running'], 6)
        self.assertEqual(s['queue']['concurrent'], 18)
        self.assertEqual(s['queue']['wait_n'], 4)
        self.assertEqual(s['queue']['wait_s'], 60)
        self.assertEqual({x['key'] for x in s['by_who']}, {'claude', 'codex', 'unknown'})
        self.assertEqual(m['conversations'][0]['id'], 'sess-aaa')
        self.assertNotIn('history', m)
        self.assertEqual(m['labels']['tab_diagram'], 'Diagramme')
        # no write calls, ever: only list/view/api GET and git remote/log
        for argv in fake.calls:
            self.assertIn(argv[0], ('gh', 'glab', 'git'))
            if argv[0] == 'gh':
                self.assertIn(argv[1:3], (['run', 'list'], ['run', 'view']))
            if argv[0] == 'glab':
                self.assertEqual(argv[1], 'api')
                self.assertNotIn('-X', argv)
            if argv[0] == 'git':
                self.assertIn(argv[3], ('remote', 'log'))
        # the cache keeps the job history; the next read is from cache, no call
        with open(self.cfg['pipelines']['pipelines_cache'], encoding='utf8') as f:
            cached = json.load(f)
        self.assertIn('acme/app-one|lint', cached['history'])
        n = len(fake.calls)
        again = pl.collect(self.cfg, {}, status, fake, self.helpers, now=NOW + dt.timedelta(minutes=1))
        self.assertEqual(len(fake.calls), n)
        self.assertFalse(again['stale'])
        self.assertEqual(len(again['apps']), 2)
        # past cache_minutes, --check refetches
        later = pl.collect(self.cfg, {}, status, fake, self.helpers, check=True, now=NOW + dt.timedelta(hours=1))
        self.assertGreater(len(fake.calls), n)
        self.assertFalse(later['stale'])

    def test_missing_tools_leave_apps_unread_not_an_error(self):
        fake = Fake(remotes={'/code/app-one': [('origin', 'https://github.com/acme/app-one.git')]})
        m = pl.collect(self.cfg, {}, {}, fake, self.helpers, refresh=True, now=NOW)
        self.assertEqual([(a['app'], a['fetched'], a['runs']) for a in m['apps']], [('app-one', False, [])])
        self.assertEqual(m['summary']['week']['runs'], 0)

    def test_no_cache_yet_is_stale_and_empty(self):
        m = pl.collect(self.cfg, {}, {}, Fake(), self.helpers, now=NOW)
        self.assertTrue(m['stale'])
        self.assertIsNone(m['generated'])

    def test_no_token_value_in_output_or_cache(self):
        os.environ['GITLAB_TOKEN_TEST_ONLY'] = SECRET
        try:
            m = pl.collect(self.cfg, {}, {}, self.world(), self.helpers, refresh=True, now=NOW)
        finally:
            del os.environ['GITLAB_TOKEN_TEST_ONLY']
        self.assertNotIn(SECRET, json.dumps(m))
        with open(self.cfg['pipelines']['pipelines_cache'], encoding='utf8') as f:
            self.assertNotIn(SECRET, f.read())

    def test_cli_pipelines_reads_cache(self):
        out = ci.pipelines_view(self.cfg, run_fn=Fake(), now=NOW)
        self.assertTrue(out['stale'])


if __name__ == '__main__':
    unittest.main()
