"""Machine sampler for the machine mod: CPU (total and per core), RAM, disks, GPU, top processes, GitLab runner load.

    python -I machine.py sample  < request.json     one sample as JSON (request: see SAMPLE_DEFAULTS)
    python -I machine.py runner  [--ci PATH] [--ci-config F] [--refresh] [--backend ID ...]
                                                    GitLab runner load through the ci mod's scanner (ci.py)

Read-only: it reads system counters and never writes a file (the runner check uses ci.py's own status cache).
CPU % are deltas between two samples: the caller passes the previous raw counters back (`prev`); without them the
sampler takes two readings `first_delta_ms` apart. Windows reads kernel32/ntdll through ctypes (no PowerShell, no
WMI); Linux reads /proc. GPU: nvidia-smi when present, else a Windows performance counter (typeperf), else
"non disponible". A token value is never read or printed: the runner part copies counts only.
Standard library only.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

_HEALTH_T0 = time.time()

IS_WIN = os.name == 'nt'

SAMPLE_DEFAULTS = {
    'prev': None,              # raw counters returned by the previous sample ({'t', 'cores', 'procs'})
    'first_delta_ms': 500,     # pause between the two readings when prev is missing
    'top_n': 5,
    'families': {},            # {"claude": ["claude"], "node": ["node"], ...}: process name prefixes per family
    'runner_process': ['gitlab-runner'],
    'disks_exclude': [],       # drive letters or mount points to leave out
    'gpu': False,              # read the GPU in this sample (the caller spaces GPU reads out)
    'gpu_source': 'auto',      # auto | nvidia-smi | perf | off
    'gpu_perf_counter': r'\GPU Engine(*engtype_3D)\Utilization Percentage',
    'timeout_s': 8,
}


# ------------------------------------------------------------------ helpers (pure, tested)

def run(argv, timeout):
    """(exit code, stdout) or (None, '') when the tool is missing or hangs. stderr is dropped."""
    if not shutil.which(argv[0]):
        return None, ''
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                           timeout=timeout, text=True, encoding='utf8', errors='replace',
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return p.returncode, p.stdout or ''
    except (OSError, subprocess.SubprocessError):
        return None, ''


def num(v):
    try:
        return float(str(v).strip())
    except ValueError:
        return None


def parse_nvidia(text):
    """nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits"""
    gpus = []
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(',')]
        if len(parts) < 5 or not parts[0]:
            continue
        gpus.append({'name': parts[0], 'util': num(parts[1]), 'mem_used_mb': num(parts[2]),
                     'mem_total_mb': num(parts[3]), 'temp_c': num(parts[4])})
    return gpus


def parse_typeperf(text):
    """Sum of the 3D-engine utilisation columns of one typeperf sample, capped at 100; None when unreadable."""
    rows = [line for line in text.splitlines() if line.startswith('"')]
    if len(rows) < 2:
        return None
    values = [num(v.strip('"')) for v in rows[-1].split('","')[1:]]
    values = [v for v in values if v is not None]
    if not values:
        return None
    return round(min(100.0, sum(values)), 1)


def core_pcts(prev, cur):
    """Per-core busy % from two lists of (idle, total) times."""
    out = []
    for (pi, pt), (ci, ct) in zip(prev, cur):
        dt = ct - pt
        out.append(round(max(0.0, min(100.0, 100.0 * (1 - (ci - pi) / dt))), 1) if dt > 0 else 0.0)
    return out


def family_of(name, families):
    n = name.lower()
    if n.endswith('.exe'):
        n = n[:-4]
    for fam, prefixes in families.items():
        for p in prefixes:
            p = p.lower()
            # the whole name, or the prefix then a non-letter: git-remote-https and python3.14 match, gitlab-runner not
            if n == p or (n.startswith(p) and not n[len(p)].isalpha()):
                return fam
    return ''


def summarize_procs(procs, prev_procs, wall_100ns, ncpu, req):
    """procs: {pid: (name, parent, cpu_100ns, create, ram)}. Top N by CPU and RAM, family totals, runner children."""
    rows = []
    for pid, (name, parent, cpu_t, create, ram) in procs.items():
        p = prev_procs.get(str(pid)) if prev_procs else None
        cpu = None
        if p and p[1] == create and wall_100ns > 0 and cpu_t is not None:
            cpu = round(max(0.0, 100.0 * (cpu_t - p[0]) / (wall_100ns * ncpu)), 1)
        rows.append({'pid': pid, 'name': name, 'parent': parent, 'cpu': cpu, 'ram': ram or 0,
                     'family': family_of(name, req['families'])})
    n = req['top_n']
    top_cpu = sorted([r for r in rows if r['cpu'] is not None], key=lambda r: -r['cpu'])[:n]
    top_ram = sorted(rows, key=lambda r: -r['ram'])[:n]
    fams = {}
    for r in rows:
        if not r['family']:
            continue
        f = fams.setdefault(r['family'], {'count': 0, 'cpu': 0.0, 'ram': 0})
        f['count'] += 1
        f['cpu'] = round(f['cpu'] + (r['cpu'] or 0), 1)
        f['ram'] += r['ram']
    runner_pids = {r['pid'] for r in rows if family_of(r['name'], {'r': req['runner_process']})}
    children = [r for r in rows if r['parent'] in runner_pids and r['pid'] not in runner_pids]
    strip = lambda r: {k: r[k] for k in ('pid', 'name', 'cpu', 'ram', 'family')}  # noqa: E731
    return {
        'count': len(rows),
        # processes this user cannot open (services, protected processes without admin rights): no CPU, no memory
        'unreadable': sum(1 for v in procs.values() if v[2] is None),
        'cpu_attributed': round(sum(r['cpu'] or 0 for r in rows), 1),
        'top_cpu': [strip(r) for r in top_cpu],
        'top_ram': [strip(r) for r in top_ram],
        'families': fams,
        'runner': {'present': bool(runner_pids), 'children': len(children)},
    }


# ------------------------------------------------------------------ Windows readers (ctypes)

if IS_WIN:
    import ctypes as C
    from ctypes import wintypes as W

    _k32 = C.WinDLL('kernel32', use_last_error=True)
    _nt = C.WinDLL('ntdll')

    class _SPPI(C.Structure):  # SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION
        _fields_ = [('Idle', C.c_longlong), ('Kernel', C.c_longlong), ('User', C.c_longlong),
                    ('Dpc', C.c_longlong), ('Interrupt', C.c_longlong), ('Count', C.c_ulong)]

    class _MEM(C.Structure):  # MEMORYSTATUSEX
        _fields_ = [('dwLength', W.DWORD), ('dwMemoryLoad', W.DWORD), ('ullTotalPhys', C.c_ulonglong),
                    ('ullAvailPhys', C.c_ulonglong), ('ullTotalPageFile', C.c_ulonglong),
                    ('ullAvailPageFile', C.c_ulonglong), ('ullTotalVirtual', C.c_ulonglong),
                    ('ullAvailVirtual', C.c_ulonglong), ('ullAvailExtendedVirtual', C.c_ulonglong)]

    class _PE32(C.Structure):  # PROCESSENTRY32W
        _fields_ = [('dwSize', W.DWORD), ('cntUsage', W.DWORD), ('th32ProcessID', W.DWORD),
                    ('th32DefaultHeapID', C.c_size_t), ('th32ModuleID', W.DWORD), ('cntThreads', W.DWORD),
                    ('th32ParentProcessID', W.DWORD), ('pcPriClassBase', W.LONG), ('dwFlags', W.DWORD),
                    ('szExeFile', W.WCHAR * 260)]

    class _PMC(C.Structure):  # PROCESS_MEMORY_COUNTERS
        _fields_ = [('cb', W.DWORD), ('PageFaultCount', W.DWORD), ('PeakWorkingSetSize', C.c_size_t),
                    ('WorkingSetSize', C.c_size_t), ('QuotaPeakPagedPoolUsage', C.c_size_t),
                    ('QuotaPagedPoolUsage', C.c_size_t), ('QuotaPeakNonPagedPoolUsage', C.c_size_t),
                    ('QuotaNonPagedPoolUsage', C.c_size_t), ('PagefileUsage', C.c_size_t),
                    ('PeakPagefileUsage', C.c_size_t)]

    _k32.CreateToolhelp32Snapshot.restype = W.HANDLE
    _k32.CreateToolhelp32Snapshot.argtypes = [W.DWORD, W.DWORD]
    _k32.Process32FirstW.argtypes = [W.HANDLE, C.POINTER(_PE32)]
    _k32.Process32NextW.argtypes = [W.HANDLE, C.POINTER(_PE32)]
    _k32.OpenProcess.restype = W.HANDLE
    _k32.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
    _k32.CloseHandle.argtypes = [W.HANDLE]
    _k32.GetProcessTimes.argtypes = [W.HANDLE] + [C.POINTER(C.c_ulonglong)] * 4
    _k32.K32GetProcessMemoryInfo.argtypes = [W.HANDLE, C.POINTER(_PMC), W.DWORD]
    _k32.GetDriveTypeW.argtypes = [W.LPCWSTR]

    def read_cores():
        n = os.cpu_count() or 1
        arr = (_SPPI * n)()
        got = C.c_ulong(0)
        if _nt.NtQuerySystemInformation(8, C.byref(arr), C.sizeof(arr), C.byref(got)) != 0:
            return []
        k = max(1, got.value // C.sizeof(_SPPI))
        # Kernel time includes idle time.
        return [(arr[i].Idle, arr[i].Kernel + arr[i].User) for i in range(min(n, k))]

    def read_ram():
        m = _MEM()
        m.dwLength = C.sizeof(_MEM)
        if not _k32.GlobalMemoryStatusEx(C.byref(m)):
            return None
        used = m.ullTotalPhys - m.ullAvailPhys
        return {'total': m.ullTotalPhys, 'used': used, 'pct': round(100.0 * used / m.ullTotalPhys, 1)}

    def drive_roots(exclude):
        mask = _k32.GetLogicalDrives()
        out = []
        for i in range(26):
            if mask & (1 << i):
                root = f'{chr(65 + i)}:\\'
                if _k32.GetDriveTypeW(root) == 3 and chr(65 + i) + ':' not in {e.upper().rstrip('\\/') for e in exclude}:
                    out.append(root)  # 3 = DRIVE_FIXED
        return out

    def read_procs():
        snap = _k32.CreateToolhelp32Snapshot(2, 0)  # TH32CS_SNAPPROCESS
        if not snap or snap == W.HANDLE(-1).value:
            return {}
        out = {}
        e = _PE32()
        e.dwSize = C.sizeof(_PE32)
        try:
            ok = _k32.Process32FirstW(snap, C.byref(e))
            while ok:
                pid = e.th32ProcessID
                cpu_t = create = None
                ram = 0
                h = _k32.OpenProcess(0x1000, False, pid) if pid else None  # PROCESS_QUERY_LIMITED_INFORMATION
                if h:
                    c, x, kt, ut = (C.c_ulonglong() for _ in range(4))
                    if _k32.GetProcessTimes(h, C.byref(c), C.byref(x), C.byref(kt), C.byref(ut)):
                        cpu_t, create = kt.value + ut.value, c.value
                    pmc = _PMC()
                    pmc.cb = C.sizeof(_PMC)
                    if _k32.K32GetProcessMemoryInfo(h, C.byref(pmc), pmc.cb):
                        ram = pmc.WorkingSetSize
                    _k32.CloseHandle(h)
                out[pid] = (e.szExeFile, e.th32ParentProcessID, cpu_t, create, ram)
                ok = _k32.Process32NextW(snap, C.byref(e))
        finally:
            _k32.CloseHandle(snap)
        return out


# ------------------------------------------------------------------ Linux readers (/proc), used by CI and elsewhere

else:
    _TICK = os.sysconf('SC_CLK_TCK') if hasattr(os, 'sysconf') else 100
    _PAGE = os.sysconf('SC_PAGE_SIZE') if hasattr(os, 'sysconf') else 4096

    def read_cores():
        out = []
        try:
            with open('/proc/stat') as f:
                for line in f:
                    if line.startswith('cpu') and line[3:4].isdigit():
                        v = [int(x) for x in line.split()[1:]]
                        out.append((v[3] + (v[4] if len(v) > 4 else 0), sum(v[:8])))
        except OSError:
            pass
        return out

    def read_ram():
        info = {}
        try:
            with open('/proc/meminfo') as f:
                for line in f:
                    k, _, rest = line.partition(':')
                    info[k] = int(rest.split()[0]) * 1024
        except (OSError, ValueError, IndexError):
            return None
        total, avail = info.get('MemTotal'), info.get('MemAvailable')
        if not total or avail is None:
            return None
        return {'total': total, 'used': total - avail, 'pct': round(100.0 * (total - avail) / total, 1)}

    def drive_roots(exclude):
        return [] if '/' in exclude else ['/']

    def read_procs():
        out = {}
        for d in os.listdir('/proc') if os.path.isdir('/proc') else []:
            if not d.isdigit():
                continue
            try:
                with open(f'/proc/{d}/stat') as f:
                    s = f.read()
                name = s[s.index('(') + 1:s.rindex(')')]
                v = s[s.rindex(')') + 2:].split()
                with open(f'/proc/{d}/statm') as f:
                    rss = int(f.read().split()[1]) * _PAGE
                cpu_t = (int(v[11]) + int(v[12])) * 10_000_000 // _TICK
                out[int(d)] = (name, int(v[1]), cpu_t, int(v[19]), rss)
            except (OSError, ValueError, IndexError):
                continue
        return out


def read_disks(exclude):
    out = []
    for root in drive_roots(exclude):
        try:
            u = shutil.disk_usage(root)
        except OSError:
            continue
        out.append({'drive': root.rstrip('\\') or root, 'total': u.total, 'free': u.free,
                    'pct_used': round(100.0 * (u.total - u.free) / u.total, 1) if u.total else 0.0})
    return out


def read_gpu(req):
    src = req['gpu_source']
    t = req['timeout_s']
    if src in ('auto', 'nvidia-smi'):
        code, out = run(['nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
                         '--format=csv,noheader,nounits'], t)
        gpus = parse_nvidia(out) if code == 0 else []
        if gpus:
            return {'source': 'nvidia-smi', 'gpus': gpus}
    if src in ('auto', 'perf') and IS_WIN:
        code, out = run(['typeperf', req['gpu_perf_counter'], '-sc', '1'], max(t, 10))
        util = parse_typeperf(out) if code == 0 else None
        if util is not None:
            return {'source': 'perf', 'gpus': [{'name': 'GPU', 'util': util, 'mem_used_mb': None,
                                                'mem_total_mb': None, 'temp_c': None}]}
    return {'source': 'none', 'gpus': []}


def raw_now():
    return {'t': time.time(), 'cores': read_cores(), 'procs': read_procs()}


def sample(req):
    req = {**SAMPLE_DEFAULTS, **(req or {})}
    started = time.time()
    prev = req.get('prev')
    if not (isinstance(prev, dict) and prev.get('cores') and prev.get('t')):
        first = raw_now()
        time.sleep(max(0, req['first_delta_ms']) / 1000)
        prev = {'t': first['t'], 'cores': first['cores'],
                'procs': {str(k): [v[2], v[3]] for k, v in first['procs'].items() if v[2] is not None}}
    cur = raw_now()
    ncpu = len(cur['cores']) or (os.cpu_count() or 1)
    cores = core_pcts([tuple(x) for x in prev['cores']], cur['cores']) if len(prev['cores']) == len(cur['cores']) else []
    total = round(sum(cores) / len(cores), 1) if cores else None
    wall = max(0.0, cur['t'] - prev['t']) * 10_000_000
    procs = summarize_procs(cur['procs'], prev.get('procs') or {}, wall, ncpu, req)
    out = {
        'platform': sys.platform,
        'at': int(cur['t'] * 1000),
        'interval_ms': int((cur['t'] - prev['t']) * 1000),
        'ncpu': ncpu,
        'cpu': {'total': total, 'cores': cores},
        'ram': read_ram(),
        'disks': read_disks(req['disks_exclude']),
        'procs': procs,
        'gpu': read_gpu(req) if req['gpu'] and req['gpu_source'] != 'off' else None,
        'raw': {'t': cur['t'], 'cores': [list(x) for x in cur['cores']],
                'procs': {str(k): [v[2], v[3]] for k, v in cur['procs'].items() if v[2] is not None}},
    }
    out['ms'] = int((time.time() - started) * 1000)
    return out


# ------------------------------------------------------------------ GitLab runner load, through the ci mod

def runner_from_status(cfg, st, ids):
    """Counts only (runners online, jobs running / pending) for the gitlab backends named in ids (all when empty)."""
    out = []
    for b in cfg.get('backends', []):
        if b.get('kind') != 'gitlab' or (ids and b.get('id') not in ids) or (not ids and not b.get('runner_tag')):
            continue
        c = (st.get('checks') or {}).get(b['id']) or {}
        conc = b.get('concurrent')
        out.append({
            'id': b['id'],
            'label': b.get('label', b['id']),
            'tag': b.get('runner_tag', ''),
            'concurrent': conc if isinstance(conc, int) else None,
            'usable': c.get('usable', 'unknown'),
            'why': c.get('why', 'not checked yet'),
            'runners': c.get('runners'),
            'jobs': c.get('jobs'),
        })
    return {'generated': st.get('generated'), 'backends': out}


def runner(ci_path, ci_config=None, refresh=False, ids=None):
    ci_path = os.path.abspath(os.path.expanduser(ci_path))
    if not os.path.isfile(ci_path):
        return {'error': f'ci mod scanner not found ({os.path.basename(ci_path)})'}
    sys.path.insert(0, os.path.dirname(ci_path))
    try:
        import ci  # the ci mod's scanner: its config, its status cache, its token rules
        cfg = ci.load_config(ci_config or None)
        st = ci.status(cfg, refresh=refresh)
    except SystemExit as err:
        return {'error': str(err)}
    except Exception as err:  # a broken ci config must not break the machine view
        return {'error': f'ci.py: {type(err).__name__}'}
    return runner_from_status(cfg, st, ids or [])


def main(argv=None):
    ap = argparse.ArgumentParser(prog='machine.py', description=__doc__.split('\n')[0])
    ap.add_argument('command', choices=['sample', 'runner'])
    ap.add_argument('--ci', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'ci',
                                                  'scanner', 'ci.py'))
    ap.add_argument('--ci-config')
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--backend', action='append')
    a = ap.parse_args(argv)
    if a.command == 'sample':
        text = sys.stdin.read() if not sys.stdin.isatty() else ''
        try:
            req = json.loads(text) if text.strip() else {}
        except ValueError:
            req = {}
        out = sample(req)
    else:
        out = runner(a.ci, a.ci_config, a.refresh, a.backend)
    print(json.dumps(out, separators=(',', ':')))
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
        write_health('machine', repr(_err))
        raise
    write_health('machine', None if not _rc else 'exit %s' % _rc)
    sys.exit(_rc)
