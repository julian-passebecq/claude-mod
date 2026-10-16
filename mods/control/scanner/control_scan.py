"""Scanner behind the `control` mod: python -I control_scan.py [usage|setup|practices|all] [--config PATH] [--out DIR]

usage      transcripts (~/.claude/projects/**/*.jsonl, subagents included) -> usage.json: counters per window and
           the metrics of config.json with a red/amber/green state. Counting follows
           docs/audits/2026-10-09-night/usage_scan.py (validated 2-9 Oct): assistant records de-duplicated by message.id
           per file, bench runs and the scratch cwd excluded. Counters are kept per file and per UTC hour in
           usage_cache.json, so a rescan only re-reads files whose size or mtime changed.
setup      everything that shapes a session, read live (settings env names and hooks, CLAUDE.md title and version,
           agents, skills, workflows, mods loaded or not, tasks, MCP, plugins) -> setup.json, hidden rules flagged.
           Settings values are never written except for the names in config secrets.show_values.
practices  the live ~/.claude/CLAUDE.md headings, each line with the evidence it cites, + usage.json metrics, the audit
           REPORT.md and the rules repo's pending V6-CHANGES.md (git show <ref>:path) -> practices.json.
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


def deep_merge(base, over):
    """Objects merge key by key; anything else (lists included) is replaced by the override."""
    if not isinstance(base, dict) or not isinstance(over, dict):
        return over
    out = dict(base)
    for k, v in over.items():
        if not k.startswith('_'):
            out[k] = deep_merge(base.get(k), v) if k in base else v
    return out


def load_config(path=None, user_override=True):
    """config.json next to the mod, then the user's override file (paths.user_config) merged on top."""
    with open(path or DEFAULT_CONFIG, encoding='utf8') as f:
        cfg = json.load(f)
    user = cfg.get('paths', {}).get('user_config')
    if user_override and user and os.path.isfile(expand(user)):
        try:
            with open(expand(user), encoding='utf8') as f:
                cfg = deep_merge(cfg, json.load(f))
        except (OSError, ValueError):
            pass
    return cfg


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

    rules = parse_rules(read_text(os.path.join(expand(cfg['paths']['claude_home']), 'CLAUDE.md')), cfg)
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
                        'counters': tot, 'summary': summarize(tot), 'metrics': compute_metrics(tot, days, cfg, rules)})
    data = {'generated': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'files': len(files), 'rescanned': rescanned,
            'rules_version': rules['title'], 'version': rules['version'],
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


def metric_rule(m, rules):
    """'§3 Models and effort: <live line>' when rule_find matches the live rules, else the config text marked as
    not in the live rules."""
    ref = rule_ref(rules or {}, m.get('rule_find'))
    if ref:
        return ref
    return f"{m.get('rule', '')} (not in the live rules)" if m.get('rule_find') else m.get('rule', '')


def compute_metrics(c, days, cfg, rules=None):
    vals = metric_values(c, days)
    out = []
    for m in cfg['metrics']:
        value, detail = vals.get(m['id'], (None, 'not measured'))
        out.append({'id': m['id'], 'label': m['label'], 'unit': m['unit'], 'value': value, 'detail': detail,
                    'state': rate(value, m), 'target': target_text(m), 'rule': metric_rule(m, rules)})
    return out


def target_text(m):
    u = '' if m['unit'] == 'count' else m['unit']
    if m.get('better') == 'low':
        return f"<= {m['green']}{u} (amber <= {m['amber']}{u})"
    if m.get('better') == 'high':
        return f">= {m['green']}{u} (amber >= {m['amber']}{u})"
    return 'info'


# ---------------------------------------------------------------- live rules (no version is hard-coded)

def rules_cfg(cfg):
    r = cfg.get('rules') or {}
    return {'version_regex': r.get('version_regex', r'\bV(\d+(?:\.\d+)*)\b'),
            'section_regex': r.get('section_regex', r'^# (.+)$'),
            'citation_regex': r.get('citation_regex', r'\d{4}|\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)'),
            'practices_ref_regex': r.get('practices_ref_regex', r'PRACTICES\s+([A-Z]\d{1,2})\b')}


def clean(line):
    line = re.sub(r'\*\*|`', '', line.strip())
    return re.sub(r'^(?:[-*+]|\d+\.)\s+', '', line).strip()


def parse_rules(md, cfg):
    """The live rules file -> title line, version ('5.8'), and one entry per section heading with its lines and the
    evidence each line cites (parenthesised dates, PR numbers, audits, quotes)."""
    rc = rules_cfg(cfg)
    lines = md.replace('\r\n', '\n').split('\n')
    title = next((ln.lstrip('#').strip() for ln in lines if ln.strip()), '')
    vm = re.search(rc['version_regex'], title)
    sec_rx, cite_rx = re.compile(rc['section_regex']), re.compile(rc['citation_regex'], re.I)
    sections, cur = [], None
    for ln in lines[1:] if lines else []:
        m = sec_rx.match(ln)
        if m:
            head = m.group(1).strip()
            nm = re.match(r'(\d+)\.\s*(.*)', head)
            cur = {'num': nm.group(1) if nm else '', 'title': nm.group(2) if nm else head, 'heading': head, 'lines': []}
            sections.append(cur)
            continue
        text = clean(ln)
        if cur is None or not text or re.fullmatch(r'[|:\- ]+', text):
            continue
        if text.startswith('|'):
            text = ' · '.join(c.strip() for c in text.strip('|').split('|') if c.strip())
        cites = [c.strip() for c in re.findall(r'\(([^()]+)\)', text) if cite_rx.search(c)]
        cur['lines'].append({'text': text, 'citations': cites})
    return {'title': title, 'version': vm.group(1) if vm else '', 'label': f'V{vm.group(1)}' if vm else '',
            'sections': sections}


def rule_ref(rules, find):
    """'§3 Models and effort: <line>' for the first live line matching `find`; '' when the live rules lack it."""
    if not find:
        return ''
    rx = re.compile(find, re.I)
    for s in rules.get('sections', []):
        for ln in s['lines']:
            if rx.search(ln['text']):
                return f"§{s['num'] or s['heading']} {s['title']}: {cut(ln['text'], 200)}"
    return ''


def practices_lines(practices_md, ref_id):
    """Lines of docs/PRACTICES.md that define an evidence id such as B2."""
    out = []
    for ln in practices_md.splitlines():
        t = clean(ln)
        if re.match(r'\**' + re.escape(ref_id) + r'\b', t):
            out.append(cut(t, 220))
    return out[:3]


def secret_name(name, cfg):
    return bool(re.search((cfg.get('secrets') or {}).get('name_regex', r'KEY|TOKEN|SECRET|PASS|AUTH|CRED|COOKIE'),
                          name, re.I))


def env_value(name, value, cfg):
    """Settings values are shown only for the names listed in secrets.show_values and never for a secret-looking
    name; everything else shows as its name only."""
    sec = cfg.get('secrets') or {}
    if secret_name(name, cfg) or name not in (sec.get('show_values') or []):
        return None
    return cut(str(value), 200)


def strip_secrets(s):
    """Command lines and URLs from MCP configs: no query string, no user:password@, no token-looking argument."""
    s = re.sub(r'(https?://)[^/@\s]+@', r'\1', str(s))
    s = re.sub(r'\?\S*', '?…', s)
    return re.sub(r'(--?[\w-]*(?:key|token|secret|pass)[\w-]*[= ])\S+', r'\1…', s, flags=re.I)


def plugin_dirs(value):
    return [x.strip() for x in re.split(r';' if os.name == 'nt' else r'[;:]', value or '') if x.strip()]


def norm(p):
    return os.path.normcase(os.path.normpath(expand(p)))


def mod_states(cfg, home, settings, environ=None):
    """Every mod folder we can see and whether it is loaded: listed in CLAUDE_CODE_PLUGIN_DIRS (this process's env, the
    one sessions started from here get, and settings.json env, the one the desktop app gives new sessions), installed
    in ~/.claude/mods or beside this mod but not loaded, or a dev-mod of one desktop session."""
    environ = os.environ if environ is None else environ
    mcfg = cfg.get('mods') or {}
    from_settings = plugin_dirs((settings.get('env') or {}).get('CLAUDE_CODE_PLUGIN_DIRS'))
    from_env = plugin_dirs(environ.get('CLAUDE_CODE_PLUGIN_DIRS'))
    loaded = {}
    for src, dirs in (('settings.json env', from_settings), ('environment of this session', from_env)):
        for d in dirs:
            loaded.setdefault(norm(d), (d, []))[1].append(src)
    folders = [(d, 'loaded') for _, (d, _) in loaded.items()]
    roots = [os.path.join(home, 'mods')] + [os.path.join(os.path.dirname(os.path.dirname(HERE)), '')
                                            if r == '@repo' else r for r in mcfg.get('extra_roots', ['@repo'])]
    for r in roots:
        for f in sorted(glob.glob(os.path.join(expand(r), '*'))):
            if os.path.isfile(os.path.join(f, '.claude-plugin', 'plugin.json')):
                folders.append((f, 'installed'))
    if mcfg.get('show_dev_mods', True):
        for f in sorted(glob.glob(os.path.join(home, 'dev-mods', '*', '*'))):
            if os.path.isfile(os.path.join(f, '.claude-plugin', 'plugin.json')):
                folders.append((f, 'dev'))
    out, seen = [], set()
    for folder, kind in folders:
        key = norm(folder)
        if key in seen:
            continue
        seen.add(key)
        man = os.path.join(expand(folder), '.claude-plugin', 'plugin.json')
        try:
            info = json.loads(read_text(man) or '{}')
        except ValueError:
            info = {}
        exists = os.path.isfile(man)
        if key in loaded:
            state = 'loaded' if exists else 'missing'
        else:
            state = 'dev' if kind == 'dev' else 'installed'
        out.append({'name': info.get('name') or os.path.basename(os.path.normpath(folder)),
                    'version': info.get('version', ''), 'path': expand(folder).replace('\\', '/'), 'state': state,
                    'sources': loaded.get(key, (None, []))[1],
                    'description': cut(info.get('description', ''), 160)})
    names = {m['name'] for m in out if m['state'] == 'loaded'}
    for m in out:
        if m['state'] == 'installed' and m['name'] in names:
            m['state'] = 'shadowed'
    order = {'loaded': 0, 'missing': 1, 'installed': 2, 'shadowed': 3, 'dev': 4}
    out.sort(key=lambda m: (order[m['state']], m['name'].lower()))
    return {'items': out, 'settings_dirs': len(from_settings), 'env_dirs': len(from_env),
            'differ': sorted(map(norm, from_settings)) != sorted(map(norm, from_env)) and bool(from_env)}


def git_show(repo, ref, path):
    try:
        r = subprocess.run(['git', '-C', repo, 'show', f'{ref}:{path}'], capture_output=True, text=True, timeout=30,
                           encoding='utf8', errors='replace')
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout if r.returncode == 0 else None


def parse_changes(md, cfg):
    """V6-CHANGES.md -> kept / changed / dropped, from headings or table rows whose words match v6.groups."""
    groups = (cfg.get('v6') or {}).get('groups') or {
        'kept': ['kept', 'keep', 'gardé', 'garder', 'conservé', 'inchangé'],
        'changed': ['changed', 'change', 'modifié', 'changé', 'new', 'nouveau', 'ajouté'],
        'dropped': ['dropped', 'drop', 'removed', 'supprimé', 'abandonné', 'retiré']}

    def kind(text):
        low = text.lower()
        for g, words in groups.items():
            if any(re.search(r'\b' + re.escape(w) + r'\b', low) for w in words):
                return g
        return None
    out = {g: [] for g in groups}
    cur = None
    for ln in md.replace('\r\n', '\n').split('\n'):
        h = re.match(r'#{1,4}\s+(.+)', ln)
        if h:
            cur = kind(h.group(1))
            continue
        t = ln.strip()
        if t.startswith('|') and not re.fullmatch(r'[|:\- ]+', t):
            cells = [c.strip() for c in t.strip('|').split('|')]
            k = next((kind(c) for c in cells[1:] if kind(c)), None)
            if k:
                out[k].append(cut(clean(cells[0]), 160))
                continue
        if cur and re.match(r'(?:[-*+]|\d+\.)\s+', t):
            out[cur].append(cut(clean(t), 200))
    title = next((ln.lstrip('#').strip() for ln in md.splitlines() if ln.strip()), '')
    return {'title': title, 'groups': {g: {'count': len(v), 'items': v[:8]} for g, v in out.items()}}


def read_v6(cfg):
    v = cfg.get('v6') or {}
    repo = expand(v.get('repo') or '')
    if not repo or '<' in repo or not os.path.isdir(repo):
        return {'state': 'no_repo', 'repo': v.get('repo', '')}
    for ref in v.get('refs', ['origin/main', 'main']):
        md = git_show(repo, ref, v.get('path', 'docs/V6-CHANGES.md'))
        if md:
            return dict(parse_changes(md, cfg), state='pending', source=f"{ref}:{v.get('path', 'docs/V6-CHANGES.md')}")
    return {'state': 'none', 'source': ' | '.join(f"{r}:{v.get('path', 'docs/V6-CHANGES.md')}" for r in v.get('refs', ['origin/main', 'main']))}


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



BLOCK_TEXT = 'Visible rules: nothing may block or rewrite a tool call unless the rules file says so'


def block_text(cfg, rules=None):
    """The blocker flag text: config labels.blocker_flag, followed by the live rule line that forbids blockers."""
    base = ((cfg.get('labels') or {}).get('blocker_flag')) or BLOCK_TEXT
    ref = rule_ref(rules or {}, (cfg.get('rules') or {}).get('blocker_rule_find', r'No hidden blockers'))
    return f'{base} ({ref})' if ref else base


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


def blocker_items(cfg, home, settings, repos, rules=None):
    """Everything that can refuse or rewrite a tool call: settings hooks (user, local, project), plugin hooks, mods
    whose hooks module answers with a deny, hook scripts on disk, permission deny rules. The rules expect none."""
    known = cfg['known_items']
    items = []
    text = block_text(cfg, rules)

    def add(name, path, what, kind='blocker'):
        items.append({'name': name, 'path': str(path).replace('\\', '/'), 'exists': True, 'size': None,
                      'changed': iso_mtime(path) if os.path.exists(path) else None, 'what': what,
                      'flags': [{'kind': kind, 'text': text}], 'hidden': True})
    files = [os.path.join(home, 'settings.json'), os.path.join(home, 'settings.local.json')]
    for repo in repos:
        files += [os.path.join(repo, '.claude', 'settings.json'), os.path.join(repo, '.claude', 'settings.local.json')]
    for f in files:
        for event, matcher, cmd in settings_hooks(f):
            script = re.search(r'[\w./\\:-]+\.(py|ps1|js|sh|cmd)', cmd)
            base = os.path.basename(script.group(0)) if script else cmd
            add(f'settings hook {event}[{matcher}] {cut(base, 60)}', f, known.get(base) or cut(strip_secrets(cmd), 160))
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
    loaded = {norm(x) for x in plugin_dirs((settings.get('env') or {}).get('CLAUDE_CODE_PLUGIN_DIRS'))
              + plugin_dirs(os.environ.get('CLAUDE_CODE_PLUGIN_DIRS'))}
    folders = sorted(glob.glob(os.path.join(home, 'mods', '*')))
    folders += [expand(x) for x in loaded if norm(x) not in {norm(f) for f in folders}]
    for folder in folders:
        hits = []
        for src in glob.glob(os.path.join(folder, 'hooks', '*')):
            if os.path.splitext(src)[1] not in ('.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.jsx'):
                continue
            for n, line in enumerate(read_text(src).splitlines(), 1):
                if re.search(r'\bdeny\s*:|\{\s*deny\b', line):
                    hits.append(f'{os.path.basename(src)}:{n}')
        if hits:
            state = 'LOADED' if norm(folder) in loaded else 'installed, not loaded'
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


def sec_title(cfg, sid, default):
    return ((cfg.get('labels') or {}).get('sections') or {}).get(sid, default)


def workflow_items(home):
    out = []
    for p in sorted(glob.glob(os.path.join(home, 'workflows', '*'))):
        if os.path.splitext(p)[1] not in ('.js', '.mjs', '.ts', '.cjs'):
            continue
        src = read_text(p, 6000)
        name = re.search(r"name:\s*['\"]([^'\"]+)", src)
        desc = re.search(r"description:\s*['\"]([^'\"]+)", src)
        out.append(file_item(name.group(1) if name else os.path.basename(p), p,
                             cut(desc.group(1) if desc else first_line(src), 160)))
    return out


def settings_hook_items(home):
    """Hooks declared in the user's settings files: event, matcher and script name only (no arguments)."""
    out = []
    for f in (os.path.join(home, 'settings.json'), os.path.join(home, 'settings.local.json')):
        for event, matcher, cmd in settings_hooks(f):
            script = re.search(r'[\w./\\:-]+\.(py|ps1|js|mjs|sh|cmd)', cmd)
            base = os.path.basename(script.group(0)) if script else cut(strip_secrets(cmd).split(' ')[0], 60)
            out.append(file_item(f'{event}[{matcher}] {base}', f, 'settings hook: runs on every matching event',
                                 hidden=True))
    return out


def scan_setup(cfg, out_dir, run_schtasks=True, environ=None):
    home = expand(cfg['paths']['claude_home'])
    known = cfg['known_items']
    sections = []
    try:
        settings = json.loads(read_text(os.path.join(home, 'settings.json')) or '{}')
    except ValueError:
        settings = {}
    claude_md = read_text(os.path.join(home, 'CLAUDE.md'))
    rules = parse_rules(claude_md, cfg)
    version = rules['title']

    # settings.json: names only, a value only for the names in secrets.show_values
    st = []
    sp = os.path.join(home, 'settings.json')
    perms = settings.get('permissions') or {}
    st.append(file_item('settings.json', sp,
                        f"permissions {perms.get('defaultMode', 'default')} · {len(perms.get('allow') or [])} allow · "
                        f"{len(perms.get('deny') or [])} deny · output style {settings.get('outputStyle', 'default')} · "
                        f"keys: {', '.join(sorted(settings.keys()))}"))
    env_names = []
    for k, v in (settings.get('env') or {}).items():
        why = cfg['hidden_env'].get(k)
        val = env_value(k, v, cfg)
        env_names.append(k)
        st.append({'name': f'env {k}' + (f' = {val}' if val is not None else ''), 'path': sp.replace('\\', '/'),
                   'exists': True, 'size': None, 'changed': iso_mtime(sp),
                   'what': (why or 'Environment variable for every session.')
                   + ('' if val is not None else ' (value not shown)'),
                   'flags': [], 'hidden': bool(why), 'secret': secret_name(k, cfg)})
    if settings.get('outputStyle'):
        st.append({'name': f"outputStyle {settings['outputStyle']}", 'path': sp.replace('\\', '/'), 'exists': True,
                   'size': None, 'changed': iso_mtime(sp), 'what': 'Changes how every session answers and acts.',
                   'flags': [], 'hidden': True})
    hooks = settings_hook_items(home)
    sections.append({'id': 'settings', 'title': sec_title(cfg, 'settings', 'settings.json'), 'items': st})
    sections.append({'id': 'settings_hooks', 'title': sec_title(cfg, 'settings_hooks', 'Hooks (settings)'),
                     'items': hooks})
    sections.append({'id': 'permissions', 'title': sec_title(cfg, 'permissions', 'Permissions (settings.json)'),
                     'items': permission_items(home, settings)})

    # global CLAUDE.md, read live: title line, version, one item per heading
    cmp_ = os.path.join(home, 'CLAUDE.md')
    cm = [file_item('CLAUDE.md (global)', cmp_, f"{version or 'no title line'} · {len(rules['sections'])} sections")]
    for sec in rules['sections']:
        cites = sum(len(ln['citations']) for ln in sec['lines'])
        first = next((ln['text'] for ln in sec['lines']), '')
        cm.append({'name': f"§ {sec['heading']}", 'path': cmp_.replace('\\', '/'), 'exists': True, 'size': None,
                   'changed': None, 'what': cut(f"{len(sec['lines'])} lines · {cites} evidence · {first}", 170),
                   'flags': [], 'hidden': False})
    sections.append({'id': 'claude_md', 'title': sec_title(cfg, 'claude_md', 'Global CLAUDE.md'), 'items': cm})

    # repos
    sections.append({'id': 'repos', 'title': sec_title(cfg, 'repos', 'Repos under') + ' ' + cfg['paths']['projects_root'],
                     'items': repo_items(cfg, claude_md)})

    # agents
    ag = []
    for p in sorted(glob.glob(os.path.join(home, 'agents', '*.md'))):
        fm = front(read_text(p, 4000))
        model = fm.get('model') or 'inherits (CLAUDE_CODE_SUBAGENT_MODEL)'
        ag.append(file_item(fm.get('name') or os.path.basename(p), p,
                            f"{model} · effort {fm.get('effort', 'default')} · {cut(fm.get('description', ''), 110)}",
                            extra={'model': model, 'effort': fm.get('effort', 'default')}))
    sections.append({'id': 'agents', 'title': sec_title(cfg, 'agents', 'Agents (~/.claude/agents)'), 'items': ag})

    # skills: user, synced, plugin
    sk = []
    for p in sorted(glob.glob(os.path.join(home, 'skills', '*', 'SKILL.md'))) + \
            sorted(glob.glob(os.path.join(home, 'skills', 'synced', '*', '*', 'SKILL.md'))):
        fm = front(read_text(p, 4000))
        where = 'synced' if os.sep + 'synced' + os.sep in p else 'user'
        sk.append(file_item(fm.get('name') or os.path.basename(os.path.dirname(p)), p,
                            f"{where} · {cut(fm.get('description', ''), 130)}"))
    sections.append({'id': 'skills', 'title': sec_title(cfg, 'skills', 'Skills'), 'items': sk})
    wf = workflow_items(home)
    sections.append({'id': 'workflows', 'title': sec_title(cfg, 'workflows', 'Workflows (~/.claude/workflows)'),
                     'items': wf})

    # hooks folder
    hk = []
    for p in sorted(glob.glob(os.path.join(home, 'hooks', '*'))):
        if os.path.isfile(p):
            hk.append(file_item(os.path.basename(p), p, known.get(os.path.basename(p)) or first_line(read_text(p, 2000)),
                                hidden=True))
    sections.append({'id': 'hooks', 'title': sec_title(cfg, 'hooks', 'Hook scripts (~/.claude/hooks)'), 'items': hk})

    # mods: loaded / installed not loaded / dev
    mods = mod_states(cfg, home, settings, environ)
    state_lbl = (cfg.get('labels') or {}).get('mod_states') or {}
    md = [{'name': f"{m['name']} {m['version']}".strip(), 'path': m['path'], 'exists': m['state'] != 'missing',
           'size': None, 'changed': None,
           'what': state_lbl.get(m['state'], m['state'])
           + (f" ({', '.join(m['sources'])})" if m['sources'] else '') + f" · {m['description']}",
           'flags': [{'kind': 'missing', 'text': 'listed in CLAUDE_CODE_PLUGIN_DIRS but no plugin.json there'}]
           if m['state'] == 'missing' else [], 'hidden': False, 'state': m['state']} for m in mods['items']]
    sections.append({'id': 'mods', 'title': sec_title(cfg, 'mods', 'Mods'), 'items': md})

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
        mc.append(file_item(f'mcp {name}', cj, f"user scope · {s.get('type', 'stdio')} · {cut(strip_secrets(s.get('command') or s.get('url') or ''), 90)}"))
    for proj, pd in (cjd.get('projects') or {}).items():
        for name, s in (pd.get('mcpServers') or {}).items():
            mc.append(file_item(f'mcp {name}', cj, f"project {proj} · {cut(strip_secrets(s.get('command') or s.get('url') or ''), 80)}"))
    desk = os.path.join(os.environ.get('APPDATA', ''), 'Claude', 'claude_desktop_config.json')
    try:
        dd = json.loads(read_text(desk) or '{}')
    except ValueError:
        dd = {}
    for name, s in (dd.get('mcpServers') or {}).items():
        mc.append(file_item(f'mcp {name}', desk, f"desktop app · {cut(strip_secrets(s.get('command') or s.get('url') or ''), 90)}"))
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
    blockers = blocker_items(cfg, home, settings, repos, rules)
    hidden = [dict(it, section=s['title']) for s in sections for it in s['items'] if it.get('hidden')]
    live = {'title': version, 'version': rules['version'], 'label': rules['label'],
            'claude_md': cmp_.replace('\\', '/'), 'changed': iso_mtime(cmp_), 'sections': len(rules['sections']),
            'env_names': env_names, 'settings_hooks': len(hooks), 'agents': len(ag), 'skills': len(sk),
            'workflows': len(wf), 'mods_loaded': sum(1 for m in mods['items'] if m['state'] == 'loaded'),
            'mods_total': len(mods['items'])}
    data = {'generated': now_utc().strftime('%Y-%m-%dT%H:%M:%SZ'), 'rules_version': version, 'live': live,
            'mods': mods,
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


def worst_state(states):
    order = {'red': 0, 'amber': 1, 'green': 2}
    rated = [x for x in states if x in order]
    return min(rated, key=lambda st: order[st]) if rated else 'not measured'


def scan_practices(cfg, out_dir, usage=None, setup=None):
    """PRACTICES from the live rules file: one section per heading, each line with the evidence it cites (dates, PRs,
    audits, quotes, PRACTICES ids resolved in docs/PRACTICES.md) and, when config evidence_links ties the line to a
    metric or a SETUP flag, its measured state. Plus the pending V6 changes when the rules repo has them on main."""
    home = expand(cfg['paths']['claude_home'])
    claude_md = read_text(os.path.join(home, 'CLAUDE.md'))
    rules = parse_rules(claude_md, cfg)
    report = read_text(expand(cfg['paths'].get('audit_report', '')))
    practices_md = read_text(expand(cfg['paths'].get('practices_md', ''))) if cfg['paths'].get('practices_md') else ''
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
        for sec in setup['sections']:
            for it in sec['items']:
                for f in it.get('flags', []):
                    flagged.setdefault(f['kind'], []).append(f"{it['name']}: {f['text']}")
    ref_rx = re.compile(rules_cfg(cfg)['practices_ref_regex'])
    links = [(re.compile(x['find'], re.I), x) for x in cfg.get('evidence_links', [])]
    sections = []
    for sec in rules['sections']:
        lines = []
        for ln in sec['lines']:
            metrics, flags = [], []
            for rx, x in links:
                if rx.search(ln['text']):
                    metrics += [i for i in x.get('metrics', []) if i not in metrics]
                    if x.get('setup_flag') and x['setup_flag'] not in flags:
                        flags.append(x['setup_flag'])
            evidence, states = [], []
            for c in ln['citations']:
                evidence.append({'kind': 'cite', 'text': c, 'state': 'info'})
            for rid in dict.fromkeys(ref_rx.findall(ln['text'])):
                for t in practices_lines(practices_md, rid) or [f'{rid}: not found in docs/PRACTICES.md']:
                    evidence.append({'kind': 'practices', 'text': t, 'state': 'info'})
            for i in metrics:
                if i in by_id:
                    x = by_id[i]
                    evidence.append({'kind': 'metric', 'text': f"{x['label']}: {fmt(x)} (target {x['target']})",
                                     'state': x['state']})
                    states.append(x['state'])
            for fl in flags:
                hits = flagged.get(fl, [])
                states.append('red' if hits else 'green')
                for h in hits[:5] or [f"no {fl.replace('_', ' ')} found by SETUP"]:
                    evidence.append({'kind': 'setup', 'text': h, 'state': 'red' if hits else 'green'})
            lines.append({'text': cut(ln['text'], 400), 'evidence': evidence, 'state': worst_state(states),
                          'metrics': metrics})
        sections.append({'num': sec['num'], 'title': sec['title'], 'heading': sec['heading'], 'lines': lines,
                         'state': worst_state([x['state'] for x in lines]),
                         'evidence': sum(len(x['evidence']) for x in lines)})
    scored = [(score(m), m) for m in by_id.values()]
    scored = [(sc, m) for sc, m in scored if sc is not None]
    best = [f"{m['label']}: {fmt(m)} (target {m['target']})" for sc, m in sorted(scored, key=lambda x: -x[0]) if m['state'] == 'green'][:5]
    worst = [f"{m['label']}: {fmt(m)} (target {m['target']})" for sc, m in sorted(scored, key=lambda x: x[0]) if m['state'] in ('red', 'amber')][:5]
    right, wrong = audit_lists(report)
    data = {'generated': now_utc().strftime('%Y-%m-%dT%H:%M:%SZ'), 'window': win['label'] if win else None,
            'rules_version': rules['title'], 'version': rules['version'], 'label': rules['label'],
            'sections': sections, 'v6': read_v6(cfg), 'best': best, 'worst': worst,
            'audit_right': right[:5], 'audit_wrong': wrong[:5],
            'reference_md': practices_md,
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
