// `$.state` values of the usage mod.
declare module 'claude-code' {
  interface PluginState {
    usage: {
      /** tab the pane shows: today, week, forecast, scenarios, full */
      tab: string
      /** last copy's outcome line */
      copied: string
    }
  }
}
export {}
