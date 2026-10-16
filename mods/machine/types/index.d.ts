// Types of the machine mod: what scanner/machine.py prints (`sample`, `runner`) and the `$.state` values.

export type Proc = { pid: number; name: string; cpu: number | null; ram: number; family: string }
export type Family = { count: number; cpu: number; ram: number }
export type Disk = { drive: string; total: number; free: number; pct_used: number }
export type Gpu = { name: string; util: number | null; mem_used_mb: number | null; mem_total_mb: number | null; temp_c: number | null }
export type GpuInfo = { source: 'nvidia-smi' | 'perf' | 'none'; gpus: Gpu[] }

export type Raw = { t: number; cores: number[][]; procs: Record<string, number[]> }

export type Sample = {
  platform: string
  /** ms since epoch */
  at: number
  /** time between the two readings the % come from */
  interval_ms: number
  ncpu: number
  cpu: { total: number | null; cores: number[] }
  ram: { total: number; used: number; pct: number } | null
  disks: Disk[]
  procs: {
    count: number
    /** processes this user cannot open (services, protected processes, without admin rights) */
    unreadable?: number
    /** sum of the CPU % of the readable processes; total - this = CPU not attributed */
    cpu_attributed?: number
    top_cpu: Proc[]
    top_ram: Proc[]
    families: Record<string, Family>
    /** the runner process (ci.runner_process) and how many child processes it has now */
    runner: { present: boolean; children: number }
  }
  /** null when this sample did not read the GPU (read every gpu.refresh_s) */
  gpu: GpuInfo | null
  /** previous counters, passed back to the next sample (stripped before it goes into $.state) */
  raw?: Raw
  /** sampling time inside the scanner */
  ms: number
}

export type RunnerBackend = {
  id: string
  label: string
  tag: string
  concurrent: number | null
  usable: 'yes' | 'no' | 'unknown'
  why: string
  runners: { online: number; offline: number; total: number } | null
  jobs: { running: number | null; pending: number | null } | null
}
export type RunnerInfo = { generated: string | null; backends: RunnerBackend[]; error?: string }

declare module 'claude-code' {
  interface PluginState {
    machine: {
      /** last sample without its raw counters */
      sample: Sample | null
      /** last GPU reading (kept between GPU reads) */
      gpu: GpuInfo | null
      /** last runner reading from the ci mod's scanner */
      runner: RunnerInfo | null
      /** last error line, '' when fine */
      error: string
    }
  }
}
