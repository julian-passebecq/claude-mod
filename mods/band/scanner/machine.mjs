// band mod scanner: the small CPU % and GPU % of the Jauge's line 2. Read-only, local, no network.
// CPU: busy share of all cores between two scans (os.cpus() times; the previous times are kept in the state file).
// GPU: nvidia-smi when present, else on Windows the 3D-engine performance counter through typeperf (the machine mod's
// two sources, summed and capped at 100), read at most every gpu_every_s seconds and kept in the state file between.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname } from 'node:path'

export const MACHINE_DEFAULTS = {
  enabled: true,
  state_file: '~/.claude/band/machine.json',
  gpu_source: 'auto',
  gpu_every_s: 60,
  gpu_timeout_ms: 4000,
  gpu_perf_counter: '\\GPU Engine(*engtype_3D)\\Utilization Percentage',
}

/** [idle, total] summed over the cores. */
export const cpuTimes = (cpus) => {
  let idle = 0
  let total = 0
  for (const c of cpus || []) {
    const t = c && c.times
    if (!t) continue
    idle += t.idle || 0
    total += (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.idle || 0) + (t.irq || 0)
  }
  return [idle, total]
}

/** Busy % between two [idle, total] readings; undefined when there is no earlier one or no time passed. */
export const cpuPct = (prev, cur) => {
  if (!Array.isArray(prev) || !Array.isArray(cur)) return undefined
  const dt = cur[1] - prev[1]
  if (!(dt > 0)) return undefined
  return Math.max(0, Math.min(100, Math.round(100 * (1 - (cur[0] - prev[0]) / dt))))
}

/** nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits -> the highest GPU %. */
export const parseNvidia = (text) => {
  const vals = String(text || '').split(/\r?\n/).map((l) => Number(l.trim())).filter((x) => Number.isFinite(x))
  return vals.length ? Math.max(...vals) : undefined
}

/** One typeperf sample: the 3D-engine columns summed and capped at 100. */
export const parseTypeperf = (text) => {
  const rows = String(text || '').split(/\r?\n/).filter((l) => l.startsWith('"'))
  if (rows.length < 2) return undefined
  const vals = rows[rows.length - 1].split('","').slice(1).map((v) => Number(v.replace(/"/g, '').trim())).filter((x) => Number.isFinite(x))
  return vals.length ? Math.round(Math.min(100, vals.reduce((a, b) => a + b, 0))) : undefined
}

const run = (cmd, args, timeout) => execFileSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })

export function readGpu(cfg, platform = process.platform, exec = run) {
  const src = cfg.gpu_source || 'auto'
  if (src === 'off') return undefined
  if (src === 'auto' || src === 'nvidia-smi') {
    try {
      const v = parseNvidia(exec('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], cfg.gpu_timeout_ms))
      if (v !== undefined) return v
    } catch { /* no NVIDIA driver */ }
  }
  if ((src === 'auto' || src === 'typeperf') && platform === 'win32') {
    try {
      return parseTypeperf(exec('typeperf', [cfg.gpu_perf_counter, '-sc', '1'], cfg.gpu_timeout_ms))
    } catch { /* counter missing */ }
  }
  return undefined
}

const home = (p) => String(p).replace(/^~(?=$|[\\/])/, os.homedir())

/** CPU and GPU now, from the state file's last readings. { cpu?, gpu? }; never throws. */
export function sampleMachine(raw = {}, now = Date.now(), deps = {}) {
  const cfg = { ...MACHINE_DEFAULTS, ...(raw || {}) }
  if (cfg.enabled === false) return {}
  const file = home(cfg.state_file)
  let st = {}
  try {
    st = JSON.parse(readFileSync(file, 'utf8')) || {}
  } catch { /* first run */ }
  const cur = cpuTimes((deps.cpus || os.cpus)())
  const cpu = cpuPct(st.cpu, cur)
  let gpu = Number.isFinite(st.gpu) ? st.gpu : undefined
  let gpuAt = st.gpuAt || 0
  if (cfg.gpu_source !== 'off' && now - gpuAt >= cfg.gpu_every_s * 1000) {
    gpu = (deps.readGpu || readGpu)(cfg)
    gpuAt = now
  }
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file + '.tmp', JSON.stringify({ cpu: cur, at: now, ...(gpu !== undefined ? { gpu } : {}), gpuAt }))
    renameSync(file + '.tmp', file)
  } catch { /* read-only home: no CPU % next time */ }
  return { ...(cpu !== undefined ? { cpu } : {}), ...(gpu !== undefined && cfg.gpu_source !== 'off' ? { gpu } : {}) }
}
