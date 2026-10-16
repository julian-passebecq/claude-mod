"""Workflow scanner for factory's « Workflow » screen: incremental, read-only, standard library only.

Usage: python -I workflow_scan.py --cache FILE [--projects DIR] [--session CLI_ID | --all] [--hours 36] [--stale-h 6]
                                   [--history-days 30] [--now EPOCH]
Prints one JSON document: {generated, runs: [...], history: [...], live: [...]}.

Where Claude Code keeps a Workflow run (found on Windows, Claude Code 2.1.29x; documented in the README):
  ~/.claude/projects/<project folder>/<conversation id>/
      workflows/scripts/<name>-<runId>.js           the script, written at launch (`export const meta = {name, description, phases}`)
      workflows/<runId>.json                        the run record, written when the run ends (status, durationMs,
                                                    totalTokens, phases, workflowProgress: one row per agent with model,
                                                    state, tokens, durationMs, lastToolName, ...). Absent while it runs.
      subagents/workflows/<runId>/journal.jsonl     live events: launched, started {agentId, label, phase}, result, failed
      subagents/workflows/<runId>/agent-<id>.jsonl  each agent's transcript (usage per message, tools, gitBranch, effort)
      subagents/workflows/<runId>/agent-<id>.meta.json  {agentType, description, workflowPhase, model (only when the
                                                    script named one), worktreePath}
A run without its record is running when something in its folder moved within --stale-h hours, else « interrupted ».

Speed: journals and transcripts are read from the byte offset where the last run stopped (cache file); records and
metas are re-read only when their mtime changes. Text that leaves this script (last tool, last line, errors) goes
through scrub(): tokens, keys, passwords, e-mails and home folders are masked, one line, at most 100 characters.
"""
import glob
import json
import os
import re
import sys
import time

CACHE_VERSION = 2
MAX_IDS = 300
LINE = 100


def arg(name, default=None):
    a = sys.argv[1:]
    return a[a.index(name) + 1] if name in a and a.index(name) + 1 < len(a) else default


HOME = os.path.expanduser('~')
PROJECTS = arg('--projects', os.path.join(HOME, '.claude', 'projects'))
CACHE = arg('--cache', os.path.join(HOME, '.claude', 'effort-board', 'factory_workflow_cache.json'))
SESSION = arg('--session')
ALL = '--all' in sys.argv
HOURS = float(arg('--hours', '36'))
STALE_H = float(arg('--stale-h', '6'))
HISTORY_DAYS = float(arg('--history-days', '30'))
NOW = float(arg('--now', str(time.time())))

SECRETS = [
    (re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(-----END [A-Z ]*PRIVATE KEY-----|$)', re.S), '<clé privée>'),
    (re.compile(r'\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}'), '<jeton>'),
    (re.compile(r'\bglpat-[A-Za-z0-9_-]{12,}'), '<jeton>'),
    (re.compile(r'\bsk-[A-Za-z0-9_-]{16,}'), '<clé>'),
    (re.compile(r'\bxox[abprs]-[A-Za-z0-9-]{10,}'), '<jeton>'),
    (re.compile(r'\bAKIA[0-9A-Z]{16}\b'), '<clé>'),
    (re.compile(r'\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}'), '<jeton>'),
    (re.compile(r'(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}'), r'\1 <masqué>'),
    (re.compile(r'(?i)\b(password|passwd|pwd|token|secret|api[_-]?key|apikey|authorization|client[_-]?secret)(["\']?\s*[:=]\s*)["\']?[^\s"\',;]+'), r'\1\2<masqué>'),
    (re.compile(r'(?i)(://[^/\s:@]+:)[^@\s/]+@'), r'\1<masqué>@'),
    (re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}\b'), '<e-mail>'),
    (re.compile(r'(?i)\b[A-Z]:[\\/]+Users[\\/]+[^\\/\s"\']+'), '~'),
    (re.compile(r'/(?:home|Users)/[^/\s"\']+'), '~'),
    (re.compile(r'\b[A-Fa-f0-9]{40,}\b'), '<hex>'),
    (re.compile(r'[A-Za-z0-9+/_-]{48,}={0,2}'), '<masqué>'),
]


def scrub(s, n=LINE):
    """One line, secrets masked, at most n characters."""
    s = str(s or '')
    for rx, rep in SECRETS:
        s = rx.sub(rep, s)
    s = re.sub(r'<system-reminder>.*?</system-reminder>', ' ', s, flags=re.S)
    s = ' '.join(s.split())
    return s if len(s) <= n else s[:n - 1] + '…'


def read_json(p):
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def mtime(p):
    try:
        return os.path.getmtime(p)
    except OSError:
        return 0


def iso_ms(ts):
    if not ts:
        return None
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp() * 1000)
    except ValueError:
        return None


def num(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def tail(path, entry, new, feed):
    """Feed the complete lines appended to `path` since entry['off']; a shrunk file is re-read whole."""
    try:
        st = os.stat(path)
    except OSError:
        return entry
    if entry is None or st.st_size < entry.get('off', 0) or entry.get('v') != CACHE_VERSION:
        entry = {'v': CACHE_VERSION, 'off': 0, 'agg': new()}
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
            feed(entry['agg'], d)
    entry['off'] += end + 1
    return entry


# ---- journal.jsonl ---------------------------------------------------------------------------------------------------

def new_journal():
    return {'launched': False, 'agents': {}, 'order': []}


def feed_journal(a, d):
    t = d.get('type')
    if t == 'launched':
        a['launched'] = True
        return
    aid = d.get('agentId')
    if not aid:
        return
    ag = a['agents'].get(aid)
    if ag is None:
        ag = a['agents'][aid] = {'label': None, 'phase': None, 'end': None}
        a['order'].append(aid)
    if t == 'started':
        ag['label'] = d.get('label') or ag['label']
        ag['phase'] = d.get('phase') or ag['phase']
    elif t == 'result':
        ag['end'] = 'done'
    elif t == 'failed':
        ag['end'] = 'failed'


# ---- agent transcripts -----------------------------------------------------------------------------------------------

def new_agent():
    return {'first': None, 'last': None, 'models': {}, 'ids': {}, 'id_order': [], 'effort': None, 'branch': None,
            'cwd': None, 'tools': 0, 'last_tool': '', 'last_text': '', 'last_cmd': '', 'pr': None}


PR_RX = re.compile(r'/(?:pull|merge_requests)/(\d+)\b')


def usage_vec(u):
    cc = u.get('cache_creation') or {}
    cw = u.get('cache_creation_input_tokens', 0) or 0
    cw1h = cc.get('ephemeral_1h_input_tokens', 0) or 0
    cw5 = cc.get('ephemeral_5m_input_tokens', cw - cw1h) or 0
    if cw5 + cw1h != cw:
        cw5, cw1h = cw, 0
    return [u.get('input_tokens', 0) or 0, u.get('output_tokens', 0) or 0, u.get('cache_read_input_tokens', 0) or 0, cw5, cw1h]


def text_of(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return ' '.join(b.get('text', '') if b.get('type') == 'text' else text_of(b.get('content'))
                        for b in c if isinstance(b, dict))
    return ''


LIMIT_RX = re.compile(r'\b429\b|rate.?limit|overloaded|\b529\b|too many requests', re.I)


def feed_agent(a, d):
    ts = d.get('timestamp')
    if (d.get('type') == 'system' and d.get('subtype') == 'api_error') or d.get('isApiErrorMessage'):
        if LIMIT_RX.search(json.dumps(d.get('error') or d.get('content') or d.get('message') or '')[:2000]):
            a['limits'] = a.get('limits', 0) + 1
    if ts:
        a['first'] = a['first'] or ts
        a['last'] = ts
    if d.get('cwd'):
        a['cwd'] = d['cwd']
    if d.get('gitBranch') and d['gitBranch'] != 'HEAD':
        a['branch'] = d['gitBranch']
    m = d.get('message') or {}
    if d.get('type') == 'user':
        found = PR_RX.findall(text_of(m.get('content')))
        if found:
            a['pr'] = int(found[-1])
        return
    if d.get('type') != 'assistant':
        return
    model = m.get('model') or ''
    if not model or model == '<synthetic>':
        return
    a['effort'] = d.get('perTurnEffort') or d.get('effort') or a['effort']
    mid = m.get('id') or d.get('uuid')
    v = usage_vec(m.get('usage') or {})
    prev = a['ids'].get(mid)
    cur = a['models'].setdefault(model, [0, 0, 0, 0, 0, 0])
    if prev is None:
        a['ids'][mid] = v
        a['id_order'].append(mid)
        if len(a['id_order']) > MAX_IDS:
            a['ids'].pop(a['id_order'].pop(0), None)
        cur[5] += 1
        for i in range(5):
            cur[i] += v[i]
    elif v[1] >= prev[1]:  # the same message streamed again: keep the larger usage
        for i in range(5):
            cur[i] += v[i] - prev[i]
        a['ids'][mid] = v
    for b in m.get('content') or []:
        if not isinstance(b, dict):
            continue
        if b.get('type') == 'text' and b.get('text', '').strip():
            lines = [x for x in b['text'].strip().splitlines() if x.strip()]
            a['last_text'] = scrub(lines[-1] if lines else '')
            found = PR_RX.findall(b['text'])
            if found:
                a['pr'] = int(found[-1])
        elif b.get('type') == 'tool_use':
            name, inp = b.get('name') or '?', b.get('input') or {}
            a['tools'] += 1
            hint = inp.get('description') or inp.get('command') or inp.get('file_path') or inp.get('pattern') or inp.get('url') or ''
            a['last_tool'] = scrub('%s %s' % (name, hint))
            if name in ('Bash', 'PowerShell'):
                a['last_cmd'] = scrub(inp.get('command') or '', 160)


# ---- one run ---------------------------------------------------------------------------------------------------------

META_RX = re.compile(r'export\s+const\s+meta\s*=\s*\{(.*?)\n\}', re.S)


def first_string(src, key):
    m = re.search(key + r"""\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1""", src, re.S)
    return m.group(2).replace("\\'", "'").replace('\\"', '"') if m else ''


def script_meta(src):
    """name, description and phases from `export const meta = {...}` (string literals only, nothing is executed)."""
    m = META_RX.search(src or '')
    body = m.group(1) if m else (src or '')[:4000]
    phases = []
    pm = re.search(r'phases\s*:\s*\[(.*?)\]', body, re.S)
    if pm:
        for item in re.findall(r'\{(.*?)\}', pm.group(1), re.S):
            t = first_string(item, 'title')
            if t:
                phases.append({'title': t, 'detail': scrub(first_string(item, 'detail'), 120)})
    return {'name': first_string(body, 'name'), 'description': scrub(first_string(body, 'description'), 200), 'phases': phases}


def cached_json(cache, path):
    """Parse a JSON file once per mtime (records and metas do not change once written)."""
    mt = mtime(path)
    if not mt:
        return None
    ent = cache['json'].get(path)
    if ent and ent['mtime'] == mt:
        return ent['data']
    data = read_json(path)
    cache['json'][path] = {'mtime': mt, 'data': data}
    return data


def slim_record(w):
    if not isinstance(w, dict):
        return None
    prog = []
    for p in w.get('workflowProgress') or []:
        if isinstance(p, dict) and p.get('type') == 'workflow_agent':
            prog.append({k: p.get(k) for k in ('agentId', 'label', 'phaseTitle', 'phaseIndex', 'model', 'state', 'tokens',
                                               'durationMs', 'startedAt', 'lastProgressAt', 'lastToolName', 'agentType', 'cached')})
    return {'status': w.get('status'), 'name': w.get('workflowName'), 'summary': scrub(w.get('summary'), 200),
            'start': num(w.get('startTime')), 'duration_ms': num(w.get('durationMs')), 'tokens': num(w.get('totalTokens')),
            'agent_count': num(w.get('agentCount')), 'default_model': w.get('defaultModel'),
            'phases': [{'title': p.get('title'), 'detail': scrub(p.get('detail'), 120)} for p in (w.get('phases') or []) if isinstance(p, dict)],
            'error': scrub(w.get('error'), 160) if w.get('error') else '', 'progress': prog,
            'script_meta': script_meta(w.get('script')) if w.get('script') else None}


def hist_summary(cache, tp):
    """{model, tokens, vec} of a finished agent transcript, parsed once per size and kept small in the cache."""
    size = os.path.getsize(tp) if os.path.isfile(tp) else 0
    ent = cache['hist'].get(tp)
    if ent and ent.get('size') == size:
        return ent
    a = new_agent()
    if size:
        with open(tp, 'rb') as f:
            for raw in f:
                try:
                    d = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(d, dict) and d.get('type') == 'assistant':
                    feed_agent(a, d)
    vec = [0, 0, 0, 0, 0]
    for v in a['models'].values():
        for i in range(5):
            vec[i] += v[i]
    model = sorted(a['models'], key=lambda m: -a['models'][m][5])[0] if a['models'] else None
    ent = cache['hist'][tp] = {'size': size, 'model': model, 'tokens': sum(vec), 'vec': vec}
    return ent


def main():
    cache = read_json(CACHE) or {}
    if cache.get('v') != CACHE_VERSION:
        cache = {'v': CACHE_VERSION, 'files': {}, 'json': {}, 'records': {}, 'hist': {}}
    files, touched = cache['files'], set()
    runs, history, live = [], [], []
    since = NOW - HOURS * 3600
    hist_since = NOW - HISTORY_DAYS * 86400

    def load(path, new, feed):
        files[path] = tail(path, files.get(path), new, feed)
        touched.add(path)
        return files[path]

    for d in glob.glob(os.path.join(PROJECTS, '*', '*', 'subagents', 'workflows', 'wf_*')):
        if not os.path.isdir(d):
            continue
        rid = os.path.basename(d)
        sess_dir = os.path.dirname(os.path.dirname(os.path.dirname(d)))
        cli = os.path.basename(sess_dir)
        project = os.path.basename(os.path.dirname(sess_dir))
        rec_path = os.path.join(sess_dir, 'workflows', rid + '.json')
        rec_mt = mtime(rec_path)
        jpath = os.path.join(d, 'journal.jsonl')
        moved = max([mtime(jpath), rec_mt] + [mtime(p) for p in glob.glob(os.path.join(d, 'agent-*.jsonl'))])
        # records of finished runs feed the estimator (history), whatever the conversation
        rec = None
        if rec_mt:
            slim = cache['records'].get(rec_path)
            if not slim or slim.get('_mtime') != rec_mt:
                slim = slim_record(read_json(rec_path)) or {}
                slim['_mtime'] = rec_mt
                cache['records'][rec_path] = slim
            rec = slim
            touched.add(rec_path)
            if rec.get('status') == 'completed' and rec_mt >= hist_since:
                for p in rec.get('progress') or []:
                    if p.get('state') in ('done', 'error') and not p.get('cached') and p.get('agentId'):
                        # the record's `tokens` is the agent's last context size, not what it used: the used tokens
                        # come from its transcript, summarised once (a finished transcript does not change)
                        tp = os.path.join(d, 'agent-%s.jsonl' % p['agentId'])
                        sm = hist_summary(cache, tp)
                        touched.add(tp)
                        history.append({'run': rid, 'name': rec.get('name'), 'label': p.get('label'), 'phase': p.get('phaseTitle'),
                                        'model': sm['model'] or p.get('model'), 'tokens': sm['tokens'], 'vec': sm['vec'],
                                        'duration_ms': num(p.get('durationMs')), 'state': p.get('state'), 'type': p.get('agentType')})
        running = not rec_mt and NOW - moved <= STALE_H * 3600
        mine = ALL or (SESSION and cli == SESSION)
        if not running and not (mine and moved >= since):
            continue
        if not mine and not running:
            continue
        # this run is shown (mine) or counts for the PC-wide limits (running): read it
        j = load(jpath, new_journal, feed_journal)['agg'] if os.path.isfile(jpath) else new_journal()
        scripts = glob.glob(os.path.join(sess_dir, 'workflows', 'scripts', '*' + rid + '.js'))
        meta = None
        if scripts:
            ent = cache['json'].get(scripts[0])
            mt = mtime(scripts[0])
            if not ent or ent['mtime'] != mt:
                try:
                    with open(scripts[0], encoding='utf-8') as f:
                        src = f.read()
                except OSError:
                    src = ''
                ent = cache['json'][scripts[0]] = {'mtime': mt, 'data': script_meta(src)}
            meta = ent['data']
            touched.add(scripts[0])
        meta = meta or (rec or {}).get('script_meta') or {'name': '', 'description': '', 'phases': []}
        prog = {p.get('agentId'): p for p in (rec or {}).get('progress') or [] if p.get('agentId')}
        ids = list(j['order']) + [a for a in prog if a not in j['agents']]
        for p in glob.glob(os.path.join(d, 'agent-*.jsonl')):
            aid = os.path.basename(p)[6:-6]
            if aid not in ids:
                ids.append(aid)
        status = (rec or {}).get('status') or ('running' if running else 'interrupted')
        agents, cwd = [], ''
        for aid in ids:
            tp = os.path.join(d, 'agent-%s.jsonl' % aid)
            ag = load(tp, new_agent, feed_agent)['agg'] if os.path.isfile(tp) else new_agent()
            cwd = cwd or ag['cwd'] or ''
            am = cached_json(cache, tp[:-6] + '.meta.json') or {}
            touched.add(tp[:-6] + '.meta.json')
            jr = j['agents'].get(aid) or {}
            pr = prog.get(aid) or {}
            end = jr.get('end')
            if pr.get('cached'):
                st = 'skipped'
            elif end == 'failed' or pr.get('state') == 'error':
                st = 'failed'
            elif end == 'done' or pr.get('state') == 'done':
                st = 'done'
            elif status == 'running':
                st = 'running'
            else:
                st = 'skipped'  # the run ended (killed, failed) before this agent did
            first, last = iso_ms(ag['first']), iso_ms(ag['last'])
            start = num(pr.get('startedAt')) or first
            if start and last and last < start:  # a cached agent: its transcript belongs to an earlier run
                last = None
            agents.append({
                'id': aid, 'label': scrub(jr.get('label') or pr.get('label') or am.get('description') or aid, 60),
                'phase': jr.get('phase') or pr.get('phaseTitle') or am.get('workflowPhase') or '',
                'type': am.get('agentType') or pr.get('agentType') or '', 'explicit_model': am.get('model'),
                'model': (sorted(ag['models'], key=lambda m: -ag['models'][m][5])[0] if ag['models'] else None) or pr.get('model'),
                'effort': ag['effort'], 'status': st, 'start': start,
                'end': (start + num(pr.get('durationMs'))) if start and num(pr.get('durationMs')) else (last if st != 'running' else None),
                'last': last, 'models': {} if pr.get('cached') else ag['models'], 'tools': ag['tools'], 'rate_limits': ag.get('limits', 0),
                'tokens_record': num(pr.get('tokens')),
                'last_tool': ag['last_tool'] or scrub(pr.get('lastToolName') or ''), 'last_text': ag['last_text'], 'last_cmd': ag['last_cmd'],
                'worktree': scrub(am.get('worktreePath') or '', 120), 'branch': ag['branch'], 'pr': ag['pr'],
            })
        starts = [a['start'] for a in agents if a['start']]
        start = (rec or {}).get('start') or (int(mtime(scripts[0]) * 1000) if scripts else None) or (min(starts) if starts else None)
        run = {
            'run_id': rid, 'cli': cli, 'project': project, 'cwd': scrub(cwd, 160),
            'name': meta.get('name') or (rec or {}).get('name') or rid, 'description': meta.get('description') or (rec or {}).get('summary') or '',
            'phases': meta.get('phases') or (rec or {}).get('phases') or [], 'status': status, 'start': start,
            'end': (start + rec['duration_ms']) if rec and start and rec.get('duration_ms') else None,
            'tokens_record': (rec or {}).get('tokens'), 'agent_count': (rec or {}).get('agent_count'),
            'default_model': (rec or {}).get('default_model'), 'error': (rec or {}).get('error') or '',
            'last_activity': int(moved * 1000), 'agents': agents, 'mine': bool(mine),
        }
        (runs if mine else live).append(run)

    for p in [p for p in files if p not in touched and NOW - files[p].get('mtime', 0) > max(HOURS, STALE_H) * 3600 * 2]:
        del files[p]
    for k in ('json', 'records', 'hist'):
        for p in [p for p in cache[k] if p not in touched and not os.path.exists(p)]:
            del cache[k][p]
    try:
        os.makedirs(os.path.dirname(CACHE) or '.', exist_ok=True)
        tmp = CACHE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(cache, f, separators=(',', ':'))
        os.replace(tmp, CACHE)
    except OSError:
        pass
    runs.sort(key=lambda r: (r['status'] != 'running', -(r['start'] or r['last_activity'] or 0)))
    json.dump({'generated': NOW, 'cpus': os.cpu_count() or 0, 'runs': runs, 'live': live, 'history': history}, sys.stdout, separators=(',', ':'))


if __name__ == '__main__':
    main()
