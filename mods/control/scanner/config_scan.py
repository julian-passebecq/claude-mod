"""CONFIG view of the control mod: everything that is in Claude Code on this machine, read live, read-only.

python -I control_scan.py config [--config PATH] [--out DIR] [--project DIR]

Writes <out>/config-claude.json (the tree: category -> sub-category -> item, with path, modified time, size and the
fields of each item) and <out>/config-claude.content.<n>.json (the full text of each item, in shards of at most
config_claude.shard_chars characters so the mod's file reads stay small). Every label, list of built-in agents and
documented default comes from config.json (config_claude); nothing here names a rules version.

Secrets: a settings value whose key matches config_claude.secret_regex, any ANTHROPIC_* value, and any string that
looks like a token is replaced by the mask before anything is written. MCP env and headers are never read beyond
their names. Desktop app files are read only for the keys listed in config_claude.desktop.keys."""
import datetime as dt
import glob
import json
import os
import re

import control_scan as cs

MASK = '•••• (masqué)'
TOKEN_RX = re.compile(r'(sk-ant-[\w-]{6,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|glpat-[\w-]{10,}'
                      r'|xox[abpr]-[\w-]{10,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{10,}\.[\w-]{10,}|Bearer\s+\S{8,})')


# ---------------------------------------------------------------- masking

class Masker:
    def __init__(self, cc):
        self.rx = re.compile(cc.get('secret_regex') or r'token|secret|passw|key|auth|credential|cookie', re.I)
        self.env_names_only = tuple(cc.get('env_names_only_prefixes') or ['ANTHROPIC_'])

    def secret_key(self, key):
        return bool(self.rx.search(str(key)))

    def text(self, s):
        """A free string: token-looking parts masked, URL credentials and query strings dropped."""
        return TOKEN_RX.sub(MASK, cs.strip_secrets(s)) if isinstance(s, str) else s

    def value(self, key, v, env=False):
        """One settings value under `key`: masked whole when the key looks secret (or is an ANTHROPIC_* env name)."""
        if v is None or isinstance(v, bool):
            return v
        if self.secret_key(key) or (env and str(key).startswith(self.env_names_only)):
            return MASK
        if isinstance(v, dict):
            return {k: self.value(k, x, env=env or k == 'env') for k, x in v.items()}
        if isinstance(v, list):
            return [self.value(key, x, env=env) for x in v]
        if isinstance(v, str):
            return self.text(v)
        return v

    def doc(self, data):
        return {k: self.value(k, v, env=(k == 'env')) for k, v in data.items()} if isinstance(data, dict) else data


# ---------------------------------------------------------------- items

class Tree:
    """Collects categories, sub-categories, items and their full text."""

    def __init__(self, cc, now):
        self.cc = cc
        self.now = now
        self.cats = []
        self.content = {}
        self.n = 0
        self.max_file = int(cc.get('max_file_chars', 400000))

    def cat(self, cid):
        title = (self.cc.get('categories') or {}).get(cid, cid)
        c = {'id': cid, 'title': title, 'subs': [], 'badge': ''}
        self.cats.append(c)
        return c

    def sub(self, cat, sid, title):
        s = {'id': f"{cat['id']}.{sid}", 'title': title, 'items': []}
        cat['subs'].append(s)
        return s

    def item(self, sub, name, path=None, kind='text', text=None, meta=None, summary='', flags=None, read=True,
             badge=''):
        """One leaf. `text` is its full content; when absent and `read`, the file at `path` is read (md, text)."""
        self.n += 1
        iid = f'i{self.n}'
        exists = bool(path) and os.path.exists(path)
        size = os.path.getsize(path) if exists and os.path.isfile(path) else None
        mtime = os.path.getmtime(path) if exists else None
        if text is None and read and exists and os.path.isfile(path):
            text = cs.read_text(path)
        if isinstance(text, str):
            if len(text) > self.max_file:
                text = text[:self.max_file] + f'\n\n… (tronqué : {len(text) - self.max_file} caractères de plus dans le fichier)'
            self.content[iid] = text
        it = {'id': iid, 'name': name, 'path': (path or '').replace('\\', '/'), 'exists': exists if path else None,
              'size': size, 'mtime': int(mtime) if mtime else None,
              'changed': dt.datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M') if mtime else None,
              'kind': kind if isinstance(text, str) else 'none', 'chars': len(text) if isinstance(text, str) else 0,
              'meta': [[k, '' if v is None else str(v)] for k, v in (meta or [])], 'summary': cs.cut(summary, 240),
              'flags': flags or [], 'badge': badge}
        sub['items'].append(it)
        return it


def kind_of(path):
    ext = os.path.splitext(path or '')[1].lower()
    return 'md' if ext in ('.md', '.markdown') else 'json' if ext == '.json' else 'text'


def load_json(path):
    try:
        return json.loads(cs.read_text(path) or 'null')
    except ValueError:
        return None


def body_of(src):
    """Markdown body after a front-matter block."""
    if src.startswith('---'):
        end = src.find('\n---', 3)
        if end > 0:
            return src[end + 4:].lstrip('\n')
    return src


def fm_list(v):
    return ', '.join(x.strip() for x in re.split(r'[,\[\]]', v or '') if x.strip()) or ''


# ---------------------------------------------------------------- sources

def repos_of(cfg):
    root = cs.expand(cfg['paths'].get('projects_root') or '')
    if not root or '<' in root or not os.path.isdir(root):
        return root, []
    return root, cs.discover_repos(root)


def rel(root, path):
    try:
        return os.path.relpath(path, root).replace('\\', '/')
    except ValueError:
        return path.replace('\\', '/')


def enabled_plugin_roots(home, enabled):
    """(name@marketplace, folder) for each plugin turned on in enabledPlugins whose folder we can find."""
    out = []
    for key, on in (enabled or {}).items():
        if not on or '@' not in key:
            continue
        name, mkt = key.split('@', 1)
        cands = [os.path.join(home, 'plugins', 'marketplaces', mkt, d, name) for d in ('plugins', 'external_plugins')]
        cands += sorted(glob.glob(os.path.join(home, 'plugins', 'cache', mkt, name, '*')), reverse=True)
        found = next((c for c in cands if os.path.isdir(c)), None)
        out.append((key, found))
    return out


def synced_plugin_roots(home):
    out = []
    for man in sorted(glob.glob(os.path.join(home, 'plugins', 'synced', '*', '*', '.claude-plugin', 'plugin.json'))):
        root = os.path.dirname(os.path.dirname(man))
        info = load_json(man) or {}
        out.append((info.get('name') or os.path.basename(root), root))
    return out


# ---------------------------------------------------------------- settings precedence

def settings_sources(cfg, home, project):
    """Settings files from highest to lowest precedence (code.claude.com/docs/en/settings#settings-precedence)."""
    cc = cfg['config_claude']
    managed = [p for p in (cc.get('managed_paths') or {}).get('nt' if os.name == 'nt' else 'posix', [])]
    out = []
    for p in managed:
        out.append(('managed', cs.expand(p)))
    out.append(('cli', None))
    if project:
        out.append(('local', os.path.join(project, '.claude', 'settings.local.json')))
        out.append(('project', os.path.join(project, '.claude', 'settings.json')))
    out.append(('user', os.path.join(home, 'settings.json')))
    return out


def flatten(data):
    """Top-level keys; objects one level down ('env.X', 'permissions.defaultMode'); lists stay whole."""
    out = {}
    for k, v in (data or {}).items():
        if isinstance(v, dict) and v and k not in ('hooks',):
            for k2, v2 in v.items():
                out[f'{k}.{k2}'] = v2
        else:
            out[k] = v
    return out


def effective_settings(sources, masker):
    """[{key, value, set_by, overrides, merged}] from the settings files, highest precedence first. Scalars: the
    highest file wins and the lower ones are listed as overridden. Lists (permissions.allow, …): merged across files,
    every file named."""
    per = []
    for scope, path in sources:
        if not path or not os.path.isfile(path):
            continue
        data = load_json(path)
        if isinstance(data, dict):
            per.append((scope, path, flatten(data)))
    keys = []
    for _, _, flat in per:
        for k in flat:
            if k not in keys:
                keys.append(k)
    rows = []
    for k in sorted(keys):
        setters = [(scope, path, flat[k]) for scope, path, flat in per if k in flat]
        top = k.split('.', 1)[0]
        env = top == 'env'
        leaf = k.split('.', 1)[-1]
        if all(isinstance(v, list) for _, _, v in setters) and len(setters) > 1:
            merged = []
            for _, _, v in setters:
                merged += [x for x in v if x not in merged]
            value = masker.value(leaf, merged, env=env)
            rows.append({'key': k, 'value': value, 'set_by': [s for s, _, _ in setters], 'overrides': [], 'merged': True,
                         'paths': [p.replace('\\', '/') for _, p, _ in setters]})
        else:
            scope, path, v = setters[0]
            rows.append({'key': k, 'value': masker.value(leaf, v, env=env), 'set_by': [scope],
                         'overrides': [s for s, _, _ in setters[1:]], 'merged': False,
                         'paths': [path.replace('\\', '/')]})
    return rows, per


def show(v, n=160):
    if isinstance(v, (dict, list, bool)) or v is None:
        return cs.cut(json.dumps(v, ensure_ascii=False), n)
    return cs.cut(str(v), n)


# ---------------------------------------------------------------- the scan

def scan_config(cfg, out_dir, project=None, environ=None, now=None):
    environ = os.environ if environ is None else environ
    cc = cfg.get('config_claude') or {}
    cfg = dict(cfg, config_claude=cc)
    L = cc.get('labels') or {}
    home = cs.expand(cfg['paths']['claude_home'])
    now = now or dt.datetime.now()
    masker = Masker(cc)
    t = Tree(cc, now)
    root, repos = repos_of(cfg)
    project = cs.expand(project) if project else None
    user_settings = load_json(os.path.join(home, 'settings.json')) or {}
    sources = settings_sources(cfg, home, project)
    rows, per = effective_settings(sources, masker)
    eff = {r['key']: r for r in rows}
    enabled = {}
    for _, _, flat in reversed(per):
        for k, v in flat.items():
            if k.startswith('enabledPlugins.'):
                enabled[k.split('.', 1)[1]] = v
    plugin_roots = synced_plugin_roots(home) + [(k, r) for k, r in enabled_plugin_roots(home, enabled) if r]

    # 1. rules and instructions
    c = t.cat('rules')
    s = t.sub(c, 'global', L.get('global_claude_md', 'CLAUDE.md global'))
    gp = os.path.join(home, 'CLAUDE.md')
    rules = cs.parse_rules(cs.read_text(gp), cfg)
    t.item(s, 'CLAUDE.md', gp, 'md', meta=[('version', rules['title'] or L.get('no_title', '—')),
                                           ('sections', len(rules['sections']))], summary=rules['title'])
    for p in sorted(glob.glob(os.path.join(home, 'rules', '**', '*.md'), recursive=True)):
        t.item(s, f"rules/{rel(os.path.join(home, 'rules'), p)}", p, 'md')
    s = t.sub(c, 'projects', f"{L.get('project_files', 'Projets')} ({root.replace(chr(92), '/')})")
    for repo in repos:
        for name in cc.get('project_rule_files') or ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude/CLAUDE.md']:
            p = os.path.join(repo, *name.split('/'))
            if os.path.isfile(p):
                t.item(s, f'{rel(root, repo)}/{name}', p, 'md', summary=cs.first_line(cs.read_text(p, 3000)))
        for p in sorted(glob.glob(os.path.join(repo, '.claude', 'rules', '**', '*.md'), recursive=True)):
            t.item(s, f'{rel(root, repo)}/.claude/rules/{rel(os.path.join(repo, ".claude", "rules"), p)}', p, 'md')
    s = t.sub(c, 'styles', L.get('output_styles', 'Styles de sortie'))
    style_dirs = [('user', os.path.join(home, 'output-styles'))] + [(rel(root, r), os.path.join(r, '.claude', 'output-styles')) for r in repos]
    for where, d in style_dirs:
        for p in sorted(glob.glob(os.path.join(d, '*.md'))):
            fm = cs.front(cs.read_text(p, 3000))
            t.item(s, f"{fm.get('name') or os.path.basename(p)[:-3]} ({where})", p, 'md', summary=fm.get('description', ''))
    sel = eff.get('outputStyle')
    t.item(s, L.get('output_style_active', 'Style actif'), None, 'none', read=False,
           meta=[('outputStyle', sel['value'] if sel else (cc.get('default_output_style') or 'default')),
                 (L.get('set_by', 'défini par'), ', '.join(sel['set_by']) if sel else L.get('default', 'défaut'))])
    for d in sorted(glob.glob(os.path.join(home, 'projects', '*', 'memory'))):
        files = sorted(glob.glob(os.path.join(d, '*.md')))
        if not files:
            continue
        s = t.sub(c, 'mem-' + os.path.basename(os.path.dirname(d)),
                  f"{L.get('memory', 'Mémoire')} · {os.path.basename(os.path.dirname(d))}")
        for p in sorted(files, key=lambda x: (os.path.basename(x) != 'MEMORY.md', x.lower())):
            fm = cs.front(cs.read_text(p, 3000))
            t.item(s, os.path.basename(p), p, 'md', summary=fm.get('description', '') or cs.first_line(cs.read_text(p, 2000)))

    # 2. agents
    c = t.cat('agents')

    def agent(sub, p, where):
        src = cs.read_text(p)
        fm = cs.front(src)
        t.item(sub, fm.get('name') or os.path.basename(p)[:-3], p, 'md', text=src,
               meta=[('model', fm.get('model') or L.get('inherit', 'inherit (non nommé)')),
                     ('effort', fm.get('effort') or L.get('default', 'défaut')),
                     ('tools', fm_list(fm.get('tools')) or L.get('all_tools', 'tous')),
                     ('source', where)],
               summary=fm.get('description', ''))
    s = t.sub(c, 'user', L.get('agents_user', 'Utilisateur (~/.claude/agents)'))
    for p in sorted(glob.glob(os.path.join(home, 'agents', '*.md'))):
        agent(s, p, 'user')
    s = t.sub(c, 'project', L.get('agents_project', 'Projets (.claude/agents)'))
    for r in repos:
        for p in sorted(glob.glob(os.path.join(r, '.claude', 'agents', '*.md'))):
            agent(s, p, rel(root, r))
    s = t.sub(c, 'plugin', L.get('agents_plugin', 'Plugins'))
    for name, r in plugin_roots:
        for p in sorted(glob.glob(os.path.join(r, 'agents', '*.md'))):
            agent(s, p, f'plugin {name}')
    s = t.sub(c, 'builtin', L.get('agents_builtin', 'Intégrés (doc)'))
    for b in cc.get('builtin_agents') or []:
        t.item(s, f"{b['name']} · {L.get('builtin', 'intégré')}", None, 'md', read=False,
               text=f"**{b['name']}** ({L.get('builtin', 'intégré')})\n\n{b.get('what', '')}\n\nModel : {b.get('model', '')}\n\nTools : {b.get('tools', '')}\n\n[doc]({b.get('doc', '')})",
               meta=[('model', b.get('model', '')), ('tools', b.get('tools', '')), ('doc', b.get('doc', '')),
                     (L.get('verified', 'vérifié'), L.get('yes', 'oui') if b.get('verified') else L.get('unverified', 'non vérifié'))],
               summary=b.get('what', ''), badge=L.get('builtin', 'intégré'))

    # 3. skills, commands, workflows
    c = t.cat('skills')

    def skill(sub, p, where):
        src = cs.read_text(p)
        fm = cs.front(src)
        t.item(sub, f"{fm.get('name') or os.path.basename(os.path.dirname(p))} ({where})", p, 'md', text=src,
               meta=[('source', where)], summary=fm.get('description', ''))
    s = t.sub(c, 'skills', L.get('skills', 'Skills'))
    for p in sorted(glob.glob(os.path.join(home, 'skills', '*', 'SKILL.md'))):
        skill(s, p, 'user')
    for p in sorted(glob.glob(os.path.join(home, 'skills', 'synced', '*', '*', 'SKILL.md'))):
        skill(s, p, 'synced')
    for r in repos:
        for p in sorted(glob.glob(os.path.join(r, '.claude', 'skills', '*', 'SKILL.md'))):
            skill(s, p, rel(root, r))
    for name, r in plugin_roots:
        for p in sorted(glob.glob(os.path.join(r, 'skills', '*', 'SKILL.md'))) + sorted(glob.glob(os.path.join(r, 'SKILL.md'))):
            skill(s, p, f'plugin {name}')
    s = t.sub(c, 'commands', L.get('commands', 'Commandes slash'))
    cmd_dirs = [('user', os.path.join(home, 'commands'))] + [(rel(root, r), os.path.join(r, '.claude', 'commands')) for r in repos] \
        + [(f'plugin {n}', os.path.join(r, 'commands')) for n, r in plugin_roots]
    for where, d in cmd_dirs:
        for p in sorted(glob.glob(os.path.join(d, '**', '*.md'), recursive=True)):
            fm = cs.front(cs.read_text(p, 3000))
            t.item(s, f"/{rel(d, p)[:-3].replace('/', ':')} ({where})", p, 'md', meta=[('source', where)],
                   summary=fm.get('description', '') or cs.first_line(cs.read_text(p, 2000)))
    s = t.sub(c, 'workflows', L.get('workflows', 'Workflows'))
    wf_dirs = [('user', os.path.join(home, 'workflows'))] + [(rel(root, r), os.path.join(r, '.claude', 'workflows')) for r in repos]
    for where, d in wf_dirs:
        for p in sorted(glob.glob(os.path.join(d, '*'))):
            if os.path.splitext(p)[1] not in ('.js', '.mjs', '.ts', '.cjs', '.md'):
                continue
            src = cs.read_text(p)
            nm = re.search(r"name:\s*['\"]([^'\"]+)", src)
            ds = re.search(r"description:\s*['\"]([^'\"]+)", src)
            t.item(s, f"{nm.group(1) if nm else os.path.basename(p)} ({where})", p, kind_of(p), text=src,
                   meta=[('source', where)], summary=ds.group(1) if ds else cs.first_line(src))

    # 4. settings: effective values by precedence, every settings file, env vars
    c = t.cat('settings')
    s = t.sub(c, 'effective', L.get('effective', 'Valeurs effectives (par priorité)'))
    doc = cc.get('settings_doc', '')
    order = ' > '.join(sc for sc, _ in sources)
    for r in rows:
        meta = [('valeur', show(r['value'])), (L.get('set_by', 'défini par'), ', '.join(r['set_by']))]
        if r['overrides']:
            meta.append((L.get('overrides', 'écrase'), ', '.join(r['overrides'])))
        if r['merged']:
            meta.append((L.get('merged', 'fusion'), L.get('merged_text', 'listes fusionnées entre fichiers')))
        meta.append(('doc', doc))
        t.item(s, r['key'], None, 'json', read=False, text=json.dumps(r['value'], indent=1, ensure_ascii=False),
               meta=meta, summary=f"{show(r['value'], 100)} · {', '.join(r['set_by'])}")
    t.item(s, L.get('precedence', 'Ordre de priorité'), None, 'md', read=False,
           text=f"{order}\n\n{L.get('precedence_text', '')}\n\n[{doc}]({doc})",
           meta=[('ordre', order), ('doc', doc), ('cli', L.get('cli_unreadable', 'drapeaux de ligne de commande : non lisibles depuis un mod'))])
    s = t.sub(c, 'files', L.get('settings_files', 'Fichiers settings'))
    files = [(sc, p) for sc, p in sources if p] + [(rel(root, r), os.path.join(r, '.claude', n)) for r in repos
                                                    for n in ('settings.json', 'settings.local.json')
                                                    if not project or os.path.normcase(r) != os.path.normcase(project)]
    for sc, p in files:
        if not os.path.isfile(p):
            if sc in ('managed', 'user', 'project', 'local'):
                t.item(s, f'{sc} · {os.path.basename(p)}', p, 'none', read=False,
                       meta=[('scope', sc), (L.get('state', 'état'), L.get('absent', 'absent'))])
            continue
        data = load_json(p)
        t.item(s, f'{sc} · {os.path.basename(p)}', p, 'json',
               text=json.dumps(masker.doc(data), indent=1, ensure_ascii=False) if isinstance(data, dict) else L.get('bad_json', 'JSON illisible'),
               meta=[('scope', sc), ('clés', ', '.join(sorted(data.keys())) if isinstance(data, dict) else '')])
    s = t.sub(c, 'env', L.get('env', "Variables d'environnement"))
    prefixes = tuple(cc.get('env_prefixes') or ['CLAUDE_CODE_', 'ANTHROPIC_'])
    for r in rows:
        if r['key'].startswith('env.'):
            name = r['key'][4:]
            t.item(s, f"{name} (settings)", None, 'none', read=False,
                   meta=[('valeur', show(r['value'])), (L.get('set_by', 'défini par'), ', '.join(r['set_by']))])
    for name in sorted(environ.keys()):
        if name.upper().startswith(prefixes) or name.upper() in (cc.get('env_extra') or []):
            t.item(s, f'{name} ({L.get("process", "processus")})', None, 'none', read=False,
                   meta=[('valeur', L.get('names_only', 'nom seulement'))])

    # 5. documented defaults
    c = t.cat('defaults')
    s = t.sub(c, 'defaults', L.get('defaults', 'Défauts documentés'))
    for d in cc.get('defaults') or []:
        ours = None
        if d.get('setting') and d['setting'] in eff:
            r = eff[d['setting']]
            ours = f"{show(r['value'], 80)} ({', '.join(r['set_by'])})"
        elif d.get('env') and f"env.{d['env']}" in eff:
            r = eff[f"env.{d['env']}"]
            ours = f"{show(r['value'], 80)} (env, {', '.join(r['set_by'])})"
        elif d.get('env') and d['env'] in environ:
            ours = f"{L.get('names_only', 'nom seulement')} ({L.get('process', 'processus')})"
        meta = [(L.get('default', 'défaut'), d.get('default', '')),
                (L.get('ours', 'chez nous'), ours or L.get('not_set', 'non réglé : le défaut s’applique')),
                ('réglage', ' / '.join(x for x in (d.get('setting'), d.get('env')) if x)),
                ('doc', d.get('doc', '')),
                (L.get('verified', 'vérifié'), L.get('yes', 'oui') if d.get('verified') else L.get('unverified', 'non vérifié'))]
        t.item(s, d['label'], None, 'none', read=False, meta=meta,
               summary=f"{L.get('default', 'défaut')} {d.get('default', '')}" + (f" · {L.get('ours', 'chez nous')} {ours}" if ours else ''),
               badge=L.get('ours', 'chez nous') if ours else ('' if d.get('verified') else L.get('unverified', 'non vérifié')),
               flags=[] if d.get('verified') else [{'kind': 'unverified', 'text': L.get('unverified', 'non vérifié')}])

    # 6. hooks and permissions
    c = t.cat('hooks')
    s = t.sub(c, 'hooks', L.get('hooks', 'Hooks (settings)'))
    hook_files = [(sc, p) for sc, p in sources if p] + [(rel(root, r), os.path.join(r, '.claude', n)) for r in repos
                                                          for n in ('settings.json', 'settings.local.json')]
    seen_files = set()
    nhooks = 0
    for sc, p in hook_files:
        key = os.path.normcase(os.path.abspath(p))
        if key in seen_files or not os.path.isfile(p):
            continue
        seen_files.add(key)
        for event, matcher, cmd in cs.settings_hooks(p):
            nhooks += 1
            t.item(s, f'{event}[{matcher}] ({sc})', p, 'text', read=False, text=masker.text(cmd),
                   meta=[('event', event), ('matcher', matcher), ('scope', sc)], summary=cs.cut(masker.text(cmd), 120),
                   flags=[{'kind': 'hook', 'text': L.get('hook_flag', 'un hook tourne sur chaque événement qui correspond')}])
    if not nhooks:
        t.item(s, L.get('no_hooks', 'Aucun hook (attendu)'), None, 'none', read=False)
    s = t.sub(c, 'plugin_hooks', L.get('plugin_hooks', 'Hooks de plugins'))
    for name, r in plugin_roots:
        hj = os.path.join(r, 'hooks', 'hooks.json')
        if os.path.isfile(hj):
            t.item(s, name, hj, 'json', text=masker.text(cs.read_text(hj)))
    s = t.sub(c, 'permissions', L.get('permissions', 'Permissions'))
    dm = eff.get('permissions.defaultMode')
    t.item(s, f"defaultMode {dm['value'] if dm else cc.get('default_permission_mode', 'default')}", None, 'none', read=False,
           meta=[(L.get('set_by', 'défini par'), ', '.join(dm['set_by']) if dm else L.get('default', 'défaut')),
                 (L.get('overrides', 'écrase'), ', '.join(dm['overrides']) if dm else '')])
    for kind in ('allow', 'ask', 'deny', 'additionalDirectories'):
        for sc, p, flat in per:
            lst = flat.get(f'permissions.{kind}') or []
            if lst:
                t.item(s, f'{kind} ({sc}) · {len(lst)}', p, 'text', read=False,
                       text='\n'.join(masker.text(str(x)) for x in lst),
                       meta=[('scope', sc), ('règles', len(lst))], summary=cs.cut(', '.join(map(str, lst)), 160))

    # 7. mods and plugins
    c = t.cat('mods')
    s = t.sub(c, 'mods', L.get('mods', 'Mods (CLAUDE_CODE_PLUGIN_DIRS)'))
    mods = cs.mod_states(cfg, home, user_settings, environ)
    states = (cfg.get('labels') or {}).get('mod_states') or {}
    old_root = os.path.normcase(os.path.join(home, 'mods'))
    for m in mods['items']:
        folder = cs.expand(m['path'])
        if os.path.normcase(folder).startswith(old_root):
            continue
        cmds = []
        for src in glob.glob(os.path.join(folder, 'hooks', '*')):
            if os.path.splitext(src)[1] in ('.ts', '.tsx', '.js', '.mjs'):
                cmds += ['/' + x for x in re.findall(r"command\.register\(\{\s*name:\s*['\"]([\w-]+)", cs.read_text(src))]
        man = os.path.join(folder, '.claude-plugin', 'plugin.json')
        t.item(s, f"{m['name']} {m['version']}".strip(), man if os.path.isfile(man) else folder, 'json',
               text=json.dumps(masker.doc(load_json(man) or {}), indent=1, ensure_ascii=False) if os.path.isfile(man) else None,
               read=False, meta=[(L.get('state', 'état'), states.get(m['state'], m['state'])), ('version', m['version']),
                                 ('commandes', ' '.join(sorted(set(cmds))) or '—'),
                                 ('source', ', '.join(m['sources']) or '—'), ('dossier', m['path'])],
               summary=m['description'], badge=states.get(m['state'], m['state']))
    s = t.sub(c, 'stale', L.get('stale_mods', 'Copies anciennes (~/.claude/mods)'))
    for f in sorted(glob.glob(os.path.join(home, 'mods', '*'))):
        man = os.path.join(f, '.claude-plugin', 'plugin.json')
        info = load_json(man) or {}
        loaded = os.path.normcase(os.path.normpath(f)) in {cs.norm(x) for x in cs.plugin_dirs(
            ((user_settings.get('env') or {}).get('CLAUDE_CODE_PLUGIN_DIRS'))) + cs.plugin_dirs(environ.get('CLAUDE_CODE_PLUGIN_DIRS'))}
        t.item(s, f"{info.get('name') or os.path.basename(f)} {info.get('version', '')}".strip(), man if os.path.isfile(man) else f,
               'json', read=False, text=json.dumps(masker.doc(info), indent=1, ensure_ascii=False) if info else None,
               meta=[(L.get('state', 'état'), L.get('loaded', 'chargé') if loaded else L.get('stale', 'copie ancienne, non chargée'))],
               flags=[{'kind': 'stale', 'text': L.get('stale_flag', 'copie ancienne : la source est le dépôt claude-mod')}],
               badge=L.get('stale', 'copie ancienne'))
    s = t.sub(c, 'plugins', L.get('plugins', 'Plugins installés'))
    for name, r in synced_plugin_roots(home):
        man = os.path.join(r, '.claude-plugin', 'plugin.json')
        info = load_json(man) or {}
        t.item(s, f"{name} {info.get('version', '')}".strip(), man, 'json', read=False,
               text=json.dumps(masker.doc(info), indent=1, ensure_ascii=False),
               meta=[('source', L.get('synced', 'synchronisé (compte)')), (L.get('state', 'état'), L.get('enabled', 'activé')),
                     ('hooks', L.get('yes', 'oui') if os.path.isfile(os.path.join(r, 'hooks', 'hooks.json')) else L.get('no', 'non'))],
               summary=info.get('description', ''))
    for key, r in enabled_plugin_roots(home, {k: True for k in enabled}):
        on = bool(enabled.get(key))
        t.item(s, key, r, 'none', read=False,
               meta=[('source', 'enabledPlugins'), (L.get('state', 'état'), L.get('enabled', 'activé') if on else L.get('disabled', 'désactivé')),
                     ('dossier', (r or L.get('absent', 'absent')).replace('\\', '/'))])
    ip = os.path.join(home, 'plugins', 'installed_plugins.json')
    if os.path.isfile(ip):
        t.item(s, 'installed_plugins.json', ip, 'json', text=json.dumps(masker.doc(load_json(ip) or {}), indent=1, ensure_ascii=False))
    s = t.sub(c, 'marketplaces', L.get('marketplaces', 'Marketplaces'))
    km = os.path.join(home, 'plugins', 'known_marketplaces.json')
    for name, info in (load_json(km) or {}).items():
        src = (info or {}).get('source') or {}
        avail = len(glob.glob(os.path.join(home, 'plugins', 'marketplaces', name, '*plugins', '*')))
        t.item(s, name, km, 'none', read=False,
               meta=[('source', masker.text(src.get('repo') or src.get('url') or src.get('path') or '')),
                     (L.get('available', 'plugins disponibles'), avail)])

    # 8. MCP
    c = t.cat('mcp')
    s = t.sub(c, 'servers', L.get('mcp', 'Serveurs MCP'))

    def mcp(name, spec, scope, path):
        spec = spec or {}
        cmd = spec.get('url') or ' '.join([str(spec.get('command') or '')] + [str(a) for a in spec.get('args') or []])
        t.item(s, f'{name} ({scope})', path, 'none', read=False,
               meta=[('scope', scope), ('type', spec.get('type') or ('http' if spec.get('url') else 'stdio')),
                     ('commande / url', cs.cut(masker.text(cmd), 200)),
                     ('env (noms)', ', '.join(sorted((spec.get('env') or {}).keys())) or '—'),
                     ('headers (noms)', ', '.join(sorted((spec.get('headers') or {}).keys())) or '—')])
    cj = os.path.expanduser(cc.get('claude_json') or '~/.claude.json')
    cjd = load_json(cj) or {}
    for name, spec in (cjd.get('mcpServers') or {}).items():
        mcp(name, spec, 'user', cj)
    for proj, pd in (cjd.get('projects') or {}).items():
        for name, spec in ((pd or {}).get('mcpServers') or {}).items():
            mcp(name, spec, f'local {proj}', cj)
    for r in repos:
        p = os.path.join(r, '.mcp.json')
        for name, spec in ((load_json(p) or {}).get('mcpServers') or {}).items():
            mcp(name, spec, f'project {rel(root, r)}', p)
    for name, r in plugin_roots:
        p = os.path.join(r, '.mcp.json')
        for nm, spec in ((load_json(p) or {}).get('mcpServers') or {}).items():
            mcp(nm, spec, f'plugin {name}', p)
    appdata = environ.get('APPDATA') or ''
    desk = os.path.join(appdata, 'Claude', 'claude_desktop_config.json') if appdata else ''
    dd = load_json(desk) if desk else None
    for name, spec in ((dd or {}).get('mcpServers') or {}).items():
        mcp(name, spec, 'desktop', desk)
    if not s['items']:
        t.item(s, L.get('no_mcp', 'Aucun serveur MCP configuré dans ces fichiers'), None, 'none', read=False,
               meta=[('connecteurs', L.get('connectors_note', 'les connecteurs claude.ai ne sont pas dans un fichier local'))])

    # 9. desktop app
    c = t.cat('desktop')
    s = t.sub(c, 'prefs', L.get('desktop', 'Préférences (onglet Code)'))
    prefs = (dd or {}).get('preferences') or {}
    for k in (cc.get('desktop') or {}).get('keys') or []:
        v = prefs
        for part in k['path'].split('.'):
            v = v.get(part) if isinstance(v, dict) else None
        if isinstance(v, dict):  # per-account flags: on when any account has it
            v = any(bool(x) for x in v.values()) if v else None
        if v is None or not isinstance(v, (bool, int, float, str)) or (isinstance(v, str) and len(v) > 40):
            shown = L.get('not_in_file', 'absent du fichier')
        else:
            shown = show(masker.value(k['path'].split('.')[-1], v))
        t.item(s, k['label'], desk or None, 'none', read=False, meta=[('valeur', shown), ('clé', k['path'])])
    for lbl in (cc.get('desktop') or {}).get('unreadable') or []:
        t.item(s, lbl, None, 'none', read=False, meta=[('valeur', L.get('unreadable', 'non lisible depuis un mod'))],
               flags=[{'kind': 'unreadable', 'text': L.get('unreadable', 'non lisible depuis un mod')}])

    # 10. Claude Control
    c = t.cat('control')
    repo = cs.expand(cc.get('claude_control_repo') or (cfg.get('v6') or {}).get('repo') or '')
    s = t.sub(c, 'source', L.get('control_source', "D'où viennent les règles"))
    if not repo or '<' in repo or not os.path.isdir(repo):
        t.item(s, L.get('no_control_repo', 'Dépôt Claude Control non configuré'), None, 'none', read=False)
        c['badge'] = ''
    else:
        t.item(s, 'config/', os.path.join(repo, 'config'), 'text', read=False,
               text='\n'.join(rel(repo, p) for p in sorted(glob.glob(os.path.join(repo, 'config', '**', '*'), recursive=True))
                              if os.path.isfile(p)),
               meta=[('dépôt', repo.replace('\\', '/'))])
        dp = os.path.join(repo, 'tools', 'deploy.py')
        t.item(s, 'tools/deploy.py', dp, 'text')
        backups = sorted(d for d in glob.glob(os.path.join(home, *(cc.get('deploy_backups') or 'effort-board/_deploy_backups').split('/'), '*'))
                         if os.path.isdir(d))
        last = max(backups, key=os.path.getmtime) if backups else None
        t.item(s, L.get('last_deploy', 'Dernier déploiement (sauvegarde)'), last, 'none', read=False,
               meta=[('sauvegardes', len(backups)), ('dernière', os.path.basename(last) if last else '—')])
        inv = os.path.join(repo, *(cc.get('rules_inventory') or 'docs/RULES-INVENTORY.md').split('/'))
        t.item(s, 'RULES-INVENTORY.md', inv, 'md')
        s = t.sub(c, 'drift', L.get('drift', 'Écarts dépôt → ~/.claude (contrat de déploiement)'))
        diffs = 0
        for m in cc.get('deploy_map') or []:
            src = os.path.join(repo, *m['repo'].split('/'))
            dst = os.path.join(home, *m['live'].split('/')) if m['live'] else home
            pairs = []
            if os.path.isfile(src):
                pairs.append((src, dst))
            elif os.path.isdir(src):
                pattern = '**/*' if m.get('tree') else m.get('glob', '*')
                for p in sorted(glob.glob(os.path.join(src, pattern), recursive=True)):
                    if os.path.isfile(p) and '__pycache__' not in p:
                        pairs.append((p, os.path.join(dst, os.path.relpath(p, src))))
            for a, b in pairs:
                state = same(a, b)
                if state == 'same':
                    continue
                diffs += 1
                t.item(s, f"{rel(repo, a)} → ~/.claude/{rel(home, b)}", b if os.path.exists(b) else a, kind_of(a),
                       meta=[(L.get('state', 'état'), L.get(state, state))], badge=L.get(state, state),
                       flags=[{'kind': 'drift', 'text': L.get(state, state)}])
        if not diffs:
            t.item(s, L.get('in_sync', 'À jour : ~/.claude = dépôt'), None, 'none', read=False)
        c['badge'] = (f"{diffs} {L.get('diffs', 'écarts')}" if diffs else L.get('in_sync_badge', 'à jour'))

    # changes in the last N days, newest first
    days = int(cc.get('changes_days', 7))
    horizon = now.timestamp() - days * 86400
    changes = []
    seen = set()
    for cat in t.cats:
        for sub in cat['subs']:
            for it in sub['items']:
                if it['mtime'] and it['mtime'] >= horizon and (it['path'], it['name']) not in seen:
                    seen.add((it['path'], it['name']))
                    changes.append({'id': it['id'], 'name': it['name'], 'path': it['path'], 'changed': it['changed'],
                                    'mtime': it['mtime'], 'where': f"{cat['title']} › {sub['title']}"})
    changes.sort(key=lambda x: -x['mtime'])

    # write: content shards, then the index
    shard_chars = int(cc.get('shard_chars', 1500000))
    shards, cur, size = [], {}, 0
    where = {}
    for iid, text in t.content.items():
        if cur and size + len(text) > shard_chars:
            shards.append(cur)
            cur, size = {}, 0
        cur[iid] = text
        size += len(text)
        where[iid] = len(shards)
    if cur:
        shards.append(cur)
    for cat in t.cats:
        cat['count'] = sum(len(sb['items']) for sb in cat['subs'])
        for sub in cat['subs']:
            for it in sub['items']:
                it['shard'] = where.get(it['id'])
    old = glob.glob(os.path.join(out_dir, 'config-claude.content.*.json'))
    names = []
    for i, sh in enumerate(shards):
        n = f'config-claude.content.{i}.json'
        cs.write_json(os.path.join(out_dir, n), sh)
        names.append(n)
    for p in old:
        if os.path.basename(p) not in names:
            try:
                os.remove(p)
            except OSError:
                pass
    data = {'generated': cs.now_utc().strftime('%Y-%m-%dT%H:%M:%SZ'), 'project': (project or '').replace('\\', '/'),
            'categories': t.cats, 'changes': changes[:int(cc.get('changes_max', 200))], 'changes_days': days,
            'shards': names, 'counts': {cat['id']: cat['count'] for cat in t.cats}}
    cs.write_json(os.path.join(out_dir, 'config-claude.json'), data)
    return data


def same(a, b):
    """'same', 'differs' or 'missing_live' for a repo file and its deployed copy (LF endings, as deploy.py compares)."""
    if not os.path.isfile(b):
        return 'missing_live'
    try:
        with open(a, 'rb') as fa, open(b, 'rb') as fb:
            return 'same' if fa.read().replace(b'\r\n', b'\n') == fb.read().replace(b'\r\n', b'\n') else 'differs'
    except OSError:
        return 'differs'
