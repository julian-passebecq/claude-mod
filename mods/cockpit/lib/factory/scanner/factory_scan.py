"""Factory scanner: incremental, read-only summary of Claude Code conversations for the `factory` mod.

Usage: python factory_scan.py --cache FILE [--hours 36] [--detail CLI_ID] [--projects DIR] [--app DIR]
                              [--board DIR] [--ci-ttl 600] [--live-s 180] [--now EPOCH] [--cli]
                              [--waiting] [--pr-ttl 180] [--pr-max-age-days 14] [--pr-max-checks 25] [--gl-host HOST]
                              [--recent N]
Prints one JSON document: {generated, sessions: [...], detail: {...} | null, reviews: {...} | null}.

--recent N keeps each conversation's last N log events in its row (`recent`, for the timeline and journal screens).
--waiting adds `reviews`: Julian's open, non-draft PRs (gh search --author=@me) and MRs (glab api, scope=created_by_me)
updated in the last N days, each with CI state, conflict flag and the time CI turned green. gh and glab hold their own
tokens: this script never reads, prints or stores a token. The list is cached --pr-ttl seconds in the cache file.

Speed: every transcript (main and subagent .jsonl) is read from the byte offset where the last run stopped; the
aggregates live in the cache file, so a refresh only parses the new tail. A file that shrank is re-read whole.
Tokens: assistant records are de-duplicated by message.id (streamed blocks repeat the usage): the record with the
largest output_tokens wins, as in docs/audits/2026-10-09-night/usage_scan.py. '<synthetic>' turns are skipped.
Dollars are NOT computed here: the mod prices the tokens with the rate table in factory.config.json.
"""
import concurrent.futures as cf
import glob
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime

CACHE_VERSION = 5
READ_ONLY = {'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'LS', 'NotebookRead'}
LOOP_TOOLS = {'Monitor', 'CronCreate', 'ScheduleWakeup'}
MAX_IDS, MAX_TURNS, MAX_EVENTS, MAX_ERRORS = 300, 40, 30, 20


def arg(name, default=None):
    a = sys.argv[1:]
    return a[a.index(name) + 1] if name in a and a.index(name) + 1 < len(a) else default


HOME = os.path.expanduser('~')
PROJECTS = arg('--projects', os.path.join(HOME, '.claude', 'projects'))
APP = arg('--app', os.path.join(os.environ.get('APPDATA', ''), 'Claude', 'claude-code-sessions'))
if not os.path.isdir(APP) and '--app' not in sys.argv:
    # The Microsoft Store (MSIX) build of the desktop app keeps its data under the package's LocalCache, which a
    # process outside the package does not see at %APPDATA%: titles, models and spawnedFrom links would all be lost.
    for _p in sorted(glob.glob(os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Packages', 'Claude_*', 'LocalCache', 'Roaming', 'Claude', 'claude-code-sessions'))):
        APP = _p
        break
BOARD = arg('--board', os.path.join(HOME, '.claude', 'effort-board'))
CACHE = arg('--cache', os.path.join(BOARD, 'factory_cache.json'))
HOURS = float(arg('--hours', '36'))
DETAIL = arg('--detail')
CI_TTL = float(arg('--ci-ttl', '600'))
LIVE_S = float(arg('--live-s', '180'))
NOW = float(arg('--now', str(time.time())))
CLI = '--cli' in sys.argv
WAITING = '--waiting' in sys.argv
PR_TTL = float(arg('--pr-ttl', '180'))
PR_MAX_AGE = float(arg('--pr-max-age-days', '14')) * 86400
PR_MAX_CHECKS = int(arg('--pr-max-checks', '25'))
GL_HOST = arg('--gl-host', '')
RECENT = int(arg('--recent', '0'))
SUB_EVENTS = int(arg('--sub-events', '15'))

_day_cache = {}


def local_day(ts):
    """ISO timestamp -> local date (YYYY-MM-DD); cached per hour prefix."""
    k = ts[:13]
    if k not in _day_cache:
        try:
            _day_cache[k] = datetime.fromisoformat(ts[:19] + '+00:00').astimezone().date().isoformat()
        except ValueError:
            _day_cache[k] = ts[:10]
    return _day_cache[k]


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return ' '.join(b.get('text', '') for b in content if isinstance(b, dict) and b.get('type') == 'text')
    return ''


def one_line(s, n=90):
    s = re.sub(r'<[^>]{1,40}>', ' ', s or '')
    s = ' '.join(s.split())
    return s if len(s) <= n else s[:n - 1] + '…'


def usage_vec(u):
    cc = u.get('cache_creation') or {}
    cw = u.get('cache_creation_input_tokens', 0) or 0
    cw1h = cc.get('ephemeral_1h_input_tokens', 0) or 0
    cw5 = cc.get('ephemeral_5m_input_tokens', cw - cw1h) or 0
    if cw5 + cw1h != cw:  # older records: no split, count all as 5-minute writes
        cw5, cw1h = cw, 0
    return [u.get('input_tokens', 0) or 0, u.get('output_tokens', 0) or 0, u.get('cache_read_input_tokens', 0) or 0, cw5, cw1h]


def vadd(d, key, v, sign=1):
    cur = d.setdefault(key, [0, 0, 0, 0, 0, 0])  # in, out, cache read, cache write 5m, cache write 1h, calls
    for i in range(5):
        cur[i] += sign * v[i]


def new_agg():
    return {
        'cwd': None, 'branch': None, 'title': None, 'model': None, 'effort': None, 'first_ts': None, 'last_ts': None,
        'ctx': 0, 'models': {}, 'days': {}, 'ids': {}, 'id_order': [], 'turns': [], 'events': [], 'errors': [],
        'calls': [], 'pending': {}, 'notifs': {}, 'tools': 0, 'readonly': 0, 'last_tool': None, 'loops': {},
        'pr': None, 'compacts': 0, 'prompt': None, 'ask_open': False, 'stop': None, 'api_error': False,
        'ask_ts': None, 'ask_q': '',
    }


def push(lst, item, cap):
    lst.append(item)
    del lst[:-cap]


def feed(a, d, sub):
    """Add one transcript record to aggregate `a`."""
    t = d.get('type')
    ts = d.get('timestamp') or ''
    if ts:
        a['first_ts'] = a['first_ts'] or ts
        a['last_ts'] = ts
    if d.get('cwd'):
        a['cwd'] = d['cwd']
    if d.get('gitBranch') and d['gitBranch'] != 'HEAD':
        a['branch'] = d['gitBranch']
    if t == 'custom-title' and d.get('customTitle'):
        a['title'] = d['customTitle']
    elif t == 'ai-title' and d.get('aiTitle') and not a['title']:
        a['title'] = d['aiTitle']
    elif t == 'pr-link':
        if not a['pr'] or a['pr'].get('number') != d.get('prNumber'):
            push(a['events'], [ts, 'pr', 'PR/MR #%s linked' % d.get('prNumber')], MAX_EVENTS)
        a['pr'] = {'number': d.get('prNumber'), 'url': d.get('prUrl'), 'repo': d.get('prRepository')}
    elif t == 'system' and d.get('subtype') == 'compact_boundary':
        a['compacts'] += 1
        push(a['events'], [ts, 'compact', 'context compacted (%s)' % ((d.get('compactMetadata') or {}).get('trigger') or '?')], MAX_EVENTS)
    elif t == 'system' and d.get('subtype') == 'api_error':
        push(a['errors'], [ts, 'api', one_line(str(d.get('error') or d.get('content') or 'API error'), 160)], MAX_ERRORS)
    elif t == 'user':
        m = d.get('message') or {}
        c = m.get('content')
        if isinstance(c, list):
            for b in c:
                if not isinstance(b, dict) or b.get('type') != 'tool_result':
                    continue
                tid = b.get('tool_use_id')
                tur = d.get('toolUseResult') if isinstance(d.get('toolUseResult'), dict) else {}
                if tid in a['pending']:
                    call = a['pending'].pop(tid)
                    call['result'] = 'error' if b.get('is_error') else (tur.get('status') or 'done')
                    if tur.get('agentId'):
                        call['agentId'] = tur['agentId']
                    if tur.get('resolvedModel'):
                        call['resolved'] = tur['resolvedModel']
                    rid = re.search(r'wf_[0-9a-f]{6,}-[0-9a-f]+', json.dumps(tur) + text_of(b.get('content')) if call['tool'] == 'Workflow' else '')
                    if rid:
                        call['runId'] = rid.group(0)
                if a.get('ask_id') == tid:
                    a['ask_open'] = False
                if b.get('is_error'):
                    body = b.get('content')
                    push(a['errors'], [ts, 'tool', one_line(body if isinstance(body, str) else text_of(body), 160)], MAX_ERRORS)
        s = re.sub(r'<system-reminder>.*?</system-reminder>', ' ', text_of(c), flags=re.S)
        kind = (d.get('origin') or {}).get('kind') or 'human'
        if isinstance(c, list) and any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in c):
            return
        if sub:
            if a['prompt'] is None and s.strip():
                a['prompt'] = one_line(s, 120)
            return
        if '<task-notification>' in s:
            kind, label = 'notif', ''
            for blk in re.findall(r'<task-notification>(.*?)</task-notification>', s, re.S):
                tid = re.search(r'<tool-use-id>([^<]+)</tool-use-id>', blk)
                st = re.search(r'<status>([^<]+)</status>', blk)
                sm = re.search(r'<summary>([^<]+)</summary>', blk)
                if tid:
                    a['notifs'][tid.group(1)] = st.group(1) if st else 'completed'
                label = one_line(sm.group(1) if sm else 'task notification', 110)
                push(a['events'], [ts, 'notif', label], MAX_EVENTS)
            s = label
        elif d.get('isMeta') and kind != 'peer' or not s.strip():
            return
        else:
            if kind == 'peer':
                nm = re.search(r'<cross-session-message[^>]*name="([^"]*)"', s)
                s = 'from %s: %s' % (nm.group(1) if nm else 'peer', re.sub(r'(?s)^.*?<cross-session-message[^>]*>', '', s))
            for cmd in re.findall(r'<command-name>/?([\w:-]+)</command-name>', s):
                if cmd == 'loop':
                    a['loops']['/loop'] = a['loops'].get('/loop', 0) + 1
            push(a['events'], [ts, 'prompt' if kind == 'human' else kind, one_line(s, 110)], MAX_EVENTS)
        push(a['turns'], {'ts': ts, 'kind': kind, 'text': one_line(s, 70), 'models': {}}, MAX_TURNS)
    elif t == 'assistant':
        m = d.get('message') or {}
        model = m.get('model') or ''
        if model == '<synthetic>' or not model:
            return
        if d.get('isApiErrorMessage'):
            a['api_error'] = True
        a['model'] = model
        a['effort'] = d.get('perTurnEffort') or d.get('effort') or a['effort']
        a['stop'] = m.get('stop_reason') or a['stop']
        u = m.get('usage') or {}
        mid = m.get('id') or d.get('uuid')
        v = usage_vec(u)
        prev = a['ids'].get(mid)
        day = local_day(ts) if ts else '?'
        turn = a['turns'][-1] if a['turns'] else None
        if prev is None:
            a['ids'][mid] = v + [0]
            a['id_order'].append(mid)
            if len(a['id_order']) > MAX_IDS:
                a['ids'].pop(a['id_order'].pop(0), None)
            a['models'].setdefault(model, [0] * 6)[5] += 1
            a['days'].setdefault(day, {}).setdefault(model, [0] * 6)[5] += 1
            if turn is not None:
                turn['models'].setdefault(model, [0] * 6)[5] += 1
        elif v[1] >= prev[1]:  # same message streamed again: replace its usage with the larger one
            old = prev[:5]
            a['ids'][mid] = v + [0]
            vadd(a['models'], model, old, -1)
            vadd(a['days'].setdefault(day, {}), model, old, -1)
            if turn is not None:
                vadd(turn['models'], model, old, -1)
        else:
            v = None
        if v is not None:
            vadd(a['models'], model, v)
            vadd(a['days'].setdefault(day, {}), model, v)
            if turn is not None:
                vadd(turn['models'], model, v)
            if not d.get('isSidechain') or sub:
                a['ctx'] = v[0] + v[2] + v[3] + v[4]
        for b in m.get('content') or []:
            if not isinstance(b, dict) or b.get('type') != 'tool_use':
                continue
            name, inp = b.get('name') or '?', b.get('input') or {}
            a['tools'] += 1
            a['last_tool'] = name
            if name in READ_ONLY:
                a['readonly'] += 1
            if name in LOOP_TOOLS:
                a['loops'][name] = a['loops'].get(name, 0) + 1
            if name == 'AskUserQuestion':
                a['ask_open'], a['ask_id'], a['ask_ts'] = True, b.get('id'), ts
                qs = inp.get('questions') or []
                a['ask_q'] = one_line(qs[0].get('question', '') if qs and isinstance(qs[0], dict) else '', 140)
            if name in ('Agent', 'Task', 'Workflow'):
                call = {'id': b.get('id'), 'tool': 'Workflow' if name == 'Workflow' else 'Agent', 'ts': ts,
                        'type': inp.get('subagent_type') or ('workflow' if name == 'Workflow' else 'general-purpose'),
                        'model': inp.get('model'), 'effort': inp.get('effort'), 'bg': bool(inp.get('run_in_background')),
                        'desc': one_line(inp.get('description') or '', 60), 'prompt': one_line(inp.get('prompt') or '', 200),
                        'by': model}
                if name == 'Workflow':
                    scr = str(inp.get('script') or '')
                    mm = re.search(r"name:\s*['\"]([^'\"]+)", scr)
                    call['desc'] = call['desc'] or (mm.group(1) if mm else 'workflow')
                    call['wf_agents'] = len(re.findall(r'\bagent\(', scr))
                    call['wf_models'] = sorted(set(re.findall(r"model:\s*['\"]([a-z0-9.-]+)['\"]", scr)))
                    call['bg'] = True
                push(a['calls'], call, 200)
                a['pending'][b.get('id')] = call
                push(a['events'], [ts, 'agent', '%s %s: %s' % (call['tool'], call['type'], call['desc'])], MAX_EVENTS)
            else:
                hint = inp.get('description') or inp.get('command') or inp.get('file_path') or inp.get('pattern') or inp.get('skill') or ''
                push(a['events'], [ts, 'tool', one_line('%s %s' % (name, hint), 110)], MAX_EVENTS)


def read_tail(path, entry, sub):
    """Parse the bytes appended to `path` since `entry['off']`; returns the (possibly new) entry."""
    try:
        st = os.stat(path)
    except OSError:
        return entry
    if entry is None or st.st_size < entry['off'] or entry.get('v') != CACHE_VERSION:
        entry = {'v': CACHE_VERSION, 'off': 0, 'agg': new_agg()}
    entry['mtime'] = st.st_mtime
    if st.st_size == entry['off']:
        return entry
    with open(path, 'rb') as f:
        f.seek(entry['off'])
        data = f.read()
    end = data.rfind(b'\n')
    if end < 0:
        return entry
    for raw in data[:end].split(b'\n'):
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        if isinstance(d, dict):
            feed(entry['agg'], d, sub)
    entry['off'] += end + 1
    return entry


def folder_for(cwd):
    return re.sub(r'[^A-Za-z0-9]', '-', cwd or '')


def app_sessions():
    out = []
    for p in glob.glob(os.path.join(APP, '*', '*', 'local_*.json')):
        try:
            if NOW - os.path.getmtime(p) > HOURS * 3600 * 4:
                continue
            j = json.load(open(p, encoding='utf-8'))
        except (OSError, ValueError):
            continue
        last = (j.get('lastActivityAt') or 0) / 1000
        if j.get('cliSessionId') and (NOW - last <= HOURS * 3600 or j.get('cliSessionId') == DETAIL):
            out.append(j)
    return out


def transcript_path(cli, cwd):
    p = os.path.join(PROJECTS, folder_for(cwd), cli + '.jsonl')
    if os.path.isfile(p):
        return p
    hits = glob.glob(os.path.join(PROJECTS, '*', cli + '.jsonl'))
    return hits[0] if hits else None


def sub_files(main_path):
    base = main_path[:-6]
    files = glob.glob(os.path.join(base, 'subagents', 'agent-*.jsonl'))
    files += glob.glob(os.path.join(base, 'subagents', 'workflows', '*', 'agent-*.jsonl'))
    return files


def read_json(p):
    try:
        return json.load(open(p, encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def slim(a, keep_detail):
    """The aggregate fields the mod needs (detail-only lists dropped from dashboard rows)."""
    o = {k: a[k] for k in ('cwd', 'branch', 'title', 'model', 'effort', 'first_ts', 'last_ts', 'ctx', 'models', 'tools',
                           'readonly', 'last_tool', 'loops', 'pr', 'compacts', 'ask_open', 'stop', 'api_error', 'prompt',
                           'ask_ts', 'ask_q')}
    o['days'] = a['days']
    o['last_error'] = a['errors'][-1] if a['errors'] else None
    if keep_detail:
        o.update(turns=a['turns'], events=a['events'], errors=a['errors'], calls=a['calls'])
    return o


def agent_status(agg, mtime, parent_call, parent_notifs):
    tid = parent_call.get('id') if parent_call else None
    if tid and tid in parent_notifs:
        s = parent_notifs[tid]
        return 'failed' if s in ('failed', 'killed', 'error') else 'done'
    if parent_call and parent_call.get('result') == 'error':
        return 'failed'
    if parent_call and parent_call.get('result') in ('completed', 'done') and not parent_call.get('bg'):
        return 'done'
    if NOW - mtime < LIVE_S:
        return 'running'
    if agg.get('api_error'):
        return 'failed'
    return 'done' if agg.get('stop') == 'end_turn' else 'stopped'


def ci_state(pr, cache):
    """PR/MR state + CI status through gh or glab, cached CI_TTL seconds."""
    if not pr or not pr.get('url') or CI_TTL <= 0:
        return None
    key = pr['url']
    hit = cache.get(key)
    if hit and NOW - hit['at'] < CI_TTL:
        return hit['v']
    v = {'state': '?', 'ci': '?'}
    try:
        if 'github.com' in key:
            r = subprocess.run(['gh', 'pr', 'view', str(pr['number']), '-R', pr['repo'], '--json', 'state,statusCheckRollup'],
                               capture_output=True, text=True, timeout=12)
            j = json.loads(r.stdout or '{}')
            checks = j.get('statusCheckRollup') or []
            concl = {(c.get('conclusion') or c.get('state') or c.get('status') or '').lower() for c in checks}
            v['state'] = (j.get('state') or '?').lower()
            v['ci'] = 'none' if not checks else 'failed' if concl & {'failure', 'error', 'cancelled', 'timed_out'} else \
                'running' if concl & {'', 'pending', 'in_progress', 'queued', 'expected'} else 'success'
        else:
            r = subprocess.run(['glab', 'mr', 'view', str(pr['number']), '-R', pr['repo'], '-F', 'json'],
                               capture_output=True, text=True, timeout=12)
            j = json.loads(r.stdout or '{}')
            v['state'] = (j.get('state') or '?').lower()
            v['ci'] = ((j.get('head_pipeline') or j.get('pipeline') or {}).get('status') or 'none').lower()
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    cache[key] = {'at': NOW, 'v': v}
    return v


def run(argv, timeout):
    """(exit code, stdout) of a command without a shell; (1, '') when it cannot start or times out."""
    try:
        r = subprocess.run(argv, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return r.returncode, r.stdout
    except (OSError, subprocess.SubprocessError):
        return 1, ''


def iso_s(ts):
    """ISO 8601 -> epoch seconds, or None."""
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def gh_ci(checks):
    """GitHub statusCheckRollup -> (ci, green_since). ci: success|failed|canceled|running|skipped|none."""
    if not checks:
        return 'none', None
    concl = [(c.get('conclusion') or c.get('state') or c.get('status') or '').upper() for c in checks]
    if any(c in ('FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE') for c in concl):
        return 'failed', None
    if 'CANCELLED' in concl:
        return 'canceled', None
    if any(c not in ('SUCCESS', 'NEUTRAL', 'SKIPPED') for c in concl):
        return 'running', None
    if 'SUCCESS' not in concl:
        return 'skipped', None  # every check skipped: nothing ran (incident A4, defect B2)
    done = [t for t in (iso_s(c.get('completedAt')) for c in checks) if t]
    return 'success', (max(done) if done else None)


GL_CI = {'success': 'success', 'failed': 'failed', 'canceled': 'canceled', 'skipped': 'skipped', 'manual': 'manual'}


def gl_ci(pipe):
    """GitLab head_pipeline -> (ci, green_since). A merge request without any pipeline is 'none'."""
    if not pipe:
        return 'none', None
    st = (pipe.get('status') or '').lower()
    ci = GL_CI.get(st, 'running' if st else 'none')
    return ci, (iso_s(pipe.get('finished_at') or pipe.get('updated_at')) if ci == 'success' else None)


def fresh(details, key, upd):
    hit = details.get(key)
    return hit if hit and hit.get('upd') == upd and NOW - hit.get('at', 0) < PR_TTL else None


def gh_reviews(details):
    code, out = run(['gh', 'search', 'prs', '--author=@me', '--state=open', '--limit', '100',
                     '--json', 'number,repository,url,title,updatedAt,isDraft'], 25)
    if code != 0:
        return [], 'gh: search failed (gh missing or not signed in)'
    try:
        items = json.loads(out or '[]')
    except ValueError:
        return [], 'gh: unreadable answer'
    items = [i for i in items if isinstance(i, dict) and not i.get('isDraft') and NOW - (iso_s(i.get('updatedAt')) or 0) <= PR_MAX_AGE]
    items.sort(key=lambda i: i.get('updatedAt') or '', reverse=True)

    def one(i):
        repo = (i.get('repository') or {}).get('nameWithOwner') or ''
        key, upd = i.get('url'), i.get('updatedAt')
        hit = fresh(details, key, upd)
        if not hit:
            c, o = run(['gh', 'pr', 'view', str(i.get('number')), '-R', repo, '--json', 'headRefName,mergeable,statusCheckRollup'], 20)
            try:
                d = json.loads(o or '{}') if c == 0 else None
            except ValueError:
                d = None
            if not isinstance(d, dict):
                return None
            ci, green = gh_ci(d.get('statusCheckRollup') or [])
            hit = details[key] = {'upd': upd, 'at': NOW, 'v': {
                'ci': ci, 'green_since': green, 'conflict': d.get('mergeable') == 'CONFLICTING', 'branch': d.get('headRefName') or ''}}
        return dict(hit['v'], provider='github', repo=repo, number=i.get('number'), url=key,
                    title=one_line(i.get('title') or '', 100), updated=iso_s(upd))
    with cf.ThreadPoolExecutor(6) as ex:
        res = list(ex.map(one, items[:PR_MAX_CHECKS]))
    return [r for r in res if r], ''


def gl_reviews(details):
    host = ['--hostname', GL_HOST] if GL_HOST else []
    code, out = run(['glab', 'api', *host, 'merge_requests?scope=created_by_me&state=opened&per_page=100'], 25)
    if code != 0:
        return [], 'glab: API call failed (glab missing or not signed in)'
    try:
        items = json.loads(out or '[]')
    except ValueError:
        return [], 'glab: unreadable answer'
    items = [i for i in items if isinstance(i, dict) and not (i.get('draft') or i.get('work_in_progress'))
             and NOW - (iso_s(i.get('updated_at')) or 0) <= PR_MAX_AGE]
    items.sort(key=lambda i: i.get('updated_at') or '', reverse=True)

    def one(i):
        key, upd = i.get('web_url'), i.get('updated_at')
        hit = fresh(details, key, upd)
        if not hit:
            c, o = run(['glab', 'api', *host, 'projects/%s/merge_requests/%s' % (i.get('project_id'), i.get('iid'))], 20)
            try:
                d = json.loads(o or '{}') if c == 0 else None
            except ValueError:
                d = None
            if not isinstance(d, dict):
                return None
            ci, green = gl_ci(d.get('head_pipeline'))
            hit = details[key] = {'upd': upd, 'at': NOW, 'v': {
                'ci': ci, 'green_since': green, 'conflict': bool(d.get('has_conflicts')), 'branch': d.get('source_branch') or ''}}
        full = ((i.get('references') or {}).get('full') or '').split('!')[0]
        return dict(hit['v'], provider='gitlab', repo=full, number=i.get('iid'), url=key,
                    title=one_line(i.get('title') or '', 100), updated=iso_s(upd))
    with cf.ThreadPoolExecutor(6) as ex:
        res = list(ex.map(one, items[:PR_MAX_CHECKS]))
    return [r for r in res if r], ''


def open_reviews(cache):
    """Julian's open PRs/MRs with CI state, cached PR_TTL seconds: {at, items, errors}."""
    hit = cache.get('reviews')
    if hit and NOW - hit.get('at', 0) < PR_TTL:
        return hit
    details = cache.setdefault('review_details', {})
    with cf.ThreadPoolExecutor(2) as ex:
        gh, gl = ex.submit(gh_reviews, details), ex.submit(gl_reviews, details)
        (a, ea), (b, eb) = gh.result(), gl.result()
    live = {r['url'] for r in a + b}
    for k in [k for k in details if k not in live]:
        del details[k]
    res = {'at': NOW, 'items': a + b, 'errors': [e for e in (ea, eb) if e]}
    cache['reviews'] = res
    return res


def mod_events(cache):
    """cc-control's guard log (mod_events.jsonl), read incrementally; returns {session: [[ts, rule, text], ...]}."""
    p = os.path.join(BOARD, 'mod_events.jsonl')
    ent = cache.get('mod_events') or {'off': 0, 'by': {}}
    try:
        size = os.path.getsize(p)
    except OSError:
        return {}
    if size < ent['off']:
        ent = {'off': 0, 'by': {}}
    if size > ent['off']:
        with open(p, 'rb') as f:
            f.seek(ent['off'])
            data = f.read()
        end = data.rfind(b'\n')
        for raw in data[:end].split(b'\n') if end >= 0 else []:
            try:
                d = json.loads(raw)
            except ValueError:
                continue
            sid = d.get('session')
            if sid:
                lst = ent['by'].setdefault(sid, [])
                push(lst, [d.get('time'), d.get('kind') or '?', one_line('%s %s' % (d.get('rule') or '', d.get('reason') or d.get('tool') or ''), 140)], MAX_ERRORS)
        ent['off'] += end + 1 if end >= 0 else 0
    cache['mod_events'] = ent
    return ent['by']


def main():
    try:
        cache = json.load(open(CACHE, encoding='utf-8'))
        if cache.get('v') != CACHE_VERSION:
            raise ValueError
    except (OSError, ValueError):
        cache = {'v': CACHE_VERSION, 'files': {}, 'ci': {}}
    files, touched = cache['files'], set()
    guards = mod_events(cache)

    def load(path, sub):
        files[path] = read_tail(path, files.get(path), sub)
        touched.add(path)
        return files[path]

    # Conversations: app session files (title, model, effort) joined to transcripts, plus CLI-only transcripts.
    rows, seen = [], set()
    for j in app_sessions():
        tp = transcript_path(j['cliSessionId'], j.get('cwd'))
        if tp:
            rows.append((j, tp))
            seen.add(tp)
    for tp in glob.glob(os.path.join(PROJECTS, '*', '*.jsonl')):
        if tp not in seen:
            try:
                fresh = NOW - os.path.getmtime(tp) <= HOURS * 3600
            except OSError:
                continue
            if fresh or os.path.basename(tp)[:-6] == DETAIL:
                rows.append(({}, tp))

    sessions, detail = [], None
    for app, tp in rows:
        cli = os.path.basename(tp)[:-6]
        is_detail = cli == DETAIL
        e = load(tp, False)
        a = e['agg']
        if not app and (not a['models'] or not (a['title'] or CLI or is_detail)):
            continue  # headless runs without a title (claude -p, SDK) only with --cli
        calls = {c['id']: c for c in a['calls']}
        subs = []
        for sp in sub_files(tp):
            se = load(sp, True)
            meta = read_json(sp[:-6] + '.meta.json')
            parent = calls.get(meta.get('toolUseId'))
            if not parent:  # link through the agentId the Agent tool_result returned
                aid = os.path.basename(sp)[6:-6]
                parent = next((c for c in a['calls'] if c.get('agentId') == aid), None)
            wf = os.path.basename(os.path.dirname(sp)) if os.sep + 'workflows' + os.sep in sp else None
            sa = se['agg']
            status = agent_status(sa, se['mtime'], parent, a['notifs'])
            subs.append({
                'id': os.path.basename(sp)[6:-6], 'type': meta.get('agentType') or 'agent', 'workflow': wf,
                'phase': meta.get('workflowPhase'), 'desc': one_line(meta.get('description') or '', 70),
                'explicit_model': (parent or {}).get('model') or meta.get('model'),
                'effort': (parent or {}).get('effort') or sa['effort'], 'model': sa['model'], 'status': status,
                'bg': meta.get('requestShape') == 'background', 'parent': (parent or {}).get('id'),
                'prompt': (parent or {}).get('prompt') or sa['prompt'], 'ts': sa['first_ts'], 'last_ts': sa['last_ts'],
                'models': sa['models'], 'days': sa['days'], 'tools': sa['tools'], 'readonly': sa['readonly'],
                'last_tool': sa['last_tool'], 'ctx': sa['ctx'], 'loops': sa['loops'],
                # the agent's own log, detail only (cockpit's « agent » level); dashboard rows keep the slim keys below
                'events': sa['events'][-SUB_EVENTS:] if is_detail else [],
            })
        cwd = app.get('cwd') or a['cwd']
        row = slim(a, is_detail)
        row.update(
            cli=cli, sid=app.get('sessionId'), app_title=app.get('title'), app_model=app.get('model'),
            app_effort=app.get('effort'), cwd=cwd, branch=app.get('branch') or a['branch'],
            origin=app.get('originCwd') or cwd, archived=bool(app.get('isArchived')),
            last_activity=(app.get('lastActivityAt') or 0) / 1000 or e['mtime'], mtime=e['mtime'],
            live=NOW - e['mtime'] < LIVE_S, needs_action=(app.get('postTurnSummary') or {}).get('needs_action') or '',
            status_detail=(app.get('postTurnSummary') or {}).get('status_detail') or '',
            resume_md=bool(cwd) and os.path.isfile(os.path.join(cwd, 'handoff', 'RESUME.md')),
            subs=[{k: s[k] for k in ('id', 'type', 'status', 'model', 'explicit_model', 'effort', 'desc', 'phase', 'models', 'days',
                                     'readonly', 'tools', 'workflow', 'loops', 'last_ts')} for s in subs],
            recent=a['events'][-RECENT:] if RECENT > 0 else [],
            merged_prs=sum(1 for p in (app.get('prs') or []) if isinstance(p, dict) and str(p.get('state') or '').upper() == 'MERGED'),
            guards=guards.get(cli, []) + guards.get(app.get('sessionId') or '-', []),
            status_category=(app.get('postTurnSummary') or {}).get('status_category') or '',
            awaiting=bool(app.get('interruptedAwaitingPerson')),
            parent=(app.get('spawnedFrom') or {}).get('sessionId'), parent_title=(app.get('spawnedFrom') or {}).get('title'),
            app_prs=[{'url': p.get('url'), 'number': p.get('prNumber'), 'repo': p.get('repo'), 'provider': p.get('provider'),
                      'state': str(p.get('state') or '').lower()} for p in (app.get('prs') or [])
                     if isinstance(p, dict) and p.get('url') and str(p.get('state') or '').upper() not in ('MERGED', 'CLOSED')],
        )
        sessions.append(row)
        if is_detail:
            detail = dict(row, subs=subs, notifs=a['notifs'])

    with cf.ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(ci_state, s['pr'], cache['ci']): s for s in sessions if s['pr']}
        for f, s in futs.items():
            try:
                s['ci'] = f.result(timeout=20)
            except Exception:
                s['ci'] = None
    if detail is not None:
        detail['ci'] = next((s.get('ci') for s in sessions if s['cli'] == DETAIL), None)
    reviews = open_reviews(cache) if WAITING else None

    for p in [p for p in files if p not in touched and NOW - files[p].get('mtime', 0) > HOURS * 3600 * 2]:
        del files[p]
    try:
        tmp = CACHE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(cache, f, separators=(',', ':'))
        os.replace(tmp, CACHE)
    except OSError:
        pass
    sessions.sort(key=lambda s: -s['last_activity'])
    json.dump({'generated': NOW, 'hours': HOURS, 'sessions': sessions, 'detail': detail, 'reviews': reviews}, sys.stdout,
              separators=(',', ':'))


if __name__ == '__main__':
    main()
