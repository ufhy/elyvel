export declare const DEFAULT_HOT_FILE = 'public/hot'

export interface ElyvelPluginConfig {
  /** Where to write the hot file. Must match `viteTags`' `hotFile`. Default `public/hot`. */
  hotFile?: string
}

/** Vite plugin: writes the hot file while the dev server runs, removes it on exit. */
export declare function elyvel(config?: ElyvelPluginConfig): {
  name: string
  configureServer(server: any): void
}
