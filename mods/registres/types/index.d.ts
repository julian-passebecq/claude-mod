// Types of the registres mod: the `$.state` values the pane reads (one set per tab, mirroring the owner mods').

declare module 'claude-code' {
  interface PluginState {
    registres: {
      /** shown tab: problemes | tests | regles | menage */
      tab: string
      /** Problèmes: status, period, category and app filters, open nodes, last note result */
      p_status: string
      p_week: string
      p_category: string
      p_app: string
      p_open: string[]
      p_note: string
      /** Tests réels: open blocks (null = the config's default), revealed logins (app|login), last action line */
      t_open: string[] | null
      t_reveal: string[]
      t_status: string
      /** Règles: rules version of the before/after table (empty = latest) */
      r_version: string
      /** Ménage: row filter, last copy result */
      m_filter: string
      m_copied: string
    }
  }
}

export type Tab = 'problemes' | 'tests' | 'regles' | 'menage'
