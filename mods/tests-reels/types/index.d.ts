// Types of the tests-reels mod: the `$.state` values the pane reads.

/** Result of a run: pass (green), fail (red), partial, ran (seen in history), never. */
export type Result = 'pass' | 'fail' | 'partial' | 'ran' | 'never'

declare module 'claude-code' {
  interface PluginState {
    'tests-reels': {
      /** ids of the open blocks: todo, app:<name>, app:<name>:rec */
      open: string[]
      /** accounts whose login is shown in clear (app|login) */
      reveal: string[]
      /** last action line under the buttons */
      status: string
    }
  }
}
