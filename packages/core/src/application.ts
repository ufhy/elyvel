import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { type ConfigData, ConfigRepository, ConfigToken } from './config'
import { Container, type Token } from './container'
import {
  BufferedFileTransport,
  ConsoleTransport,
  DailyFileTransport,
  FileTransport,
  type LogChannelConfig,
  Logger,
  LogManager,
  LogManagerToken,
  type LogLevel,
  LoggerToken,
  type Transport,
} from './logger'
import { setAppTimezone } from './datetime'
import { requestContext, setRequestLogger } from './request-context'
import { loadRoutes } from './router'

type ChannelConfig = LogChannelConfig

let processLoggingInstalled = false

function installProcessLogging(logger: Logger): void {
  if (processLoggingInstalled) return
  processLoggingInstalled = true
  const fatal = logger.child('process')

  process.on('unhandledRejection', (reason) => {
    fatal.error('unhandledRejection', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })
  process.on('uncaughtException', (error) => {
    fatal.error('uncaughtException', { error: error.message, stack: error.stack })
    process.exit(1)
  })
}
import type { ServiceProvider, ServiceProviderClass } from './service-provider'

export interface CreateAppOptions {
  /** Project root that holds `config/` and `routes/`. Defaults to cwd. */
  basePath?: string
  /** Extra providers to register on top of those in `config/app.ts`. */
  providers?: ServiceProviderClass[]
  /** Skip the built-in `routes/` auto-loader (e.g. for tests). */
  autoloadRoutes?: boolean
}

/**
 * The application kernel. Wraps a root Elysia instance, owns the service
 * container, and drives the register → boot → listen lifecycle.
 *
 * It stays deliberately thin: everything user-facing (routes, DB, auth) is
 * added through {@link ServiceProvider}s, and the underlying Elysia instance
 * is always reachable via {@link Application.elysia} so nothing is hidden.
 */
export class Application {
  readonly elysia: Elysia
  readonly container = new Container()
  readonly basePath: string

  private readonly providers: ServiceProvider[] = []
  private booted = false

  private constructor(basePath: string) {
    this.basePath = basePath
    this.elysia = new Elysia({ name: 'elysia-ravel' })
  }

  /** Absolute path helper rooted at {@link basePath}. */
  path(...segments: string[]): string {
    return join(this.basePath, ...segments)
  }

  /** Shorthand for `container.make`. */
  make<T>(token: Token<T>): T {
    return this.container.make(token)
  }

  /** The typed config repository. */
  get config(): ConfigRepository {
    return this.container.make(ConfigToken)
  }

  /** The default application logger. */
  get logger(): Logger {
    return this.container.make(LoggerToken)
  }

  /** Resolve a named log channel (see `config/logging.ts`). */
  channel(name: string): Logger {
    return this.container.make(LogManagerToken).channel(name)
  }

  /**
   * Bootstrap an application: load config, register providers, boot them.
   * The returned app is ready to {@link listen}.
   */
  static async create(options: CreateAppOptions = {}): Promise<Application> {
    const basePath = options.basePath ?? process.cwd()
    const app = new Application(basePath)

    await app.loadConfig()
    setAppTimezone(app.config.get<string>('app.timezone') ?? 'UTC')
    app.registerLogger()
    app.registerCoreBindings()
    app.registerHttpLogger()

    const configured = app.config.get<ServiceProviderClass[]>('app.providers', [])
    const providerClasses = [...configured, ...(options.providers ?? [])]

    for (const Provider of providerClasses) {
      app.providers.push(new Provider(app))
    }

    if (options.autoloadRoutes !== false) {
      await app.loadRoutes()
    }

    await app.boot()
    return app
  }

  private async loadConfig(): Promise<void> {
    const configDir = this.path('config')
    const data: ConfigData = {}

    if (existsSync(configDir)) {
      const glob = new Bun.Glob('*.{ts,js}')
      for await (const file of glob.scan({ cwd: configDir, onlyFiles: true })) {
        const namespace = file.replace(/\.(ts|js)$/, '')
        const module = (await import(join(configDir, file))) as { default?: Record<string, unknown> }
        if (module.default) data[namespace] = module.default
      }
    }

    this.container.instance(ConfigToken, new ConfigRepository(data))
  }

  private registerLogger(): void {
    const isProduction = this.config.get<string>('app.env') === 'production'
    const pretty = this.config.get<boolean>('logging.pretty') ?? !isProduction
    const level = this.config.get<LogLevel>('logging.level') ?? 'info'
    const redact = this.config.get<string[] | undefined>('logging.redact')
    const redactPatterns = (this.config.get<string[] | undefined>('logging.redactPatterns') ?? []).map(
      (p) => new RegExp(p, 'g'),
    )
    const redactJson = this.config.get<boolean | undefined>('logging.redactJson')
    const base = { level, redact, redactPatterns, redactJson }

    const channelConfigs = this.config.get<Record<string, ChannelConfig> | undefined>(
      'logging.channels',
    )

    let channels: Map<string, Logger>
    let defaultLogger: Logger

    if (channelConfigs) {
      const transportsByChannel = new Map<string, Transport[]>()
      for (const [name, cfg] of Object.entries(channelConfigs)) {
        if (cfg.driver !== 'stack') transportsByChannel.set(name, this.buildTransports(cfg, pretty))
      }
      const resolve = (names: string[]) => names.flatMap((n) => transportsByChannel.get(n) ?? [])

      channels = new Map()
      for (const [name, cfg] of Object.entries(channelConfigs)) {
        const transports =
          cfg.driver === 'stack' ? resolve(cfg.channels ?? []) : (transportsByChannel.get(name) ?? [])
        channels.set(name, new Logger({ ...base, level: cfg.level ?? level, transports }))
      }

      const def = this.config.get<string | string[]>('logging.default', 'stack')
      if (typeof def === 'string' && channels.has(def)) {
        defaultLogger = channels.get(def) as Logger
      } else {
        const names = Array.isArray(def) ? def : [...transportsByChannel.keys()]
        defaultLogger = new Logger({ ...base, transports: resolve(names) })
      }
    } else {
      // No channels configured — console + optional single file.
      const transports: Transport[] = [new ConsoleTransport(pretty)]
      const file = this.config.get<string | undefined>('logging.file')
      if (file) {
        transports.push(
          new FileTransport(this.path(file), {
            maxBytes: this.config.get<number | undefined>('logging.maxBytes'),
            maxFiles: this.config.get<number | undefined>('logging.maxFiles'),
          }),
        )
      }
      defaultLogger = new Logger({ ...base, transports })
      channels = new Map([['default', defaultLogger]])
    }

    setRequestLogger(defaultLogger)
    this.container.instance(LoggerToken, defaultLogger)
    this.container.instance(LogManagerToken, new LogManager(channels, defaultLogger))
  }

  private buildTransports(cfg: ChannelConfig, pretty: boolean): Transport[] {
    switch (cfg.driver) {
      case 'console':
        return [new ConsoleTransport(cfg.pretty ?? pretty)]
      case 'file':
        return [
          cfg.buffered
            ? new BufferedFileTransport(this.path(cfg.path), cfg)
            : new FileTransport(this.path(cfg.path), cfg),
        ]
      case 'daily':
        return [new DailyFileTransport(this.path(cfg.path), { maxDays: cfg.maxDays })]
      default:
        return []
    }
  }

  private registerHttpLogger(): void {
    if (this.config.get<boolean>('logging.http') === false) return
    this.elysia.use(requestContext(this.logger))
  }

  /**
   * Install process-level handlers that log uncaught exceptions and unhandled
   * rejections through the app logger. Opt-in (call from your server entry) so
   * it never interferes with tests. Uncaught exceptions exit the process.
   */
  catchExceptions(): this {
    installProcessLogging(this.logger)
    return this
  }

  private registerCoreBindings(): void {
    // Expose config + logger + container to every request context, Elysia-first.
    this.elysia
      .decorate('config', this.config)
      .decorate('log', this.logger)
      .decorate('container', this.container)
  }

  private async loadRoutes(): Promise<void> {
    const routesDir = this.path('routes')
    if (!existsSync(routesDir)) return

    const routers = await loadRoutes(routesDir)
    for (const router of routers) {
      this.elysia.use(router)
    }
  }

  private async boot(): Promise<void> {
    if (this.booted) return
    for (const provider of this.providers) await provider.register()
    for (const provider of this.providers) await provider.boot()
    this.booted = true
  }

  /**
   * Start the HTTP server. Port resolution order:
   * explicit arg → `config('app.port')` → `PORT` env → 3000.
   */
  async listen(port?: number): Promise<Application> {
    const resolved =
      port ?? this.config.get<number>('app.port') ?? Number(process.env.PORT) ?? 3000
    this.elysia.listen(resolved)
    this.logger.info(`${this.config.get('app.name') ?? 'elysia-ravel'} listening`, {
      url: `http://localhost:${resolved}`,
    })
    return this
  }
}

/** Convenience wrapper mirroring `Application.create`. */
export function createApp(options?: CreateAppOptions): Promise<Application> {
  return Application.create(options)
}
