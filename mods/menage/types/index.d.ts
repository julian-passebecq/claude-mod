// Types of the menage mod: the `$.state` values the pane reads.

/** Row levels: safe (green), check (orange, à vérifier), danger (red, ne pas supprimer), info. */
export type Level = 'safe' | 'check' | 'danger' | 'info'

declare module 'claude-code' {
  interface PluginState {
    menage: {
      /** rows shown: all | safe (récupérable, sûr ou à vérifier) | danger (ne pas supprimer) */
      filter: string
      /** last copy result shown under the buttons */
      copied: string
    }
  }
}
