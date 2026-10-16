"""Pipeline diagram data for the ci mod: repo/app -> CI host -> stages/jobs -> result, last N runs, who made them.

    python -I ci.py pipelines [--refresh] [--check]     JSON for the « Diagramme » view

Read-only: `gh run list` / `gh run view --json jobs` for GitHub repos, `glab api` (GET) for GitLab projects and
mirrors, `git log -1` in the local clone for the commit trailer, and the local transcripts under
~/.claude/projects/*/*.jsonl to tie a PR/MR or branch to the conversation that opened it. Its only writes are its
two caches (pipelines_cache, conversations_cache). No token value is read or printed: gh and glab hold their own.
Missing tools, repos or network leave a run out or a field "unknown", never an error. Standard library only.
"""
import concurrent.futures as _cf
import datetime as _dt
import glob
import json
import os
import re
import urllib.parse

CLAUDE, CODEX, UNKNOWN = 'claude', 'codex', 'unknown'
OK, FAILED, RUNNING, QUEUED, CANCELLED, SKIPPED = 'success', 'failed', 'running', 'queued', 'cancelled', 'skipped'

DEFAULTS = {
    'roots': [],
    'max_depth': 2,
    'repos': [],
    'runs_per_repo': 15,
    'jobs_runs': 3,
    'concurrency': 8,
    'projects_dir': '~/.claude/projects',
    'pipelines_cache': '~/.claude/ci-pipelines-cache.json',
    'conversations_cache': '~/.claude/ci-conversations-cache.json',
    'github_backend': 'github-hosted',
    'gitlab_hosts': ['gitlab.com'],
    'attribution': {
        'claude_branches': ['claude/', 'worktree-agent-'],
        'codex_branches': ['codex/'],
        'claude_trailer': r'co-authored-by:\s*claude',
        'codex_trailer': r'co-authored-by:[^\n]*codex',
        'codex_authors': ['codex', 'chatgpt-codex-connector'],
    },
}


def settings(cfg):
    p = dict(DEFAULTS)
    p.update(cfg.get('pipelines') or {})
    att = dict(DEFAULTS['attribution'])
    att.update((cfg.get('pipelines') or {}).get('attribution') or {})
    p['attribution'] = att
    return p


def parse_time(s):
    if not s:
        return None
    try:
        return _dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except ValueError:
        return None


def seconds(a, b):
    ta, tb = parse_time(a), parse_time(b)
    if not ta or not tb:
        return None
    return max(0, int((tb - ta).total_seconds()))


# ------------------------------------------------------------------ attribution

def classify(branch, message='', author='', att=None):
    """'claude', 'codex' or 'unknown' from the branch name, the commit trailer and the author. Never a guess."""
    att = att or DEFAULTS['attribution']
    b = (branch or '').lower()
    msg = message or ''
    if any(b.startswith(p) for p in att['claude_branches']) or re.search(att['claude_trailer'], msg, re.I):
        return CLAUDE
    a = (author or '').lower()
    if any(b.startswith(p) for p in att['codex_branches']) or re.search(att['codex_trailer'], msg, re.I) \
            or any(x and x in a for x in att['codex_authors']):
        return CODEX
    return UNKNOWN


# ------------------------------------------------------------------ status mapping

def gh_status(status, conclusion):
    s, c = (status or '').lower(), (conclusion or '').lower()
    if s == 'completed':
        if c == 'success':
            return OK
        if c in ('cancelled',):
            return CANCELLED
        if c in ('skipped', 'neutral', 'stale'):
            return SKIPPED
        return FAILED
    if s == 'in_progress':
        return RUNNING
    return QUEUED


def gl_status(status):
    s = (status or '').lower()
    return {'success': OK, 'failed': FAILED, 'running': RUNNING, 'canceled': CANCELLED, 'cancelled': CANCELLED,
            'skipped': SKIPPED, 'manual': SKIPPED}.get(s, QUEUED)


# ------------------------------------------------------------------ repos

def parse_remote(url, gitlab_hosts=('gitlab.com',)):
    """('github', 'owner/name') or ('gitlab:<host>', 'group/sub/name') or None, from https or ssh remotes."""
    u = (url or '').strip()
    m = re.match(r'^(?:https?://(?:[^@/]+@)?|ssh://(?:[^@/]+@)?|[^@/\s]+@)([^/:]+)[:/](.+?)(?:\.git)?/?$', u)
    if not m:
        return None
    host, path = m.group(1).lower(), m.group(2)
    if host == 'github.com':
        return 'github', path
    if host in [h.lower() for h in gitlab_hosts]:
        return f'gitlab:{host}', path
    return None


def repo_remotes(path, run):
    """The remote URLs of a local clone; none when git fails."""
    code, out = run(['git', '-C', path, 'remote', '-v'])
    if code != 0:
        return []
    urls = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1] not in urls:
            urls.append(parts[1])
    return urls


def find_git_dirs(root, depth):
    out = []
    root = os.path.expanduser(root)
    if not os.path.isdir(root):
        return out

    def walk(d, left):
        if os.path.exists(os.path.join(d, '.git')):
            out.append(d.replace('\\', '/'))
            return
        if left <= 0:
            return
        try:
            names = sorted(os.listdir(d))
        except OSError:
            return
        for n in names:
            if n.startswith('.') or n in ('node_modules', '_archive'):
                continue
            p = os.path.join(d, n)
            if os.path.isdir(p):
                walk(p, left - 1)

    walk(root, depth)
    return out


def discover(cfg, routes, run, is_placeholder):
    """Apps to draw: repos named in pipelines.repos, git clones under pipelines.roots, and repos with a ci route.
    One app per GitHub slug (or first GitLab slug); copies and worktrees of the same remote count once."""
    p = settings(cfg)
    paths = []
    for r in p['repos']:
        if isinstance(r, str) and not is_placeholder(r):
            paths.append(os.path.expanduser(r))
    for root in p['roots']:
        if not is_placeholder(root):
            paths += find_git_dirs(root, p['max_depth'])
    paths += [k for k, r in routes.items() if r.get('kind') == 'repo']
    apps = {}
    for path in paths:
        github, gitlab = None, []
        for url in repo_remotes(path, run):
            got = parse_remote(url, p['gitlab_hosts'])
            if not got:
                continue
            if got[0] == 'github' and not github:
                github = got[1]
            elif got[0].startswith('gitlab:') and (got[0][7:], got[1]) not in gitlab:
                gitlab.append((got[0][7:], got[1]))
        if not github and not gitlab:
            continue
        key = (github or f'{gitlab[0][0]}/{gitlab[0][1]}').lower()
        app = apps.setdefault(key, {'app': (github or gitlab[0][1]).split('/')[-1], 'path': path.replace('\\', '/'),
                                    'github': github, 'gitlab': []})
        for g in gitlab:
            if g not in [tuple(x) for x in app['gitlab']]:
                app['gitlab'].append(list(g))
    for r in p['repos']:  # {"github": "o/n"} or {"gitlab": "g/n", "host": ...} without a local clone
        if isinstance(r, dict):
            gh = r.get('github')
            gl = [[r.get('host', 'gitlab.com'), r['gitlab']]] if r.get('gitlab') else []
            key = (gh or f'{gl[0][0]}/{gl[0][1]}' if (gh or gl) else '').lower()
            if key and key not in apps:
                apps[key] = {'app': r.get('app') or (gh or gl[0][1]).split('/')[-1], 'path': '', 'github': gh, 'gitlab': gl}
    return sorted(apps.values(), key=lambda a: a['app'].lower())


# ------------------------------------------------------------------ forges

def backend_for_jobs(cfg, jobs):
    """The ci backend a GitLab pipeline ran on: the backend whose runner_tag the jobs carry, else the shared one."""
    tags = {t for j in jobs or [] for t in (j.get('tag_list') or [])}
    gitlab = [b for b in cfg['backends'] if b.get('kind') == 'gitlab']
    for b in gitlab:
        if b.get('runner_tag') and b['runner_tag'] in tags:
            return b['id']
    shared = any((j.get('runner') or {}).get('is_shared') for j in jobs or [])
    if shared or (jobs and not tags):
        for b in gitlab:
            if not b.get('runner_tag'):
                return b['id']
    return 'gitlab'


def github_runs(app, p, run):
    slug = app['github']
    code, out = run(['gh', 'run', 'list', '-R', slug, '--limit', str(p['runs_per_repo']), '--json',
                     'databaseId,status,conclusion,headBranch,headSha,createdAt,updatedAt,startedAt,event,'
                     'workflowName,displayTitle,url'])
    if code != 0:
        return None
    try:
        rows = json.loads(out or '[]')
    except ValueError:
        return None
    runs = []
    for i, r in enumerate(rows):
        status = gh_status(r.get('status'), r.get('conclusion'))
        jobs = None
        if i < p['jobs_runs']:
            c2, o2 = run(['gh', 'run', 'view', str(r.get('databaseId')), '-R', slug, '--json', 'jobs'])
            o2 = o2 if c2 == 0 else ''
            if c2 == 0:
                try:
                    jobs = []
                    for j in json.loads(o2 or '{}').get('jobs', []):
                        js = gh_status(j.get('status'), j.get('conclusion'))
                        started = j.get('startedAt') if js != QUEUED else None
                        finished = j.get('completedAt') if js in (OK, FAILED, CANCELLED, SKIPPED) else None
                        jobs.append({'id': j.get('databaseId'), 'name': j.get('name', '?'),
                                     'stage': r.get('workflowName') or 'jobs', 'status': js,
                                     'duration_s': seconds(started, finished), 'queued_s': None,
                                     'created': None, 'started': started, 'finished': finished,
                                     'url': j.get('url', ''), 'allow_failure': False})
                except ValueError:
                    jobs = None
        runs.append({
            'forge': 'github', 'slug': slug, 'backend': p['github_backend'], 'id': r.get('databaseId'),
            'url': r.get('url', ''), 'branch': r.get('headBranch') or '', 'sha': r.get('headSha') or '',
            'event': r.get('event') or '', 'title': (r.get('displayTitle') or '')[:120],
            'workflow': r.get('workflowName') or '', 'status': status, 'created': r.get('createdAt'),
            'duration_s': seconds(r.get('startedAt') or r.get('createdAt'), r.get('updatedAt'))
            if status in (OK, FAILED, CANCELLED, SKIPPED) else None,
            'queued_s': seconds(r.get('createdAt'), r.get('startedAt')), 'jobs': jobs, 'mr': None,
        })
    return runs


def gitlab_runs(cfg, app, host, slug, p, run):
    enc = urllib.parse.quote(slug, safe='')
    code, out = run(['glab', 'api', '--hostname', host, f"projects/{enc}/pipelines?per_page={p['runs_per_repo']}"])
    if code != 0:
        return None
    try:
        rows = json.loads(out or '[]')
    except ValueError:
        return None
    if not isinstance(rows, list):
        return None
    runs = []
    for i, r in enumerate(rows):
        status = gl_status(r.get('status'))
        jobs, raw = None, None
        if i < p['jobs_runs']:
            c2, o2 = run(['glab', 'api', '--hostname', host, f"projects/{enc}/pipelines/{r.get('id')}/jobs?per_page=100"])
            if c2 == 0:
                try:
                    raw = json.loads(o2 or '[]')
                    raw = raw if isinstance(raw, list) else None
                except ValueError:
                    raw = None
        if raw is not None:
            num = (lambda v: int(v) if isinstance(v, (int, float)) else None)
            jobs = [{'id': j.get('id'), 'name': j.get('name', '?'), 'stage': j.get('stage') or 'test',
                     'status': gl_status(j.get('status')), 'duration_s': num(j.get('duration')),
                     'queued_s': num(j.get('queued_duration')), 'created': j.get('created_at'),
                     'started': j.get('started_at'), 'finished': j.get('finished_at'),
                     'url': j.get('web_url', ''), 'allow_failure': bool(j.get('allow_failure'))}
                    for j in sorted(raw, key=lambda j: j.get('id') or 0)]
        ref = r.get('ref') or ''
        m = re.match(r'refs/merge-requests/(\d+)/', ref)
        done = status in (OK, FAILED, CANCELLED, SKIPPED)
        dur = None
        if raw:
            starts = [j.get('started_at') for j in raw if j.get('started_at')]
            ends = [j.get('finished_at') for j in raw if j.get('finished_at')]
            if starts and ends and done:
                dur = seconds(min(starts), max(ends))
        if dur is None and done:
            dur = seconds(r.get('created_at'), r.get('updated_at'))
        runs.append({
            'forge': 'gitlab', 'slug': slug, 'host': host,
            'backend': backend_for_jobs(cfg, raw) if raw else None, 'id': r.get('id'),
            'url': r.get('web_url', ''), 'branch': '' if m else ref, 'sha': r.get('sha') or '',
            'event': r.get('source') or '', 'title': '', 'workflow': '', 'status': status,
            'created': r.get('created_at'), 'duration_s': dur, 'queued_s': None, 'jobs': jobs,
            'mr': int(m.group(1)) if m else None,
        })
    # Jobs are read for the newest jobs_runs pipelines only; the older ones take the host those jobs ran on,
    # marked host_inferred so the view can say so. No jobs read at all: the host stays 'gitlab' (unknown runner).
    seen = [r['backend'] for r in runs if r['backend']]
    common = max(set(seen), key=seen.count) if seen else None
    for r in runs:
        if not r['backend']:
            r['backend'] = common or 'gitlab'
            r['host_inferred'] = bool(common)
    return runs


def commit_info(path, sha, run):
    if not path or not sha:
        return '', ''
    code, out = run(['git', '-C', path, 'log', '-1', '--format=%an%x00%B', sha])
    if code != 0 or '\x00' not in out:
        return '', ''
    author, msg = out.split('\x00', 1)
    return author.strip(), msg


# ------------------------------------------------------------------ conversations (read-only, cached)

PR_URL = re.compile(r'https://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)')
MR_URL = re.compile(r'https://([\w.-]+)/([\w.-]+(?:/[\w.-]+)+?)/-/merge_requests/(\d+)')
CREATE = re.compile(r'\b(gh\s+pr\s+create|glab\s+mr\s+create)\b')
HEAD = re.compile(r'(?:--head|-H|--source-branch|-s)[\s=]+["\']?([\w./-]+)')


def _text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return '\n'.join(_text(c.get('text') if isinstance(c, dict) else c) for c in content)
    return ''


def scan_transcript(path):
    """{session, title, project, prs: [{repo, number, url, branch, forge}]} of one transcript file."""
    res = {'session': os.path.splitext(os.path.basename(path))[0], 'title': '',
           'project': os.path.basename(os.path.dirname(path)), 'prs': []}
    pending = {}  # tool_use id -> branch
    try:
        f = open(path, encoding='utf8', errors='replace')
    except OSError:
        return res
    with f:
        for line in f:
            quick = ('title' in line) or ('pr create' in line) or ('mr create' in line) or (pending and 'tool_result' in line)
            if not quick:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if not isinstance(d, dict):
                continue
            t = d.get('type')
            if t == 'custom-title' and d.get('customTitle'):
                res['title'] = str(d['customTitle'])[:120]
                continue
            if t == 'ai-title' and d.get('aiTitle') and not res['title']:
                res['title'] = str(d['aiTitle'])[:120]
                continue
            content = (d.get('message') or {}).get('content') if isinstance(d.get('message'), dict) else None
            if not isinstance(content, list):
                continue
            for c in content:
                if not isinstance(c, dict):
                    continue
                if c.get('type') == 'tool_use':
                    cmd = str((c.get('input') or {}).get('command') or '')
                    if CREATE.search(cmd):
                        h = HEAD.search(cmd)
                        pending[c.get('id')] = h.group(1) if h else (d.get('gitBranch') or '')
                elif c.get('type') == 'tool_result' and c.get('tool_use_id') in pending:
                    branch = pending.pop(c['tool_use_id'])
                    out = _text(c.get('content'))
                    for m in PR_URL.finditer(out):
                        res['prs'].append({'forge': 'github', 'repo': m.group(1).lower(), 'number': int(m.group(2)),
                                           'url': m.group(0), 'branch': branch})
                    for m in MR_URL.finditer(out):
                        if m.group(1) == 'github.com':
                            continue
                        res['prs'].append({'forge': 'gitlab', 'repo': m.group(2).lower(), 'number': int(m.group(3)),
                                           'url': m.group(0), 'branch': branch})
    return res


def conversations(p, expand, read_json, write_json):
    """Every transcript that opened a PR/MR, re-read only when its size or mtime changed."""
    cache_file = p['conversations_cache']
    cache = read_json(cache_file, {})
    files = cache.get('files') if isinstance(cache, dict) and isinstance(cache.get('files'), dict) else {}
    out, seen = {}, set()
    for path in glob.glob(os.path.join(expand(p['projects_dir']), '*', '*.jsonl')):
        try:
            st = os.stat(path)
        except OSError:
            continue
        key = path.replace('\\', '/')
        seen.add(key)
        sig = [st.st_size, int(st.st_mtime)]
        hit = files.get(key)
        if not hit or hit.get('sig') != sig:
            hit = {'sig': sig, **scan_transcript(path)}
            files[key] = hit
        if hit.get('prs'):
            out[key] = hit
    files = {k: v for k, v in files.items() if k in seen}
    try:
        write_json(cache_file, {'version': 1, 'files': files})
    except OSError:
        pass
    return list(out.values())


def conv_index(convs):
    by_pr, by_branch = {}, {}
    for c in convs:
        ref = {'id': c['session'], 'title': c.get('title') or '', 'project': c.get('project') or ''}
        for pr in c['prs']:
            by_pr[(pr['forge'], pr['repo'], pr['number'])] = {**ref, 'pr': pr['url']}
            if pr.get('branch') and pr['branch'] not in ('main', 'master'):
                by_branch[(pr['repo'], pr['branch'])] = {**ref, 'pr': pr['url']}
    return by_pr, by_branch


def conv_for(run, app, by_pr, by_branch):
    slugs = ([app['github'].lower()] if app.get('github') else []) + [g[1].lower() for g in app.get('gitlab', [])]
    if run.get('mr') is not None:
        hit = by_pr.get(('gitlab', run['slug'].lower(), run['mr']))
        if hit:
            return hit
    for s in slugs:
        hit = by_branch.get((s, run.get('branch') or ''))
        if hit:
            return hit
    return None


# ------------------------------------------------------------------ estimates (median of past runs, never a guess)

MIN_SAMPLES = 3
HISTORY_KEEP = 20


def median(xs):
    s = sorted(x for x in xs if x is not None)
    if not s:
        return None
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def iso(t):
    return t.astimezone(_dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z') if t else None


def job_key(run, job):
    return f"{run.get('slug', '')}|{job.get('name', '')}"


def merge_history(old, runs, keep=HISTORY_KEEP):
    """{slug|job: [[job id, seconds], ...]} of successful jobs, newest ids first, kept across refreshes (cache)."""
    hist = {k: [list(x) for x in v] for k, v in (old or {}).items() if isinstance(v, list)}
    for r in runs:
        for j in r.get('jobs') or []:
            if j.get('status') != OK or j.get('duration_s') is None or j.get('id') is None:
                continue
            lst = hist.setdefault(job_key(r, j), [])
            if j['id'] not in [x[0] for x in lst]:
                lst.append([j['id'], j['duration_s']])
    for k in hist:
        hist[k] = sorted(hist[k], key=lambda x: str(x[0]).zfill(20), reverse=True)[:keep]
    return hist


def queue_wait(runs, backend):
    """Median runner queue wait (s) of recent jobs on this backend, with its sample size."""
    xs = [j.get('queued_s') for r in runs if r.get('backend') == backend for j in (r.get('jobs') or [])
          if j.get('queued_s') is not None]
    return (median(xs) if len(xs) >= MIN_SAMPLES else None), len(xs)


def estimate(run, history, pipeline_durations, wait_s, now):
    """ETA of a running or queued pipeline.

    Per job: the median of the last successful runs of the same job (>= MIN_SAMPLES), started at its real start,
    or for a job not started yet at the end of the previous stage (or now) plus the runner queue wait. The
    pipeline ends when its last stage does. Without enough job history, the median duration of the lane's
    last finished pipelines (>= MIN_SAMPLES). Otherwise no ETA: « pas assez d'historique ».
    The samples go along (samples_s per job, durations_s per pipeline) so the view recomputes the same median with
    lib/core/estimate.mjs, the one estimate rule shared with factory's Workflow screen."""
    if run.get('status') not in (RUNNING, QUEUED):
        return None
    jobs = run.get('jobs') or []
    created = parse_time(run.get('created')) or now
    est_jobs, enough, samples = {}, bool(jobs), []
    stages = []
    for j in jobs:
        if j.get('stage') not in stages:
            stages.append(j.get('stage'))
    prev_end = created
    for st in stages:
        stage_end = prev_end
        for j in [x for x in jobs if x.get('stage') == st]:
            status = j.get('status')
            if status in (OK, FAILED, CANCELLED, SKIPPED):
                end = parse_time(j.get('finished'))
                if end:
                    stage_end = max(stage_end, end)
                continue
            hist = [d for _, d in history.get(job_key(run, j), [])]
            if len(hist) < MIN_SAMPLES:
                enough = False
                est_jobs[j.get('name')] = {'n': len(hist), 'median_s': None, 'start': None, 'end': None, 'samples_s': hist}
                continue
            med = median(hist)
            started = parse_time(j.get('started')) if status == RUNNING else None
            start = started or (max(now, prev_end) + _dt.timedelta(seconds=wait_s or 0))
            end = max(start + _dt.timedelta(seconds=med), now)
            samples.append(len(hist))
            est_jobs[j.get('name')] = {'n': len(hist), 'median_s': med, 'start': iso(start), 'end': iso(end), 'samples_s': hist}
            stage_end = max(stage_end, end)
        prev_end = stage_end
    if enough and samples:
        return {'eta': iso(max(prev_end, now)), 'basis': 'jobs', 'samples': min(samples), 'jobs': est_jobs}
    durs = [d for d in pipeline_durations if d is not None]
    if len(durs) >= MIN_SAMPLES:
        eta = max(created + _dt.timedelta(seconds=median(durs)), now)
        return {'eta': iso(eta), 'basis': 'pipeline', 'samples': len(durs), 'jobs': est_jobs, 'durations_s': durs}
    return {'eta': None, 'basis': None, 'samples': max([len(durs)] + [v['n'] for v in est_jobs.values()]),
            'jobs': est_jobs, 'reason': "pas assez d'historique", 'durations_s': durs}


# ------------------------------------------------------------------ model

def summarize(runs, now, tz_offset_min=0):
    day0 = (now + _dt.timedelta(minutes=tz_offset_min)).replace(hour=0, minute=0, second=0, microsecond=0) \
        - _dt.timedelta(minutes=tz_offset_min)
    week0 = now - _dt.timedelta(days=7)

    def stats(rs):
        done = [r for r in rs if r['status'] in (OK, FAILED)]
        ok = sum(1 for r in done if r['status'] == OK)
        return {'runs': len(rs), 'success': ok, 'failed': len(done) - ok,
                'running': sum(1 for r in rs if r['status'] in (RUNNING, QUEUED)),
                'pass_rate': round(100 * ok / len(done)) if done else None,
                'minutes': round(sum(r['duration_s'] or 0 for r in rs) / 60, 1)}

    def when(r):
        return parse_time(r.get('created'))

    today = [r for r in runs if when(r) and when(r) >= day0]
    week = [r for r in runs if when(r) and when(r) >= week0]
    group = {}
    for key in ('backend', 'who', 'app'):
        g = {}
        for r in week:
            g.setdefault(r.get(key) or UNKNOWN, []).append(r)
        group[key] = [{'key': k, **stats(v)} for k, v in sorted(g.items(), key=lambda kv: -len(kv[1]))]
    return {'today': stats(today), 'week': stats(week), 'by_host': group['backend'], 'by_who': group['who'],
            'by_app': group['app']}


def look(cfg):
    """Labels and colors from the config (the view has French defaults for anything left out)."""
    p = cfg.get('pipelines') or {}
    return {'labels': p.get('labels', {}), 'colors': p.get('colors', {}), 'svg_colors': p.get('svg_colors', {})}


def build(cfg, apps, fetched, convs, status_checks, now, run=None, history=None):
    """The JSON the Diagramme view draws. fetched: {app key: [runs] | None}; run: git runner for trailers;
    history: job durations kept from earlier refreshes (merged with this one's, returned under 'history')."""
    p = settings(cfg)
    by_pr, by_branch = conv_index(convs)
    all_runs, out_apps = [], []
    for app in apps:
        key = app['github'] or (f"{app['gitlab'][0][0]}/{app['gitlab'][0][1]}" if app['gitlab'] else app['app'])
        runs = fetched.get(key)
        rows = []
        for r in runs or []:
            r = dict(r)
            r['app'] = app['app']
            author, msg = r.pop('_author', ''), r.pop('_message', '')
            if not msg and run and app.get('path'):
                author, msg = commit_info(app['path'], r.get('sha'), run)
            conv = conv_for(r, app, by_pr, by_branch)
            r['conv'] = conv
            r['who'] = classify(r.get('branch'), msg, author, p['attribution'])
            if r['who'] == UNKNOWN and conv:
                r['who'] = CLAUDE  # opened by a Claude Code conversation (gh pr create / glab mr create seen)
                r['who_from'] = 'conversation'
            rows.append(r)
        rows.sort(key=lambda r: r.get('created') or '', reverse=True)
        all_runs += rows
        out_apps.append({'app': app['app'], 'path': app.get('path', ''), 'github': app['github'],
                         'gitlab': ['/'.join(g) for g in app['gitlab']], 'fetched': runs is not None, 'runs': rows})
    history = merge_history(history, all_runs)
    waits = {}
    for r in all_runs:
        if r['status'] not in (RUNNING, QUEUED):
            continue
        if r['backend'] not in waits:
            waits[r['backend']] = queue_wait(all_runs, r['backend'])
        durs = [x['duration_s'] for x in all_runs if x['app'] == r['app'] and x['backend'] == r['backend']
                and x['status'] == OK]
        r['estimate'] = estimate(r, history, durs, waits[r['backend']][0], now)
    queue = None
    for b in cfg['backends']:
        chk = status_checks.get(b['id']) or {}
        if b.get('kind') == 'gitlab' and b.get('runner_tag') and b.get('status', 'active') == 'active' \
                and not str(b['runner_tag']).startswith('<'):
            queued = sum(1 for r in all_runs if r['backend'] == b['id'] and r['status'] in (QUEUED, RUNNING))
            wait_s, wait_n = queue_wait(all_runs, b['id'])
            conc = b.get('concurrent')
            queue = {'backend': b['id'], 'label': b.get('label', b['id']), 'tag': b['runner_tag'],
                     'running': (chk.get('jobs') or {}).get('running'), 'pending': (chk.get('jobs') or {}).get('pending'),
                     'runners_online': (chk.get('runners') or {}).get('online'), 'pipelines_open': queued,
                     'concurrent': conc if isinstance(conc, int) else None, 'wait_s': wait_s, 'wait_n': wait_n}
            break
    convs_out = {}
    for r in all_runs:
        c = r.get('conv')
        if c:
            e = convs_out.setdefault(c['id'], {**{k: c[k] for k in ('id', 'title', 'project')}, 'runs': 0})
            e['runs'] += 1
    return {
        'generated': now.replace(microsecond=0).isoformat().replace('+00:00', 'Z'),
        'hosts': [{'id': b['id'], 'label': b.get('label', b['id']), 'kind': b.get('kind'), 'runner_tag': b.get('runner_tag', ''),
                   'status': b.get('status', 'active')} for b in cfg['backends']],
        **look(cfg),
        'summary': {**summarize(all_runs, now), 'queue': queue},
        'apps': out_apps,
        'conversations': sorted(convs_out.values(), key=lambda c: -c['runs']),
        'history': history,
    }


def collect(cfg, routes, status_checks, run, helpers, refresh=False, check=False, now=None):
    """Cached model; fetches from gh/glab only with refresh, or with check when the cache is older than cache_minutes."""
    p = settings(cfg)
    expand, read_json, write_json, is_placeholder = helpers
    now = now or _dt.datetime.now(_dt.timezone.utc)
    cache = read_json(p['pipelines_cache'], {})
    age = None
    if isinstance(cache, dict) and cache.get('generated'):
        g = parse_time(cache['generated'])
        age = (now - g).total_seconds() if g else None
    stale = age is None or age >= cfg.get('cache_minutes', 10) * 60
    if not refresh and not (check and stale):
        if isinstance(cache, dict) and cache.get('apps') is not None:
            return {**{k: v for k, v in cache.items() if k != 'history'}, **look(cfg), 'stale': stale}
        return {'generated': None, 'stale': True, 'hosts': [], **look(cfg), 'summary': None, 'apps': [],
                'conversations': []}
    apps = discover(cfg, routes, run, is_placeholder)

    def fetch(app):
        rows, ok = [], False
        if app['github']:
            got = github_runs(app, p, run)
            if got is not None:
                ok, rows = True, rows + got
        for host, slug in app['gitlab']:
            got = gitlab_runs(cfg, app, host, slug, p, run)
            if got is not None:
                ok, rows = True, rows + got
        return rows if ok else None

    fetched = {}
    with _cf.ThreadPoolExecutor(max_workers=max(1, int(p['concurrency']))) as pool:
        keys = [a['github'] or (f"{a['gitlab'][0][0]}/{a['gitlab'][0][1]}" if a['gitlab'] else a['app']) for a in apps]
        for k, rows in zip(keys, pool.map(fetch, apps)):
            fetched[k] = rows
    convs = conversations(p, expand, read_json, write_json)
    old = cache.get('history') if isinstance(cache, dict) else None
    model = build(cfg, apps, fetched, convs, status_checks, now, run, history=old)
    try:
        write_json(p['pipelines_cache'], model)
    except OSError:
        pass
    return {**{k: v for k, v in model.items() if k != 'history'}, 'stale': False}
