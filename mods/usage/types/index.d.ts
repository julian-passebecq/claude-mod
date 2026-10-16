// `$.state` values of the usage mod.

/** Tabs of the Consommation pane. */
export type UsageTab = 'today' | 'week' | 'forecast' | 'scenarios' | 'full' | 'codex'

declare module 'claude-code' {
  interface PluginState {
    usage: {
      /** tab the pane shows: today, week, forecast, scenarios, full, codex */
      tab: string
      /** last copy's outcome line */
      copied: string
    }
  }
}
