// Types of the problemes mod: the `$.state` values the pane reads.

declare module 'claude-code' {
  interface PluginState {
    problemes: {
      /** status filter: all | ouvert | corrigé | contourné | accepté */
      status: string
      /** period filter: all | this (this week) | 30d */
      week: string
      /** category filter: all | a category id */
      category: string
      /** application filter: all | an app name */
      app: string
      /** ids of the open tree nodes and problems */
      open: string[]
      /** last note result shown under the problem */
      noteMsg: string
    }
  }
}

export type Status = string
