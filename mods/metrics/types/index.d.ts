// Types of the metrics mod: the `$.state` value and the version window the scanner writes in metrics.json.

/** One rules version window: from its first commit (or the start of the history) to the next version (or now). */
export type VersionWindow = { version: string; start: number; sha: string; subject: string; from: number; to: number; hours: number }

declare module 'claude-code' {
  interface PluginState {
    metrics: {
      /** rules version the before/after table shows (V5.8); empty = the latest */
      version: string
    }
  }
}
