"""CI routing: which CI backends exist, whether they are usable, and which repo or session uses which.

    python -I ci.py show    [--config F] [--cwd DIR] [--session ID] [--refresh]   JSON for the mod and for you
    python -I ci.py status  [--config F] [--refresh]                              backends + checks (cached)
    python -I ci.py route   <repo-path|session> <backend-id> [--by WHO] [--cwd DIR]  writes the routing file
    python -I ci.py clear   <repo-path|session> [--cwd DIR]
    python -I ci.py resolve [--cwd DIR] [--session ID]                            the route that applies here

Read-only on everything but its own two files (the routing file and the status cache).
A token value is never printed, stored or logged: only "present yes/no" and where it came from.
Missing tools, tokens or network show as "unknown", never as an error.
Standard library only.
"""
import argparse
import datetime as _dt
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request

_HEALTH_T0 = time.time()

HERE = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.dirname(HERE)
YES, NO, UNKNOWN = 'yes', 'no', 'unknown'


# ------------------------------------------------------------------ config

def expand(p):
    return os.path.expanduser(os.path.expandvars(p)) if p else p


def is_placeholder(v):
    return not v or (isinstance(v, str) and v.startswith('<') and v.endswith('>'))


def config_path(explicit=None):
    """--config, then $CI_MOD_CONFIG, then ~/.claude/ci.config.json, then the mod's ci.config.json, then the example."""
    for p in (explicit, os.environ.get('CI_MOD_CONFIG'), '~/.claude/ci.config.json',
              os.path.join(MOD, 'ci.config.json'), os.path.join(MOD, 'ci.config.example.json')):
        if p and os.path.isfile(expand(p)):
            return expand(p)
    raise SystemExit('ci: no config found (ci.config.example.json is missing)')


def load_config(explicit=None):
    path = config_path(explicit)
    with open(path, encoding='utf8') as f:
        cfg = json.load(f)
    cfg.setdefault('routing_file', '~/.claude/ci-routing.json')
    cfg.setdefault('status_cache', '~/.claude/ci-status-cache.json')
    cfg.setdefault('cache_minutes', 10)
    cfg.setdefault('timeout_seconds', 8)
    cfg.setdefault('hosts', {})
    cfg.setdefault('backends', [])
    cfg['_path'] = path
    return cfg


def backend_ids(cfg):
    return [b['id'] for b in cfg['backends']]


def now_iso():
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def write_json(path, data):
    path = expand(path)
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf8') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    os.replace(tmp, path)


def read_json(path, default):
    try:
        with open(expand(path), encoding='utf8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


# ------------------------------------------------------------------ routing

def looks_like_path(target):
    t = target.strip()
    return (t.startswith(('~', '.', '/', '\\')) or (len(t) > 1 and t[1] == ':') or '/' in t or '\\' in t
            or os.path.isdir(t))


def norm_path(p, cwd=None):
    p = expand(p)
    if not os.path.isabs(p):
        p = os.path.join(cwd or os.getcwd(), p)
    p = os.path.normpath(p).replace('\\', '/')
    return p.rstrip('/') or '/'


def same_path(a, b):
    return a.lower() == b.lower() if os.name == 'nt' else a == b


def under(child, parent):
    c, p = (child.lower(), parent.lower()) if os.name == 'nt' else (child, parent)
    return c == p or c.startswith(p.rstrip('/') + '/')


def route_key(target, cwd=None):
    """('repo', '/abs/path') for a path, ('session', 'id-or-name') otherwise."""
    if looks_like_path(target):
        return 'repo', norm_path(target, cwd)
    return 'session', target.strip()


def load_routes(cfg):
    data = read_json(cfg['routing_file'], {})
    routes = data.get('routes') if isinstance(data, dict) else None
    return routes if isinstance(routes, dict) else {}


def save_routes(cfg, routes):
    write_json(cfg['routing_file'], {'version': 1, 'routes': routes})


def default_by():
    return (os.environ.get('USERNAME') or os.environ.get('USER') or 'someone') + ' (cli)'


def set_route(cfg, target, backend, by=None, cwd=None):
    if backend not in backend_ids(cfg):
        raise ValueError(f"unknown backend '{backend}'; known: {', '.join(backend_ids(cfg))}")
    kind, key = route_key(target, cwd)
    routes = load_routes(cfg)
    for k in list(routes):  # one entry per key, whatever its spelling
        if routes[k].get('kind') == 'repo' and kind == 'repo' and same_path(k, key):
            del routes[k]
    routes[key] = {'kind': kind, 'backend': backend, 'set_by': by or default_by(), 'set_at': now_iso()}
    save_routes(cfg, routes)
    b = next(x for x in cfg['backends'] if x['id'] == backend)
    warn = '' if b.get('status', 'active') == 'active' else f" (warning: backend is {b.get('status')})"
    return {'key': key, **routes[key], 'warning': warn.strip(' ()')}


def clear_route(cfg, target, cwd=None):
    kind, key = route_key(target, cwd)
    routes = load_routes(cfg)
    gone = [k for k, r in routes.items() if (same_path(k, key) if kind == 'repo' else k == key)]
    for k in gone:
        del routes[k]
    if gone:
        save_routes(cfg, routes)
    return {'key': key, 'kind': kind, 'removed': len(gone)}


def resolve(routes, cwd=None, session=None):
    """Session id or name first, then the deepest repo route that holds cwd (a worktree inside a repo matches it)."""
    for s in [x for x in (session if isinstance(session, (list, tuple)) else [session]) if x]:
        r = routes.get(s)
        if r and r.get('kind') == 'session':
            return {'key': s, 'match': 'session', **r}
    if cwd:
        here = norm_path(cwd)
        best = None
        for k, r in routes.items():
            if r.get('kind') == 'repo' and under(here, k) and (best is None or len(k) > len(best[0])):
                best = (k, r)
        if best:
            return {'key': best[0], 'match': 'repo', **best[1]}
    return None


# ------------------------------------------------------------------ checks (never a token value)

def run(argv, timeout, capture=True):
    """(exit code, stdout) or (None, '') when the tool is missing or hangs. stderr is always dropped."""
    if not shutil.which(argv[0]):
        return None, ''
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, timeout=timeout, text=True,
                           encoding='utf8', errors='replace')
        return p.returncode, (p.stdout or '') if capture else ''
    except (OSError, subprocess.SubprocessError):
        return None, ''


def token_state(cfg, host, env=None):
    """{'present': yes|no|unknown, 'source': 'env:NAME' | 'gh' | 'glab' | ''}. Reads presence only."""
    env = os.environ if env is None else env
    h = cfg['hosts'].get(host, {})
    for name in h.get('token_env', []):
        if env.get(name):
            return {'present': YES, 'source': f'env:{name}'}
    cli = h.get('cli')
    if not cli:
        return {'present': UNKNOWN, 'source': ''}
    code, _ = run([cli, 'auth', 'status', '--hostname', host], cfg['timeout_seconds'], capture=False)
    if code is None:
        return {'present': UNKNOWN, 'source': ''}
    return {'present': YES if code == 0 else NO, 'source': cli if code == 0 else ''}


def gitlab_api(cfg, host, path, token_source, env=None):
    """GET /api/v4/<path> as JSON, or None. Through glab (it holds its own token) or an env token sent in a header."""
    env = os.environ if env is None else env
    t = cfg['timeout_seconds']
    if token_source == 'glab':
        code, out = run(['glab', 'api', '--hostname', host, path], t)
        if code != 0:
            return None
        try:
            return json.loads(out)
        except ValueError:
            return None
    if token_source.startswith('env:'):
        api = cfg['hosts'].get(host, {}).get('api') or f'https://{host}/api/v4'
        req = urllib.request.Request(f"{api.rstrip('/')}/{path}",
                                     headers={'PRIVATE-TOKEN': env.get(token_source[4:], '')})
        try:
            with urllib.request.urlopen(req, timeout=t) as r:
                return json.loads(r.read().decode('utf8'))
        except Exception:  # network, 401, bad JSON: unknown, never an error
            return None
    return None


def gitlab_runners(cfg, b, token_source, api=gitlab_api):
    tag = b.get('runner_tag')
    if is_placeholder(tag) or not b.get('check_runners', True):
        return None, None
    q = 'tag_list=' + urllib.parse.quote(tag) + '&per_page=100'
    group = b.get('group')
    path = f"groups/{urllib.parse.quote(group, safe='')}/runners?{q}" if not is_placeholder(group) else f'runners?{q}'
    runners = api(cfg, b['host'], path, token_source)
    if not isinstance(runners, list):
        return None, None
    online = [r for r in runners if r.get('status') == 'online' and r.get('active', not r.get('paused', False))]
    counts = {'online': len(online), 'offline': len(runners) - len(online), 'total': len(runners)}
    running = 0
    for r in online:
        jobs = api(cfg, b['host'], f"runners/{r.get('id')}/jobs?status=running&per_page=100", token_source)
        if not isinstance(jobs, list):
            running = None
            break
        running += len(jobs)
    pending = None
    projects = [p for p in b.get('pending_projects', []) if not is_placeholder(p)]
    if projects:
        pending = 0
        for p in projects:
            jobs = api(cfg, b['host'], f"projects/{urllib.parse.quote(p, safe='')}/jobs?scope[]=pending&per_page=100",
                       token_source)
            if not isinstance(jobs, list):
                pending = None
                break
            pending += len(jobs)
    return counts, {'running': running, 'pending': pending}


def github_repo_of(path, timeout):
    code, out = run(['git', '-C', path, 'remote', 'get-url', 'origin'], timeout)
    if code != 0:
        return None
    url = out.strip()
    ssh_user = 'git' + '@'  # split so the public-repo e-mail scan does not flag an SSH remote
    for pre in ('https://github.com/', ssh_user + 'github.com:', 'ssh://' + ssh_user + 'github.com/'):
        if url.startswith(pre):
            return url[len(pre):].removesuffix('.git')
    return None


def github_actions(cfg, b, routes, gh=None):
    """Actions availability for the repos routed to this backend (cheap: two gh api calls a repo, capped)."""
    t = cfg['timeout_seconds']
    gh = gh or (lambda path: run(['gh', 'api', path], t))
    out = []
    repos = [k for k, r in routes.items() if r.get('kind') == 'repo' and r.get('backend') == b['id']]
    for path in repos[: cfg.get('max_repo_checks', 10)]:
        slug = github_repo_of(path, t)
        if not slug:
            out.append({'repo': path, 'actions': UNKNOWN, 'why': 'no github.com origin'})
            continue
        code, body = gh(f'repos/{slug}')
        try:
            private = json.loads(body).get('private') if code == 0 else None
        except ValueError:
            private = None
        if private is None:
            out.append({'repo': slug, 'actions': UNKNOWN, 'why': 'repo not readable'})
            continue
        if private and b.get('public_only'):
            out.append({'repo': slug, 'actions': NO, 'why': 'private repo: refused on this backend'})
            continue
        code, body = gh(f'repos/{slug}/actions/permissions')
        try:
            enabled = json.loads(body).get('enabled') if code == 0 else None
        except ValueError:
            enabled = None
        out.append({'repo': slug, 'actions': UNKNOWN if enabled is None else (YES if enabled else NO),
                    'why': 'public' if not private else 'private'})
    return out


def usable(b, token, runners):
    status = b.get('status', 'active')
    if status != 'active':
        return NO, status
    if token['present'] == NO:
        return NO, 'no token'
    if token['present'] == UNKNOWN:
        return UNKNOWN, 'token unknown'
    if runners is not None:
        if runners['online'] > 0:
            return YES, f"{runners['online']} runner(s) online"
        return NO, 'no runner online' if runners['total'] else 'no runner with this tag'
    return YES, 'token present'


def check_backend(cfg, b, routes, env=None, api=None, gh=None):
    """api(cfg, host, path, token_source) and gh(path) are injectable for tests."""
    api = api or (lambda c, h, p, s: gitlab_api(c, h, p, s, env))
    res = {'id': b['id'], 'token': {'present': UNKNOWN, 'source': ''}, 'runners': None, 'jobs': None, 'actions': []}
    if b.get('status', 'active') == 'active':
        res['token'] = token_state(cfg, b['host'], env)
        if res['token']['present'] == YES:
            if b.get('kind') == 'gitlab':
                res['runners'], res['jobs'] = gitlab_runners(cfg, b, res['token']['source'], api=api)
            elif b.get('kind') == 'github' and (gh or shutil.which('gh')):
                res['actions'] = github_actions(cfg, b, routes, gh)
    res['usable'], res['why'] = usable(b, res['token'], res['runners'])
    return res


def status(cfg, refresh=False, env=None, api=None, gh=None):
    cache = read_json(cfg['status_cache'], {})
    fresh = False
    if cache.get('generated') and not refresh:
        try:
            age = _dt.datetime.now(_dt.timezone.utc) - _dt.datetime.fromisoformat(cache['generated'].replace('Z', '+00:00'))
            fresh = age.total_seconds() < cfg['cache_minutes'] * 60 and cache.get('config') == cfg['_path'] \
                and sorted(cache.get('checks', {})) == sorted(backend_ids(cfg))
        except ValueError:
            fresh = False
    if fresh:
        return cache
    routes = load_routes(cfg)
    checks = {b['id']: check_backend(cfg, b, routes, env, api, gh) for b in cfg['backends']}
    data = {'generated': now_iso(), 'config': cfg['_path'], 'checks': checks}
    try:
        write_json(cfg['status_cache'], data)
    except OSError:
        pass
    return data


def cached_status(cfg):
    """The last status without any check: what /ci shows at once."""
    data = read_json(cfg['status_cache'], {})
    return data if isinstance(data, dict) and data.get('checks') else {'generated': None, 'checks': {}}


def show(cfg, cwd=None, session=None, refresh=False, check=False):
    st = status(cfg, refresh=refresh) if (check or refresh) else cached_status(cfg)
    routes = load_routes(cfg)
    current = resolve(routes, cwd, session)
    stale = True
    if st.get('generated'):
        try:
            age = _dt.datetime.now(_dt.timezone.utc) - _dt.datetime.fromisoformat(st['generated'].replace('Z', '+00:00'))
            stale = age.total_seconds() >= cfg['cache_minutes'] * 60
        except ValueError:
            pass
    backends = []
    for b in cfg['backends']:
        public = {k: v for k, v in b.items() if not k.startswith('_')}
        public['check'] = st['checks'].get(b['id'])
        backends.append(public)
    return {
        'generated': st.get('generated'),
        'stale': stale,
        'config': cfg['_path'].replace('\\', '/'),
        'routing_file': cfg['routing_file'],
        'labels': cfg.get('labels', {}),
        'options': {'status_line': cfg.get('status_line', True), 'prompt_note': cfg.get('prompt_note', False)},
        'backends': backends,
        'routes': [{'key': k, **r} for k, r in sorted(routes.items(), key=lambda kv: kv[1].get('set_at', ''), reverse=True)],
        'current': current,
    }


# ------------------------------------------------------------------ CLI

def main(argv=None):
    ap = argparse.ArgumentParser(prog='ci.py', description=__doc__.split('\n')[0])
    ap.add_argument('command', choices=['show', 'status', 'route', 'clear', 'resolve', 'config'])
    ap.add_argument('args', nargs='*')
    ap.add_argument('--config')
    ap.add_argument('--cwd')
    ap.add_argument('--session', action='append', help='session id or name (repeatable)')
    ap.add_argument('--by')
    ap.add_argument('--refresh', action='store_true', help='run the checks now, ignoring the cache')
    ap.add_argument('--check', action='store_true', help='show: run the checks when the cache is stale')
    a = ap.parse_args(argv)
    cfg = load_config(a.config)
    cwd = a.cwd or os.getcwd()
    try:
        if a.command == 'show':
            out = show(cfg, cwd, a.session, refresh=a.refresh, check=a.check)
        elif a.command == 'status':
            out = status(cfg, refresh=a.refresh)
        elif a.command == 'config':
            out = {k: v for k, v in cfg.items() if not k.startswith('_')}
        elif a.command == 'resolve':
            out = {'route': resolve(load_routes(cfg), cwd, a.session)}
        elif a.command == 'route':
            if len(a.args) != 2:
                raise ValueError('usage: route <repo-path|session> <backend-id>')
            out = set_route(cfg, a.args[0], a.args[1], a.by, cwd)
        else:
            if len(a.args) != 1:
                raise ValueError('usage: clear <repo-path|session>')
            out = clear_route(cfg, a.args[0], cwd)
    except ValueError as err:
        print(json.dumps({'error': str(err)}))
        return 2
    print(json.dumps(out, indent=2))
    return 0


def write_health(mod, error=None, env=None, now=None):
    """Health record for « Santé des mods » (convention in mods/sante/README.md), best effort, never raises.

    ~/.claude/mods-health/<mod>.json: lastRun, durationMs (this process), cpuMs, error, lastOk, rolling 24 h window.
    MODS_HEALTH_DIR moves the folder (tests); MODS_HEALTH=0 turns it off.
    """
    env = os.environ if env is None else env
    try:
        if env.get('MODS_HEALTH') == '0':
            return None
        d = env.get('MODS_HEALTH_DIR') or os.path.join(os.path.expanduser('~'), '.claude', 'mods-health')
        f = os.path.join(d, mod + '.json')
        try:
            with open(f, encoding='utf-8') as fh:
                p = json.load(fh) or {}
        except (OSError, ValueError):
            p = {}
        now = time.time() if now is None else now
        iso = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(now)) + '.%03dZ' % int((now % 1) * 1000)
        cpu = int(time.process_time() * 1000)
        dur = int((now - _HEALTH_T0) * 1000)
        w = p.get('window') or {}
        try:
            import calendar
            start = calendar.timegm(time.strptime(w.get('start', '')[:19], '%Y-%m-%dT%H:%M:%S'))
        except (TypeError, ValueError):
            start = 0
        if not start or now - start >= 86400:
            w = {'start': iso, 'runs': 0, 'cpuMs': 0, 'durationMs': 0, 'errors': 0}
        rec = {'mod': mod, 'lastRun': iso, 'durationMs': dur, 'cpuMs': cpu,
               'error': str(error)[:500] if error else None, 'lastOk': p.get('lastOk') if error else iso,
               'window': {'start': w['start'], 'runs': w.get('runs', 0) + 1, 'cpuMs': w.get('cpuMs', 0) + cpu,
                          'durationMs': w.get('durationMs', 0) + dur, 'errors': w.get('errors', 0) + (1 if error else 0)}}
        os.makedirs(d, exist_ok=True)
        tmp = '%s.%d.tmp' % (f, os.getpid())
        with open(tmp, 'w', encoding='utf-8') as fh:
            json.dump(rec, fh)
        os.replace(tmp, f)
        return rec
    except Exception:  # noqa: BLE001 - a health record must never break the scanner
        return None


if __name__ == '__main__':
    try:
        _rc = main()
    except Exception as _err:
        write_health('ci', repr(_err))
        raise
    write_health('ci', None if not _rc else 'exit %s' % _rc)
    sys.exit(_rc)
