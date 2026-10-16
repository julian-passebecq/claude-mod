"""Scanner behind the `control` mod: python -I control_scan.py [usage|setup|practices|all] [--config PATH] [--out DIR]

usage      transcripts (~/.claude/projects/**/*.jsonl, subagents included) -> usage.json: counters per window and
           the metrics of config.json with a red/amber/green state. Counting follows
           docs/audits/2026-10-09-night/usage_scan.py (validated 2-9 Oct): assistant records de-duplicated by message.id
           per file, bench runs and the scratch cwd excluded. Counters are kept per file and per UTC hour in
           usage_cache.json, so a rescan only re-reads files whose size or mtime changed.
setup      everything that shapes a session (settings, CLAUDE.md, repo rules, agents, skills, hooks, mods, tasks, MCP,
           plugins) -> setup.json, with hidden rules flagged.
practices  ~/.claude/CLAUDE.md + the audit REPORT.md + usage.json -> practices.json (checklist, best/worst habits).
Standard library only; read-only except the files it writes in --out."""
import collections
import csv
import datetime as dt
import glob
import io
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CONFIG = os.path.join(os.path.dirname(HERE), 'config.json')
CACHE_VERSION = 3


def expand(p):
    return os.path.normpath(os.path.expanduser(p))


def load_config(path=None):
    with open(path or DEFAULT_CONFIG, encoding='utf8') as f:
        return json.load(f)


def write_json(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf8') as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


def read_text(path, limit=None):
    try:
        with open(path, encoding='utf8', errors='replace') as f:
            return f.read(limit) if limit else f.read()
    except OSError:
        return ''


def now_utc():
    return dt.datetime.now(dt.timezone.utc)


def iso_mtime(path):
    try:
        return dt.datetime.fromtimestamp(os.path.getmtime(path)).strftime('%Y-%m-%d %H:%M')
    except OSError:
        return None


# ---------------------------------------------------------------- usage

def short_model(m):
    m = (m or '').lower()
    for k in ('opus', 'sonnet', 'haiku', 'fable'):
        if k in m:
            return k
    return 'other'


def project_of(folder):
    """Worktree folders are merged into their repo: C--code-x--claude-worktrees-y -> C--code-x."""
    return folder.split('--claude-worktrees-')[0]


def price(usage, mod, prices):
    p = prices['models'].get(mod) or prices['models']['other']
    return (usage.get('input_tokens', 0) * p['in'] + usage.get('output_tokens', 0) * p['out']
            + usage.get('cache_read_input_tokens', 0) * p['in'] * prices['cache_read_factor']
            + usage.get('cache_creation_input_tokens', 0) * p['in'] * prices['cache_write_factor']) / 1e6


def agent_type_of(path):
    """Subagent transcripts sit beside agent-<id>.meta.json {agentType, ...}."""
    meta = path[:-len('.jsonl')] + '.meta.json'
    try:
        with open(meta, encoding='utf8') as f:
            return json.load(f).get('agentType') or ''
    except (OSError, ValueError):
        return ''


def scan_file(path, rel, cfg):
    """Counters of one transcript, per UTC hour key ('2026-10-09T03')."""
    sc = cfg['scan']
    prices = cfg['prices']
    read_only = set(sc['read_only_tools'])
    excl = sc['exclude_cwd']
    bench = sc['exclude_sdk_bench']
    proj = project_of(rel.split('/')[0])
    sub = '/subagents/' in rel
    atype = agent_type_of(path) if sub else ''
    hours = collections.defaultdict(lambda: collections.defaultdict(float))

    def add(hour, k, v=1):
        hours[hour][k] += v

    seen = {}
    try:
        f = open(path, encoding='utf8', errors='replace')
    except OSError:
        return {}
    with f:
        for line in f:
            # cheap pre-filter: tool results and plain user text are most of the bytes and never counted
            if '"assistant"' not in line and 'compact_boundary' not in line and '<command-name>' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            ts = d.get('timestamp') or ''
            if len(ts) < 13:
                continue
            hour = ts[:13]
            if any(x in (d.get('cwd') or '') for x in excl):
                continue
            if d.get('entrypoint') == 'sdk-cli' and any(a <= ts[:16] <= b for a, b in bench):
                continue
            t = d.get('type')
            if t == 'system' and d.get('subtype') == 'compact_boundary':
                auto = (d.get('compactMetadata') or {}).get('trigger') == 'auto'
                add(hour, 'compact_auto' if auto else 'compact_manual')
                continue
            if t == 'user':
                c = (d.get('message') or {}).get('content')
                if isinstance(c, list):
                    c = ' '.join(b.get('text', '') for b in c if isinstance(b, dict))
                for cmd in re.findall(r'<command-name>/([a-z-]+)', c if isinstance(c, str) else ''):
                    if cmd in ('goal', 'loop', 'compact', 'effort', 'model', 'clear', 'plan'):
                        add(hour, 'slash_' + cmd)
                continue
            if t != 'assistant':
                continue
            m = d.get('message') or {}
            if m.get('model') == '<synthetic>':
                continue
            u = m.get('usage') or {}
            mid = m.get('id') or d.get('uuid')
            ctx = (u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0)
                   + u.get('cache_creation_input_tokens', 0))
            rec = seen.setdefault(mid, dict(hour=hour, mod=short_model(m.get('model')),
                                            side='sub' if (sub or d.get('isSidechain')) else 'main',
                                            eff=d.get('effort') or d.get('perTurnEffort'), u=u, ctx=ctx, tools=[]))
            if u.get('output_tokens', 0) >= rec['u'].get('output_tokens', 0):
                rec['u'] = u
                rec['ctx'] = ctx
            for b in m.get('content') or []:
                if isinstance(b, dict) and b.get('type') == 'tool_use':
                    rec['tools'].append((b.get('name'), b.get('input') or {}))

    for rec in seen.values():
        h, mod, side, u, eff = rec['hour'], rec['mod'], rec['side'], rec['u'], rec['eff']
        usd = price(u, mod, prices)
        add(h, f'turns.{side}.{mod}')
        add(h, f'out.{side}.{mod}', u.get('output_tokens', 0))
        add(h, f'in.{side}.{mod}', u.get('input_tokens', 0))
        add(h, f'cread.{side}.{mod}', u.get('cache_read_input_tokens', 0))
        add(h, f'cwrite.{side}.{mod}', u.get('cache_creation_input_tokens', 0))
        add(h, f'usd.{side}.{mod}', usd)
        add(h, f'usd_eff.{mod}.{eff or "none"}', usd)
        add(h, f'proj_turns.{proj}')
        add(h, f'proj_usd.{proj}', usd)
        if eff:
            add(h, f'effort.{side}.{mod}.{eff}')
            if side == 'sub' and mod == 'opus' and eff in ('high', 'xhigh', 'max') and atype != 'architect':
                add(h, 'opus_sub_high_not_architect')
        if side == 'main':
            if rec['ctx'] >= cfg['scan']['ctx_big']:
                add(h, 'main_turns_ctx300k')
                if mod == 'opus':
                    add(h, 'opus_main_turns_ctx300k')
                    add(h, 'opus_main_cread_ctx300k', u.get('cache_read_input_tokens', 0))
            if rec['ctx'] >= cfg['scan']['ctx_handoff']:
                add(h, 'main_turns_ctx250k')
        for name, inp in rec['tools']:
            if side == 'main' and mod == 'opus':
                add(h, 'opus_main_toolcalls')
            if name in read_only:
                add(h, f'readonly.{side}.{mod}')
            if name in ('Agent', 'Task'):
                add(h, 'agent_total')
                add(h, 'agent_with_model' if inp.get('model') else 'agent_no_model')
                typ = str(inp.get('subagent_type') or 'general-purpose')
                add(h, 'agent_type.' + typ)
                if inp.get('model'):
                    add(h, 'agent_model.' + str(inp['model']))
                elif typ == 'Explore':
                    add(h, 'agent_explore_no_model')
                if inp.get('isolation'):
                    add(h, 'agent_isolation')
                if inp.get('run_in_background'):
                    add(h, 'agent_bg')
            elif name == 'Workflow':
                add(h, 'workflow')
                scr = str(inp.get('script') or '')
                add(h, 'workflow_agent_calls', len(re.findall(r'\bagent\(', scr)))
                for mm in re.findall(r"model:\s*['\"]([a-z0-9.-]+)['\"]", scr):
                    add(h, 'workflow_model.' + mm)
                    add(h, 'workflow_model_total')
            elif name in ('EnterPlanMode', 'ExitPlanMode', 'CronCreate', 'Monitor', 'ScheduleWakeup'):
                add(h, 'tool.' + name)
            elif name == 'Skill':
                if 'handoff' in str(inp.get('skill') or inp.get('name') or ''):
                    add(h, 'skill.handoff')
            elif name == 'mcp__ccd_session__spawn_task':
                add(h, 'tool.spawn_task')
            elif name == 'mcp__ccd_session_mgmt__send_message':
                add(h, 'tool.send_message')
    return {hk: {k: (round(v, 6) if isinstance(v, float) and not v.is_integer() else int(v))
                 for k, v in c.items()} for hk, c in hours.items()}


def window_bounds(w, now):
    if 'hours' in w:
        start = now - dt.timedelta(hours=w['hours'] - 1)
        return start.strftime('%Y-%m-%dT%H'), now.strftime('%Y-%m-%dT%H')
    return w['from'], w['to']


def hours_between(a, b):
    fa = dt.datetime.strptime(a, '%Y-%m-%dT%H')
    fb = dt.datetime.strptime(b, '%Y-%m-%dT%H')
    return max(1, int((fb - fa).total_seconds() // 3600) + 1)


def scan_usage(cfg, out_dir, now=None, root=None):
    now = now or now_utc()
    root = expand(root or os.path.join(cfg['paths']['claude_home'], 'projects'))
    cache_path = os.path.join(out_dir, 'usage_cache.json')
    try:
        with open(cache_path, encoding='utf8') as f:
            cache = json.load(f)
        if cache.get('version') != CACHE_VERSION or cache.get('config') != config_key(cfg):
            cache = None
    except (OSError, ValueError):
        cache = None
    cache = cache or {'version': CACHE_VERSION, 'config': config_key(cfg), 'files': {}}
    bounds = [window_bounds(w, now) for w in cfg['scan']['windows']]
    oldest = min(b[0] for b in bounds)
    oldest_ts = dt.datetime.strptime(oldest, '%Y-%m-%dT%H').replace(tzinfo=dt.timezone.utc).timestamp() - 86400
    files = {}
    rescanned = 0
    for path in glob.glob(root + '/*/**/*.jsonl', recursive=True):
        rel = os.path.relpath(path, root).replace('\\', '/')
        if any(x in rel.split('/')[0] for x in cfg['scan']['exclude_cwd']):
            continue
        try:
            st = os.stat(path)
        except OSError:
            continue
        if st.st_mtime < oldest_ts:
            continue
        old = cache['files'].get(rel)
        if old and old['size'] == st.st_size and old['mtime'] == int(st.st_mtime):
            files[rel] = old
            continue
        files[rel] = {'size': st.st_size, 'mtime': int(st.st_mtime), 'hours': scan_file(path, rel, cfg)}
        rescanned += 1
    cache['files'] = files
    write_json(cache_path, cache)

    windows = []
    for w, (a, b) in zip(cfg['scan']['windows'], bounds):
        tot = collections.defaultdict(float)
        for entry in files.values():
            for hk, counters in entry['hours'].items():
                if a <= hk <= b:
                    for k, v in counters.items():
                        tot[k] += v
        tot = {k: (round(v, 2) if not float(v).is_integer() else int(v)) for k, v in tot.items()}
        days = hours_between(a, min(b, now.strftime('%Y-%m-%dT%H'))) / 24
        windows.append({'id': w['id'], 'label': w['label'], 'from': a, 'to': b, 'days': round(days, 2),
                        'counters': tot, 'summary': summarize(tot), 'metrics': compute_metrics(tot, days, cfg)})
    data = {'generated': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'files': len(files), 'rescanned': rescanned,
            'prices': cfg['prices'], 'windows': windows}
    write_json(os.path.join(out_dir, 'usage.json'), data)
    return data


def config_key(cfg):
    """The cache is only valid for the same counting rules and prices."""
    return json.dumps([cfg['scan'], cfg['prices']], sort_keys=True)


MODELS = ('opus', 'sonnet', 'haiku', 'fable', 'other')


def g(c, k):
    return c.get(k, 0)


def pct(a, b):
    return round(100.0 * a / b, 1) if b else None


def summarize(c):
    """Rows the USAGE pane draws: per model, per effort, per side, per project."""
    models = []
    for m in MODELS:
        turns = g(c, f'turns.main.{m}') + g(c, f'turns.sub.{m}')
        if not turns:
            continue
        models.append({
            'model': m, 'turns': turns, 'main': g(c, f'turns.main.{m}'), 'sub': g(c, f'turns.sub.{m}'),
            'out': g(c, f'out.main.{m}') + g(c, f'out.sub.{m}'),
            'cache_in': sum(g(c, f'{k}.{s}.{m}') for k in ('in', 'cread', 'cwrite') for s in ('main', 'sub')),
            'usd': round(g(c, f'usd.main.{m}') + g(c, f'usd.sub.{m}'), 2),
            'usd_main': round(g(c, f'usd.main.{m}'), 2), 'usd_sub': round(g(c, f'usd.sub.{m}'), 2)})
    efforts = collections.defaultdict(lambda: {'turns': 0, 'usd': 0.0})
    for k, v in c.items():
        if k.startswith('effort.'):
            _, side, m, e = k.split('.', 3)
            efforts[f'{m} {e}']['turns'] += v
        elif k.startswith('usd_eff.'):
            _, m, e = k.split('.', 2)
            efforts[f'{m} {e}']['usd'] += v
    eff_rows = sorted(({'key': k, 'turns': v['turns'], 'usd': round(v['usd'], 2)} for k, v in efforts.items()),
                      key=lambda r: -r['usd'])
    projects = sorted(({'project': k.split('.', 1)[1], 'turns': v, 'usd': round(g(c, 'proj_usd.' + k.split('.', 1)[1]), 2)}
                       for k, v in c.items() if k.startswith('proj_turns.')), key=lambda r: -r['usd'])[:12]
    agent_types = sorted(((k.split('.', 1)[1], v) for k, v in c.items() if k.startswith('agent_type.')),
                         key=lambda r: -r[1])
    turns_all = sum(r['turns'] for r in models)
    usd_all = round(sum(r['usd'] for r in models), 2)
    return {
        'turns': turns_all, 'usd': usd_all, 'models': models, 'efforts': eff_rows, 'projects': projects,
        'main_turns': sum(g(c, f'turns.main.{m}') for m in MODELS),
        'sub_turns': sum(g(c, f'turns.sub.{m}') for m in MODELS),
        'agent': {'total': g(c, 'agent_total'), 'with_model': g(c, 'agent_with_model'),
                  'no_model': g(c, 'agent_no_model'), 'background': g(c, 'agent_bg'),
                  'worktree': g(c, 'agent_isolation'), 'types': agent_types[:10],
                  'models': {k.split('.', 1)[1]: v for k, v in c.items() if k.startswith('agent_model.')}},
        'workflow': {'runs': g(c, 'workflow'), 'agent_calls': g(c, 'workflow_agent_calls'),
                     'with_model': g(c, 'workflow_model_total'),
                     'models': {k.split('.', 1)[1]: v for k, v in c.items() if k.startswith('workflow_model.')}},
        'tools': {'plan_mode': g(c, 'tool.EnterPlanMode') + g(c, 'tool.ExitPlanMode'),
                  'goal': g(c, 'slash_goal'), 'loop': g(c, 'slash_loop'), 'monitor': g(c, 'tool.Monitor'),
                  'cron': g(c, 'tool.CronCreate'), 'wakeup': g(c, 'tool.ScheduleWakeup'),
                  'compact_auto': g(c, 'compact_auto'), 'compact_manual': g(c, 'compact_manual') + g(c, 'slash_compact'),
                  'handoff': g(c, 'skill.handoff'), 'spawn_task': g(c, 'tool.spawn_task'),
                  'send_message': g(c, 'tool.send_message'), 'model_cmd': g(c, 'slash_model')},
        'context': {'main_300k': g(c, 'main_turns_ctx300k'), 'main_250k': g(c, 'main_turns_ctx250k'),
                    'opus_main_300k': g(c, 'opus_main_turns_ctx300k'),
                    'opus_main_cread_300k': g(c, 'opus_main_cread_ctx300k')},
        'readonly': {m: g(c, f'readonly.main.{m}') + g(c, f'readonly.sub.{m}') for m in MODELS
                     if g(c, f'readonly.main.{m}') + g(c, f'readonly.sub.{m}')},
    }


def metric_values(c, days):
    sub = sum(g(c, f'turns.sub.{m}') for m in MODELS)
    main = sum(g(c, f'turns.main.{m}') for m in MODELS)
    ro = {m: g(c, f'readonly.main.{m}') + g(c, f'readonly.sub.{m}') for m in MODELS}
    ro_all = sum(ro.values())
    wf_calls = g(c, 'workflow_agent_calls')
    wf_model = min(g(c, 'workflow_model_total'), wf_calls)
    no_model = g(c, 'agent_no_model') + (wf_calls - wf_model)
    opus_main = g(c, 'turns.main.opus')
    sonnet_main = g(c, 'turns.main.sonnet')
    sonnet_main_hi = sum(g(c, f'effort.main.sonnet.{e}') for e in ('high', 'xhigh', 'max'))
    handoffs = g(c, 'skill.handoff')
    autos = g(c, 'compact_auto')
    usd = sum(g(c, f'usd.{s}.{m}') for s in ('main', 'sub') for m in MODELS)
    usd_opus = g(c, 'usd.main.opus') + g(c, 'usd.sub.opus')
    return {
        'sub_no_model': (pct(no_model, g(c, 'agent_total') + wf_calls),
                         f"{no_model} of {g(c, 'agent_total') + wf_calls} calls ({g(c, 'agent_no_model')} Agent, {wf_calls - wf_model} Workflow agent())"),
        'sub_opus_share': (pct(g(c, 'turns.sub.opus'), sub), f"{g(c, 'turns.sub.opus'):,} of {sub:,} subagent turns"),
        'haiku_readonly_share': (pct(ro['haiku'], ro_all), f"{ro['haiku']:,} of {ro_all:,} read-only calls"),
        'opus_readonly_share': (pct(ro['opus'], ro_all), f"{ro['opus']:,} of {ro_all:,} read-only calls"),
        'opus_main_medium': (pct(g(c, 'effort.main.opus.medium'), opus_main),
                             f"{g(c, 'effort.main.opus.medium'):,} of {opus_main:,} Opus main turns"),
        'high_not_architect': (pct(g(c, 'opus_sub_high_not_architect'), g(c, 'turns.sub.opus')),
                               f"{g(c, 'opus_sub_high_not_architect'):,} of {g(c, 'turns.sub.opus'):,} Opus subagent turns"),
        'sonnet_main_high': (pct(sonnet_main_hi, sonnet_main), f"{sonnet_main_hi:,} of {sonnet_main:,} Sonnet main turns"),
        'ctx_big_share': (pct(g(c, 'main_turns_ctx300k'), main), f"{g(c, 'main_turns_ctx300k'):,} of {main:,} main turns"),
        'handoff_ratio': (pct(handoffs, handoffs + autos), f"{handoffs} hand-offs, {autos} auto-compactions"),
        'monitor_cron_per_day': (round((g(c, 'tool.Monitor') + g(c, 'tool.CronCreate') + g(c, 'slash_loop')) / days, 1),
                                 f"Monitor {g(c, 'tool.Monitor')}, CronCreate {g(c, 'tool.CronCreate')}, /loop {g(c, 'slash_loop')} in {days:.1f} days"),
        'workflow_model_share': (pct(wf_model, wf_calls), f"{wf_model} of {wf_calls} agent() calls in {g(c, 'workflow')} runs"),
        'workflow_per_day': (round(g(c, 'workflow') / days, 1), f"{g(c, 'workflow')} runs in {days:.1f} days"),
        'plan_mode': (g(c, 'tool.EnterPlanMode') + g(c, 'tool.ExitPlanMode'), 'Enter/ExitPlanMode calls'),
        'goal_uses': (round(g(c, 'slash_goal') / days, 1), f"{g(c, 'slash_goal')} /goal commands in {days:.1f} days"),
        'plan_agent_calls': (g(c, 'agent_type.Plan'), 'Agent calls with subagent_type Plan'),
        'explore_builtin_per_day': (round(g(c, 'agent_explore_no_model') / days, 1),
                                    f"{g(c, 'agent_explore_no_model')} built-in Explore calls without a model in {days:.1f} days"),
        'architect_calls': (g(c, 'agent_type.architect'), 'Agent calls with subagent_type architect'),
        'opus_cost_share': (pct(usd_opus, usd), f"${usd_opus:,.0f} of ${usd:,.0f} (estimate)"),
    }


def rate(value, m):
    """green / amber / red from the metric's thresholds; info and missing data stay neutral."""
    if value is None:
        return 'none'
    better = m.get('better')
    if better == 'low':
        return 'green' if value <= m['green'] else 'amber' if value <= m['amber'] else 'red'
    if better == 'high':
        return 'green' if value >= m['green'] else 'amber' if value >= m['amber'] else 'red'
    return 'info'


def compute_metrics(c, days, cfg):
    vals = metric_values(c, days)
    out = []
    for m in cfg['metrics']:
        value, detail = vals.get(m['id'], (None, 'not measured'))
        out.append({'id': m['id'], 'label': m['label'], 'unit': m['unit'], 'value': value, 'detail': detail,
                    'state': rate(value, m), 'target': target_text(m), 'rule': m['rule']})
    return out


def target_text(m):
    u = '' if m['unit'] == 'count' else m['unit']
    if m.get('better') == 'low':
        return f"<= {m['green']}{u} (amber <= {m['amber']}{u})"
    if m.get('better') == 'high':
        return f">= {m['green']}{u} (amber >= {m['amber']}{u})"
    return 'info'


# ---------------------------------------------------------------- setup

def front(src):
    out = {}
    if not src.startswith('---'):
        return out
    end = src.find('\n---', 3)
    for line in src[3:end if end > 0 else None].splitlines():
        if ':' in line and not line.startswith((' ', '#')):
            k, v = line.split(':', 1)
            out[k.strip()] = v.strip().strip('"\'')
    return out


def first_line(text, n=160):
    for line in text.splitlines():
        line = line.strip().lstrip('#').strip().strip('"').strip()
        if line and not line.startswith(('---', 'import', '"""', 'from ')):
            return cut(line, n)
    return ''


def cut(s, n):
    s = ' '.join(str(s).split())
    return s if len(s) <= n else s[:n - 1] + '…'


def file_item(name, path, what, flags=None, hidden=False, extra=None):
    exists = os.path.exists(path)
    it = {'name': name, 'path': path.replace('\\', '/'), 'exists': exists,
          'size': os.path.getsize(path) if exists and os.path.isfile(path) else None,
          'changed': iso_mtime(path) if exists else None, 'what': what, 'flags': flags or [], 'hidden': hidden}
    if extra:
        it.update(extra)
    return it


def projects_table(claude_md):
    """Group per repo name from the global CLAUDE.md '# Projects' table (first cell: repo paths, comma-separated)."""
    groups = {}
    sec = re.search(r'^# Projects.*?(?=^# )', claude_md, re.M | re.S)
    for line in (sec.group(0) if sec else '').splitlines():
        cells = [x.strip() for x in line.strip().strip('|').split('|')]
        if len(cells) >= 2 and re.search(r'[\\/]', cells[0]):
            for name in re.split(r',\s*', cells[0]):
                name = re.split(r'[\\/]', re.sub(r'\s*\(.*?\)', '', name).strip())[-1]
                if name:
                    groups[name.lower()] = cells[1]
    return groups


def discover_repos(root):
    """Git repos under projects_root: depth 1, plus depth 2 inside any folder (a repo may hold another one). Worktree, node_modules and dot folders are skipped; one entry per real path."""
    repos, seen = [], set()

    def keep(p):
        real = os.path.realpath(p).lower()
        if real not in seen and os.path.isdir(os.path.join(p, '.git')):  # a .git file = linked worktree, skipped
            seen.add(real)
            repos.append(p)
    try:
        top = sorted(os.listdir(root))
    except OSError:
        return repos
    for name in top:
        p = os.path.join(root, name)
        if not os.path.isdir(p) or name.startswith(('.', '_')):
            continue
        keep(p)
        try:
            subs = sorted(os.listdir(p))
        except OSError:
            continue
        for sub in subs:
            q = os.path.join(p, sub)
            if not sub.startswith(('.', '_')) and sub not in ('node_modules', 'worktrees') and os.path.isdir(q):
                keep(q)
    return repos


def last_activity(repo):
    """Newest of .git/logs/HEAD (commits, checkouts) and .git/index (staging); the .git folder's own mtime moves on
    any tool's read, so it is not used."""
    times = []
    for p in (os.path.join(repo, '.git', 'logs', 'HEAD'), os.path.join(repo, '.git', 'index')):
        try:
            times.append(os.path.getmtime(p))
        except OSError:
            pass
    return max(times) if times else 0


def repo_items(cfg, claude_md, now=None):
    """Repos in the Projects table, plus repos with a rules file touched in the last `active_days`; the rest is
    summed up in one line. Flags: stale clauses, no handoff/PLAN.md (table repos), not in the table (active ones)."""
    groups = projects_table(claude_md)
    stale = [(re.compile(s['pattern'], re.I), s['why']) for s in cfg['stale_clauses']]
    root = expand(cfg['paths']['projects_root'])
    horizon = (now or now_utc()).timestamp() - cfg['scan'].get('active_days', 14) * 86400
    items, quiet = [], []
    for repo in discover_repos(root):
        name = os.path.basename(repo)
        label = os.path.relpath(repo, root).replace('\\', '/')
        parts = label.split('/')
        group = groups.get(name.lower()) if len(parts) == 1 else groups.get(parts[0].lower())
        active = last_activity(repo) >= horizon
        flags, docs = [], []
        for doc in ('CLAUDE.md', 'AGENTS.md', 'LAUNCH.txt'):
            p = os.path.join(repo, doc)
            if not os.path.isfile(p):
                continue
            docs.append(f'{doc} {os.path.getsize(p) / 1024:.1f} KB')
            for line in read_text(p).splitlines():
                for rx, why in stale:
                    if rx.search(line):
                        flags.append({'kind': 'stale_clause', 'text': f'{doc}: "{cut(line.strip(), 90)}" ({why})'})
                        break
        if not group and not active:
            quiet.append(label)
            continue
        if group and not os.path.exists(os.path.join(repo, 'handoff', 'PLAN.md')):
            flags.append({'kind': 'no_plan', 'text': 'no handoff/PLAN.md: status lives in the PR description'})
        if not group:
            flags.append({'kind': 'not_in_table', 'text': 'active in the last 14 days but not in the global Projects table'})
        main_doc = next((os.path.join(repo, d) for d in ('CLAUDE.md', 'AGENTS.md') if os.path.isfile(os.path.join(repo, d))), repo)
        items.append(file_item(label, main_doc,
                               f"{group or 'Other'} · {'active' if active else 'quiet'} · {', '.join(docs) if docs else 'no CLAUDE.md / AGENTS.md'}",
                               flags, hidden=any(f['kind'] == 'stale_clause' for f in flags),
                               extra={'repo': repo.replace('\\', '/'), 'group': group or 'Other', 'active': active}))
    items.sort(key=lambda it: (it['group'] == 'Other', not it['active'], it['name'].lower()))
    if quiet:
        items.append({'name': f'{len(quiet)} quiet repos', 'path': root.replace('\\', '/'), 'exists': True, 'size': None,
                      'changed': None, 'what': 'not in the Projects table, no git activity in 14 days: ' + cut(', '.join(quiet), 300),
                      'flags': [], 'hidden': False})
    return items


def schtasks():
    try:
        r = subprocess.run(['schtasks', '/query', '/fo', 'CSV', '/v'], capture_output=True, text=True, timeout=60,
                           errors='replace')
    except (OSError, subprocess.SubprocessError):
        return None
    rows, seen = [], set()
    for row in csv.reader(io.StringIO(r.stdout)):
        if len(row) < 12 or row[0] == 'HostName' or 'ClaudeControl' not in row[1] or row[1] in seen:
            continue
        seen.add(row[1])
        rows.append({'name': row[1], 'status': row[3], 'last_run': row[5], 'last_result': row[6], 'command': row[8],
                     'enabled': row[11] != 'Disabled' and row[3] != 'Disabled'})
    return rows



BLOCK_TEXT = 'V5 §6: no hook, mod or script may block or rewrite a tool call without Julian\'s yes and a line in CLAUDE.md'


def settings_hooks(path):
    """Every command hook in one settings file: (event, matcher, command)."""
    try:
        data = json.loads(read_text(path) or '{}')
    except ValueError:
        return []
    out = []
    for event, entries in (data.get('hooks') or {}).items():
        for e in entries or []:
            for hk in e.get('hooks') or []:
                out.append((event, e.get('matcher', '*'), hk.get('command') or hk.get('type', '')))
    return out


def blocker_items(cfg, home, settings, repos):
    """Everything that can refuse or rewrite a tool call: settings hooks (user, local, project), plugin hooks, mods
    whose hooks module answers with a deny, hook scripts on disk, permission deny rules. V5 expects none."""
    known = cfg['known_items']
    items = []

    def add(name, path, what, kind='blocker'):
        items.append({'name': name, 'path': str(path).replace('\\', '/'), 'exists': True, 'size': None,
                      'changed': iso_mtime(path) if os.path.exists(path) else None, 'what': what,
                      'flags': [{'kind': kind, 'text': BLOCK_TEXT}], 'hidden': True})
    files = [os.path.join(home, 'settings.json'), os.path.join(home, 'settings.local.json')]
    for repo in repos:
        files += [os.path.join(repo, '.claude', 'settings.json'), os.path.join(repo, '.claude', 'settings.local.json')]
    for f in files:
        for event, matcher, cmd in settings_hooks(f):
            script = re.search(r'[\w./\\:-]+\.(py|ps1|js|sh|cmd)', cmd)
            base = os.path.basename(script.group(0)) if script else cmd
            add(f'settings hook {event}[{matcher}] {cut(base, 60)}', f, known.get(base) or cut(cmd, 160))
    # synced plugins are installed for the account; a marketplace plugin only counts once enabledPlugins turns it on
    enabled = {k for k, v in (settings.get('enabledPlugins') or {}).items() if v}
    market = [d for d in sorted(glob.glob(os.path.join(home, 'plugins', 'marketplaces', '*', 'plugins', '*', 'hooks')))
              if f"{os.path.basename(os.path.dirname(d))}@{os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(d))))}" in enabled]
    for d in sorted(glob.glob(os.path.join(home, 'plugins', 'synced', '*', '*', 'hooks'))) + market:
        hj = os.path.join(d, 'hooks.json')
        if os.path.isfile(hj):
            root = os.path.dirname(d)
            try:
                name = json.loads(read_text(os.path.join(root, '.claude-plugin', 'plugin.json'))).get('name')
            except ValueError:
                name = None
            add(f'plugin hooks {name or os.path.basename(root)}', hj,
                'plugin hooks.json: runs on events when the plugin is enabled · ' + cut(read_text(hj, 300), 140))
    loaded = [os.path.normpath(expand(x)).lower() for x in
              (settings.get('env') or {}).get('CLAUDE_CODE_PLUGIN_DIRS', '').split(';') if x]
    for folder in sorted(glob.glob(os.path.join(home, 'mods', '*'))):
        hits = []
        for src in glob.glob(os.path.join(folder, 'hooks', '*')):
            if os.path.splitext(src)[1] not in ('.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.jsx'):
                continue
            for n, line in enumerate(read_text(src).splitlines(), 1):
                if re.search(r'\bdeny\s*:|\{\s*deny\b', line):
                    hits.append(f'{os.path.basename(src)}:{n}')
        if hits:
            state = 'LOADED' if os.path.normpath(folder).lower() in loaded else 'installed, not loaded'
            add(f'mod deny path {os.path.basename(folder)} ({state})', folder,
                f"{len(hits)} deny answer(s): {', '.join(hits[:6])}", 'blocker' if state == 'LOADED' else 'blocker_idle')
    for p in sorted(glob.glob(os.path.join(home, 'hooks', '*'))):
        if os.path.isfile(p):
            add(f'hook script {os.path.basename(p)}', p, known.get(os.path.basename(p)) or first_line(read_text(p, 2000)))
    for rule in (settings.get('permissions') or {}).get('deny') or []:
        add(f'permission deny {cut(rule, 80)}', os.path.join(home, 'settings.json'), 'refuses matching tool calls')
    return items


def permission_items(home, settings):
    sp = os.path.join(home, 'settings.json')
    perms = settings.get('permissions') or {}
    out = [{'name': f"defaultMode {perms.get('defaultMode', 'default')}", 'path': sp.replace('\\', '/'), 'exists': True,
            'size': None, 'changed': iso_mtime(sp), 'what': 'Permission mode every session starts in.', 'flags': [],
            'hidden': perms.get('defaultMode') == 'bypassPermissions'}]
    for kind in ('allow', 'ask', 'deny'):
        for rule in perms.get(kind) or []:
            out.append({'name': f'{kind} {cut(rule, 100)}', 'path': sp.replace('\\', '/'), 'exists': True, 'size': None,
                        'changed': None, 'what': {'allow': 'runs without asking', 'ask': 'always asks',
                                                  'deny': 'refused'}[kind], 'flags': [], 'hidden': kind == 'deny'})
    return out


def memory_items(home, repos):
    """Claude's local memory per project folder (~/.claude/projects/*/memory) and each repo's handoff/MEMORY.md."""
    out = []
    for d in sorted(glob.glob(os.path.join(home, 'projects', '*', 'memory'))):
        notes = [f for f in glob.glob(os.path.join(d, '*.md')) if os.path.basename(f) != 'MEMORY.md']
        if not notes:
            continue
        idx = os.path.join(d, 'MEMORY.md')
        out.append(file_item(f"memory {os.path.basename(os.path.dirname(d))}", idx if os.path.exists(idx) else d,
                             f'{len(notes)} notes loaded into every session started in that folder (MEMORY.md index)',
                             hidden=True))
    for repo in repos:
        p = os.path.join(repo, 'handoff', 'MEMORY.md')
        if os.path.isfile(p):
            out.append(file_item(f'handoff/MEMORY.md {os.path.basename(repo)}', p, 'repo lessons (handoff skill)'))
    return out


def scan_setup(cfg, out_dir, run_schtasks=True):
    home = expand(cfg['paths']['claude_home'])
    known = cfg['known_items']
    sections = []
    try:
        settings = json.loads(read_text(os.path.join(home, 'settings.json')) or '{}')
    except ValueError:
        settings = {}
    claude_md = read_text(os.path.join(home, 'CLAUDE.md'))

    # settings.json
    st = []
    sp = os.path.join(home, 'settings.json')
    perms = settings.get('permissions') or {}
    st.append(file_item('settings.json', sp,
                        f"permissions {perms.get('defaultMode', 'default')} · {len(perms.get('allow') or [])} allow · "
                        f"{len(perms.get('deny') or [])} deny · output style {settings.get('outputStyle', 'default')}"))
    for k, v in (settings.get('env') or {}).items():
        why = cfg['hidden_env'].get(k)
        st.append({'name': f'env {k}={v}', 'path': sp.replace('\\', '/'), 'exists': True, 'size': None,
                   'changed': iso_mtime(sp), 'what': why or 'Environment variable for every session.',
                   'flags': [], 'hidden': bool(why)})
    if settings.get('outputStyle'):
        st.append({'name': f"outputStyle {settings['outputStyle']}", 'path': sp.replace('\\', '/'), 'exists': True,
                   'size': None, 'changed': iso_mtime(sp), 'what': 'Changes how every session answers and acts.',
                   'flags': [], 'hidden': True})
    sections.append({'id': 'settings', 'title': 'settings.json', 'items': st})
    sections.append({'id': 'permissions', 'title': 'Permissions (settings.json)', 'items': permission_items(home, settings)})

    # global CLAUDE.md
    heads = re.findall(r'^# (.+)$', claude_md, re.M)
    version = (claude_md.splitlines() or [''])[0].lstrip('# ').strip()
    cm = [file_item('CLAUDE.md (global)', os.path.join(home, 'CLAUDE.md'), f'{version} · {len(heads)} sections')]
    for h in heads:
        cm.append({'name': f'§ {h}', 'path': os.path.join(home, 'CLAUDE.md').replace('\\', '/'), 'exists': True,
                   'size': None, 'changed': None, 'what': cut(section_first_line(claude_md, h), 150), 'flags': [],
                   'hidden': False})
    sections.append({'id': 'claude_md', 'title': 'Global CLAUDE.md', 'items': cm})

    # repos
    sections.append({'id': 'repos', 'title': 'Repos under ' + cfg['paths']['projects_root'], 'items': repo_items(cfg, claude_md)})

    # agents
    ag = []
    for p in sorted(glob.glob(os.path.join(home, 'agents', '*.md'))):
        fm = front(read_text(p, 4000))
        model = fm.get('model') or 'inherits (CLAUDE_CODE_SUBAGENT_MODEL)'
        ag.append(file_item(fm.get('name') or os.path.basename(p), p,
                            f"{model} · effort {fm.get('effort', 'default')} · {cut(fm.get('description', ''), 110)}",
                            extra={'model': model, 'effort': fm.get('effort', 'default')}))
    sections.append({'id': 'agents', 'title': 'Agents (~/.claude/agents)', 'items': ag})

    # skills: user, synced, plugin
    sk = []
    for p in sorted(glob.glob(os.path.join(home, 'skills', '*', 'SKILL.md'))) + \
            sorted(glob.glob(os.path.join(home, 'skills', 'synced', '*', '*', 'SKILL.md'))):
        fm = front(read_text(p, 4000))
        where = 'synced' if os.sep + 'synced' + os.sep in p else 'user'
        sk.append(file_item(fm.get('name') or os.path.basename(os.path.dirname(p)), p,
                            f"{where} · {cut(fm.get('description', ''), 130)}"))
    sections.append({'id': 'skills', 'title': 'Skills', 'items': sk})

    # hooks folder
    hk = []
    for p in sorted(glob.glob(os.path.join(home, 'hooks', '*'))):
        if os.path.isfile(p):
            hk.append(file_item(os.path.basename(p), p, known.get(os.path.basename(p)) or first_line(read_text(p, 2000)),
                                hidden=True))
    sections.append({'id': 'hooks', 'title': 'Hook scripts (~/.claude/hooks)', 'items': hk})

    # mods
    loaded = [expand(x) for x in re.split(r'[;]', (settings.get('env') or {}).get('CLAUDE_CODE_PLUGIN_DIRS', '')) if x]
    md = []
    for folder in sorted(glob.glob(os.path.join(home, 'mods', '*'))) + sorted(glob.glob(os.path.join(home, 'dev-mods', '*', '*'))):
        man = os.path.join(folder, '.claude-plugin', 'plugin.json')
        if not os.path.isfile(man):
            continue
        try:
            info = json.loads(read_text(man))
        except ValueError:
            info = {}
        kind = 'dev-mod (hot reload in its own session)' if 'dev-mods' in folder else (
            'loaded by CLAUDE_CODE_PLUGIN_DIRS' if os.path.normpath(folder) in loaded else 'installed, not loaded')
        md.append(file_item(f"{info.get('name', os.path.basename(folder))} {info.get('version', '')}".strip(), man,
                            f"{kind} · {cut(info.get('description') or known.get(info.get('name', ''), ''), 120)}",
                            hidden=kind.startswith('loaded')))
    sections.append({'id': 'mods', 'title': 'Mods', 'items': md})

    # scheduled tasks
    sch = []
    tasks = schtasks() if run_schtasks else []
    for t in tasks or []:
        sch.append({'name': t['name'], 'path': t['command'], 'exists': True, 'size': None, 'changed': t['last_run'],
                    'what': f"{'Enabled' if t['enabled'] else 'Disabled'} · last run {t['last_run']} (result {t['last_result']})",
                    'flags': [] if t['enabled'] else [{'kind': 'disabled', 'text': 'Disabled'}],
                    'hidden': not t['enabled'] and 'watch' in t['command'].lower(), 'enabled': t['enabled']})
    if tasks is None:
        sch.append({'name': 'Windows tasks', 'path': 'schtasks', 'exists': False, 'size': None, 'changed': None,
                    'what': 'schtasks could not be read', 'flags': [], 'hidden': False})
    if tasks and not any(t['enabled'] for t in tasks):
        sch.append({'name': 'watch.py', 'path': os.path.join(home, 'effort-board', 'watch.py').replace('\\', '/'),
                    'exists': True, 'size': None, 'changed': None, 'what': known.get('watch.py', ''),
                    'flags': [{'kind': 'disabled', 'text': 'all ClaudeControl* tasks disabled'}], 'hidden': True})
    for p in sorted(glob.glob(os.path.join(home, 'scheduled-tasks', '*', 'SKILL.md'))):
        fm = front(read_text(p, 3000))
        desc = fm.get('description', '')
        paused = bool(re.search(r'paused|legacy|replaced|disabled', desc, re.I))
        sch.append(file_item(fm.get('name') or os.path.basename(os.path.dirname(p)), p,
                             f"app scheduled task · {cut(desc, 120)}",
                             flags=[{'kind': 'paused', 'text': 'paused'}] if paused else []))
    sections.append({'id': 'scheduled', 'title': 'Scheduled tasks', 'items': sch})

    # MCP servers and plugins
    mc = []
    cj = expand('~/.claude.json')
    try:
        cjd = json.loads(read_text(cj) or '{}')
    except ValueError:
        cjd = {}
    for name, s in (cjd.get('mcpServers') or {}).items():
        mc.append(file_item(f'mcp {name}', cj, f"user scope · {s.get('type', 'stdio')} · {cut(s.get('command') or s.get('url') or '', 90)}"))
    for proj, pd in (cjd.get('projects') or {}).items():
        for name, s in (pd.get('mcpServers') or {}).items():
            mc.append(file_item(f'mcp {name}', cj, f"project {proj} · {cut(s.get('command') or s.get('url') or '', 80)}"))
    desk = os.path.join(os.environ.get('APPDATA', ''), 'Claude', 'claude_desktop_config.json')
    try:
        dd = json.loads(read_text(desk) or '{}')
    except ValueError:
        dd = {}
    for name, s in (dd.get('mcpServers') or {}).items():
        mc.append(file_item(f'mcp {name}', desk, f"desktop app · {cut(s.get('command') or s.get('url') or '', 90)}"))
    for man in sorted(glob.glob(os.path.join(home, 'plugins', 'synced', '*', '*', '.claude-plugin', 'plugin.json'))):
        try:
            info = json.loads(read_text(man))
        except ValueError:
            info = {}
        root = os.path.dirname(os.path.dirname(man))
        skills = [os.path.basename(x) for x in glob.glob(os.path.join(root, 'skills', '*'))]
        has_hooks = os.path.exists(os.path.join(root, 'hooks'))
        mc.append(file_item(f"plugin {info.get('name', os.path.basename(root))}", man,
                            f"synced · {cut(info.get('description', ''), 80)}"
                            + (f" · skills: {', '.join(skills[:6])}" if skills else '') + (' · has hooks' if has_hooks else ''),
                            hidden=has_hooks))
    for p in sorted(glob.glob(os.path.join(home, 'plugins', 'known_marketplaces.json'))):
        try:
            names = list(json.loads(read_text(p)).keys())
        except ValueError:
            names = []
        mc.append(file_item('marketplaces', p, ', '.join(names) or 'none'))
    sections.append({'id': 'mcp', 'title': 'MCP servers and plugins', 'items': mc})

    repos = discover_repos(expand(cfg['paths']['projects_root']))
    sections.append({'id': 'memory', 'title': 'Memory files', 'items': memory_items(home, repos)})
    blockers = blocker_items(cfg, home, settings, repos)
    hidden = [dict(it, section=s['title']) for s in sections for it in s['items'] if it.get('hidden')]
    data = {'generated': now_utc().strftime('%Y-%m-%dT%H:%M:%SZ'), 'rules_version': version,
            'sections': sections, 'hidden': hidden, 'blockers': blockers,
            'active_blockers': sum(1 for b in blockers if b['flags'][0]['kind'] == 'blocker'),
            'counts': {s['id']: len(s['items']) for s in sections}}
    write_json(os.path.join(out_dir, 'setup.json'), data)
    return data


def section_first_line(md, head):
    m = re.search(r'^# ' + re.escape(head) + r'\s*\n(.*?)(?=^# |\Z)', md, re.M | re.S)
    if not m:
        return ''
    for line in m.group(1).splitlines():
        line = line.strip().lstrip('-*').strip()
        if line and not line.startswith('|'):
            return re.sub(r'\*\*', '', line)
    return ''


# ---------------------------------------------------------------- practices

def audit_lists(report):
    """Bullets of '## 5. What we do right' and '## 6. What we do wrong'."""
    def grab(title_rx):
        m = re.search(r'^## \d+\.\s*' + title_rx + r'.*?\n(.*?)(?=^## |\Z)', report, re.M | re.S | re.I)
        if not m:
            return []
        out = []
        for line in m.group(1).splitlines():
            line = re.sub(r'^\s*(?:[-*]|\d+\.)\s*', '', line).strip()
            if line:
                out.append(cut(re.sub(r'\*\*', '', line), 200))
        return out
    return grab('What we do right'), grab('What we do wrong')


def score(m):
    """How far a metric is past (or inside) its green target, signed so that higher = better habit."""
    v = m['value']
    t = m.get('_cfg') or {}
    if v is None or t.get('better') not in ('low', 'high'):
        return None
    span = abs(t['amber'] - t['green']) or 1
    return (t['green'] - v) / span if t['better'] == 'low' else (v - t['green']) / span


def scan_practices(cfg, out_dir, usage=None, setup=None):
    home = expand(cfg['paths']['claude_home'])
    claude_md = read_text(os.path.join(home, 'CLAUDE.md'))
    report = read_text(expand(cfg['paths']['audit_report']))
    if usage is None:
        try:
            usage = json.loads(read_text(os.path.join(out_dir, 'usage.json')))
        except ValueError:
            usage = None
    if setup is None:
        try:
            setup = json.loads(read_text(os.path.join(out_dir, 'setup.json')))
        except ValueError:
            setup = None
    win = next((w for w in (usage or {}).get('windows', []) if w['id'] == '7d'), None)
    by_id = {}
    if win:
        mcfg = {m['id']: m for m in cfg['metrics']}
        for m in win['metrics']:
            by_id[m['id']] = dict(m, _cfg=mcfg.get(m['id']))
    flagged = {}
    if setup:
        for b in setup.get('blockers', []):
            for f in b.get('flags', []):
                flagged.setdefault(f['kind'], []).append(f"{b['name']}: {b['what']}")
        for s in setup['sections']:
            for it in s['items']:
                for f in it.get('flags', []):
                    flagged.setdefault(f['kind'], []).append(f"{it['name']}: {f['text']}")
    order = {'red': 0, 'amber': 1, 'green': 2}
    items = []
    for p in cfg['practices']:
        m = re.search(p['find'], claude_md, re.I)
        line = ''
        if m:
            start = claude_md.rfind('\n', 0, m.start()) + 1
            end = claude_md.find('\n', m.end())
            line = cut(re.sub(r'\*\*', '', claude_md[start:end if end > 0 else None].strip().lstrip('-').strip()), 260)
        linked = [by_id[i] for i in p['metrics'] if i in by_id]
        rated = [x['state'] for x in linked if x['state'] in order]
        state = min(rated, key=lambda s: order[s]) if rated else 'not measured'
        evidence = [f"{x['label']}: {fmt(x)} ({x['state']})" for x in linked]
        if p.get('setup_flag'):
            hits = flagged.get(p['setup_flag'], [])
            state = 'red' if hits else 'green'
            evidence += hits[:5] or [f"no {p['setup_flag'].replace('_', ' ')} found by SETUP"]
        items.append({'id': p['id'], 'title': p['title'], 'rule_line': line or 'not found in CLAUDE.md',
                      'in_rules': bool(m), 'state': state, 'metrics': p['metrics'], 'evidence': evidence})
    scored = [(score(m), m) for m in by_id.values()]
    scored = [(s, m) for s, m in scored if s is not None]
    best = [f"{m['label']}: {fmt(m)} (target {m['target']})" for s, m in sorted(scored, key=lambda x: -x[0]) if m['state'] == 'green'][:5]
    worst = [f"{m['label']}: {fmt(m)} (target {m['target']})" for s, m in sorted(scored, key=lambda x: x[0]) if m['state'] in ('red', 'amber')][:5]
    right, wrong = audit_lists(report)
    data = {'generated': now_utc().strftime('%Y-%m-%dT%H:%M:%SZ'), 'window': win['label'] if win else None,
            'rules_version': (claude_md.splitlines() or [''])[0].lstrip('# ').strip(),
            'practices': items, 'best': best, 'worst': worst,
            'audit_right': right[:5], 'audit_wrong': wrong[:5],
            'reference_md': read_text(expand(cfg['paths'].get('practices_md', ''))) if cfg['paths'].get('practices_md') else '',
            'history_md': read_text(expand(cfg['paths'].get('history_md', ''))) if cfg['paths'].get('history_md') else ''}
    write_json(os.path.join(out_dir, 'practices.json'), data)
    return data


def fmt(m):
    v = m['value']
    if v is None:
        return 'n/a'
    return f"{v}%" if m['unit'] == '%' else f"{v}{m['unit']}" if m['unit'] == '/day' else f"{v}"


def main(argv):
    what = argv[1] if len(argv) > 1 and not argv[1].startswith('--') else 'all'
    cfg_path = argv[argv.index('--config') + 1] if '--config' in argv else None
    cfg = load_config(cfg_path)
    out = expand(argv[argv.index('--out') + 1]) if '--out' in argv else expand(cfg['paths']['out_dir'])
    os.makedirs(out, exist_ok=True)
    usage = setup = None
    if what in ('usage', 'all'):
        usage = scan_usage(cfg, out)
    if what in ('setup', 'all'):
        setup = scan_setup(cfg, out)
    if what in ('practices', 'all', 'usage', 'setup'):
        scan_practices(cfg, out, usage, setup)
    print(json.dumps({'ok': True, 'what': what, 'out': out.replace('\\', '/')}))


if __name__ == '__main__':
    main(sys.argv)
