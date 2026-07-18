import type { ConfigData } from './config'
import type { SessionConfig } from './config-schema'
import type { Token } from './container'
import type { OpenApiConfig } from './http/openapi'
import type { LogChannelConfig, LogLevel, Transport } from './logger'
import type { MiddlewareConfig } from './middleware'
import type { ServiceProvider, ServiceProviderClass } from './service-provider'
import type { ResolvedSessionConfig } from './session'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { ConfigRepository, ConfigToken, setConfigRepository } from './config'
import { Container } from './container'
import { getAppTimezone, setAppTimezone, setRequestTimezone } from './datetime'
import { errorPages } from './http/error-pages'
import { methodOverride } from './http/method-override'
import { openApiPlugin } from './http/openapi'
import { httpResponses } from './http/plugin'
import {
  BufferedFileTransport,
  ConsoleTransport,
  DailyFileTransport,
  FileTransport,

  Logger,
  LoggerToken,

  LogManager,
  LogManagerToken,

} from './logger'
import { maintenanceMode } from './maintenance'
import {
  globalMiddlewarePlugin,

  registerMiddlewareRegistry,
} from './middleware'
import { requestContext, setRequestLogger } from './request-context'
import { loadRoutes } from './router'
import { CsrfMiddleware, sessionPlugin } from './session'

import { ThrottleMiddleware } from './throttle'

type ChannelConfig = LogChannelConfig

let processLoggingInstalled = false

function installProcessLogging(logger: Logger): void {
  if (processLoggingInstalled)
    return
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
// The running application for this process, set by create(). Backs the global
// app()/config() helpers so code outside a provider can reach the container —
// one running app per process, mirroring the setAppTimezone default pattern.
let currentApp: Application | null = null

/** The running application. Throws if called before `Application.create()`. */
export function application(): Application {
  if (!currentApp) {
    throw new Error(
      '[elysia-ravel] No application has booted yet. Call Application.create() first.',
    )
  }
  return currentApp
}

/**
 * Global access to the running application / container — Laravel's `app()`
 * helper. With no argument returns the {@link Application}; with a token it
 * resolves that binding from the container.
 */
export function app(): Application
export function app<T>(token: Token<T>): T
export function app<T>(token?: Token<T>): Application | T {
  const instance = application()
  return token ? instance.make(token) : instance
}

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
    currentApp = app

    await app.loadConfig()
    setAppTimezone(app.config.get<string>('app.timezone') ?? 'UTC')
    app.registerLogger()
    app.registerCoreBindings()
    // Earliest guard: a maintenance outage short-circuits every request.
    app.registerMaintenance()
    app.registerHttpLogger()
    app.registerMiddleware()
    app.registerHttpResponses()
    app.registerSession()
    // After session so its 422 validation redirect-back wins before we render.
    app.registerErrorPages()
    // After session so the per-request timezone can read a user's session pref.
    app.registerTimezone()
    // Before routes so the OpenAPI plugin observes them all.
    await app.registerOpenApi()

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
        const module = (await import(join(configDir, file))) as {
          default?: Record<string, unknown>
        }
        if (module.default)
          data[namespace] = module.default
      }
    }

    const repository = new ConfigRepository(data)
    this.container.instance(ConfigToken, repository)
    setConfigRepository(repository)
  }

  private registerLogger(): void {
    const isProduction = this.config.get<string>('app.env') === 'production'
    const pretty = this.config.get<boolean>('logging.pretty') ?? !isProduction
    const level = this.config.get<LogLevel>('logging.level') ?? 'info'
    const redact = this.config.get<string[] | undefined>('logging.redact')
    const redactPatterns = (
      this.config.get<string[] | undefined>('logging.redactPatterns') ?? []
    ).map(p => new RegExp(p, 'g'))
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
        if (cfg.driver !== 'stack')
          transportsByChannel.set(name, this.buildTransports(cfg, pretty))
      }
      const resolve = (names: string[]) => names.flatMap(n => transportsByChannel.get(n) ?? [])

      channels = new Map()
      for (const [name, cfg] of Object.entries(channelConfigs)) {
        const transports
          = cfg.driver === 'stack'
            ? resolve(cfg.channels ?? [])
            : (transportsByChannel.get(name) ?? [])
        channels.set(name, new Logger({ ...base, level: cfg.level ?? level, transports }))
      }

      const def = this.config.get<string | string[]>('logging.default', 'stack')
      if (typeof def === 'string' && channels.has(def)) {
        defaultLogger = channels.get(def) as Logger
      }
      else {
        const names = Array.isArray(def) ? def : [...transportsByChannel.keys()]
        defaultLogger = new Logger({ ...base, transports: resolve(names) })
      }
    }
    else {
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

  /** The maintenance-mode `down` file path (`storage/framework/down`). */
  maintenanceFile(): string {
    return this.path('storage/framework/down')
  }

  private registerMaintenance(): void {
    this.elysia.use(maintenanceMode(this.maintenanceFile()))
  }

  private registerHttpLogger(): void {
    if (this.config.get<boolean>('logging.http') === false)
      return
    this.elysia.use(requestContext(this.logger))
  }

  /**
   * Wire `config/middleware.ts`: register alias/group registries (used by the
   * `route()`/`group()` helpers) and mount global middleware on the root
   * instance — before routes load, so every route is covered.
   */
  private registerMiddleware(): void {
    const config = this.config.get<MiddlewareConfig | undefined>('middleware') ?? {}
    // Seed built-in aliases + groups (user config can override them). The `web`
    // group bundles CSRF (Laravel's web group) — apply it to browser/session
    // routes with `group('web')`. It's a group, not a global, so API/token routes
    // (which are CSRF-immune) stay clean; override by defining your own `web`.
    registerMiddlewareRegistry({
      ...config,
      aliases: { throttle: ThrottleMiddleware, csrf: CsrfMiddleware, ...config.aliases },
      groups: { web: ['csrf'], ...config.groups },
    })
    if (config.global?.length) {
      this.elysia.use(globalMiddlewarePlugin(config.global))
    }
  }

  /** Mount the session plugin (before routes) when `config/session.ts` is present. */
  /** Mount response normalization (redirects → 303) before the session plugin. */
  private registerHttpResponses(): void {
    this.elysia.use(httpResponses())
  }

  /** Render styled HTML error pages for browsers (JSON for API) — framework default. */
  private registerErrorPages(): void {
    this.elysia.use(errorPages())
  }

  /**
   * Resolve a per-request timezone (a signed-in user's `session.timezone`, else a
   * `timezone` cookie) and expose it as `ctx.timezone`. Falls back to the app
   * default (`config('app.timezone')`). Lets `formatDate()`/`dateParts()` render
   * in each user's zone without threading it through every call.
   */
  private registerTimezone(): void {
    const isValidTz = (tz: unknown): tz is string => {
      if (typeof tz !== 'string' || !tz)
        return false
      try {
        // eslint-disable-next-line no-new
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
      }
      catch {
        return false
      }
    }
    const readCookie = (header: string | null, name: string): string | undefined => {
      for (const part of header?.split(';') ?? []) {
        const [k, v] = part.trim().split('=')
        if (k === name && v)
          return decodeURIComponent(v)
      }
      return undefined
    }
    this.elysia.derive({ as: 'global' }, (ctx: { request: Request, session?: { get?(k: string): unknown } }) => {
      const fromSession = ctx.session?.get?.('timezone')
      const candidate = isValidTz(fromSession)
        ? fromSession
        : readCookie(ctx.request.headers.get('cookie'), 'timezone')
      const timezone = isValidTz(candidate) ? candidate : getAppTimezone()
      if (timezone !== getAppTimezone())
        setRequestTimezone(timezone)
      return { timezone }
    })
  }

  /**
   * Mount interactive OpenAPI docs (Scalar UI at `/openapi`, spec at `/openapi/json`),
   * built from Elysia's typed route schemas. On by default outside production; set
   * `config('openapi.enabled')` to override. Skipped if `@elysiajs/openapi` is absent.
   */
  private async registerOpenApi(): Promise<void> {
    const cfg = this.config.get<OpenApiConfig | undefined>('openapi') ?? {}
    const env = this.config.get<string>('app.env') ?? process.env.NODE_ENV ?? 'development'
    if ((cfg.enabled ?? env !== 'production') === false)
      return
    const plugin = await openApiPlugin({
      ...cfg,
      title: cfg.title ?? this.config.get<string>('app.name') ?? 'API',
      version: cfg.version ?? this.config.get<string>('app.version') ?? '1.0.0',
    })
    if (plugin)
      this.elysia.use(plugin)
  }

  private registerSession(): void {
    const cfg = this.config.get<SessionConfig | undefined>('session')
    if (!cfg)
      return
    const driver = cfg.driver ?? 'cookie'
    const secret = cfg.secret ?? this.config.get<string | undefined>('app.key')
    if (driver === 'cookie' && !secret) {
      throw new Error(
        '[elysia-ravel] Session cookie driver needs a secret — set `app.key` or `session.secret`.',
      )
    }
    this.elysia.use(
      sessionPlugin({
        driver,
        cookie: cfg.cookie ?? 'ravel_session',
        lifetime: cfg.lifetime ?? 7200,
        secret: secret ?? '',
        files: this.path(cfg.files ?? 'storage/framework/sessions'),
        redisUrl: cfg.redisUrl,
        path: cfg.path ?? '/',
        domain: cfg.domain,
        secure: cfg.secure ?? false,
        httpOnly: cfg.httpOnly ?? true,
        sameSite: cfg.sameSite ?? 'lax',
        expireOnClose: cfg.expireOnClose ?? false,
      } satisfies ResolvedSessionConfig),
    )
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
    if (!existsSync(routesDir))
      return

    const routers = await loadRoutes(routesDir)
    for (const router of routers) {
      this.elysia.use(router)
    }
  }

  private async boot(): Promise<void> {
    if (this.booted)
      return
    for (const provider of this.providers) await provider.register()
    for (const provider of this.providers) await provider.boot()
    this.booted = true
  }

  /**
   * Start the HTTP server. Port resolution order:
   * explicit arg → `config('app.port')` → `PORT` env → 3000.
   */
  async listen(port?: number): Promise<Application> {
    const resolved = port ?? this.config.get<number>('app.port') ?? Number(process.env.PORT) ?? 3000
    // Serve through our own fetch so method spoofing runs before Elysia routes.
    // If a WebSocket handler is registered (e.g. broadcasting), upgrade handshakes.
    const ws = this.wsHandler
    const server = Bun.serve({
      port: resolved,
      websocket: ws?.handler,
      fetch: (request, srv) => {
        if (ws && srv.upgrade(request))
          return undefined
        return this.handle(request)
      },
    })
    ws?.onServer?.(server)
    this.logger.info(`${this.config.get('app.name') ?? 'elysia-ravel'} listening`, {
      url: `http://localhost:${resolved}`,
    })
    return this
  }

  private wsHandler: { handler: any, onServer?(server: any): void } | null = null
  /**
   * Register a Bun WebSocket handler; `listen()` upgrades WS handshakes to it and
   * calls `onServer` with the running server (used by broadcasting for pub/sub).
   */
  webSocket(handler: any, onServer?: (server: any) => void): void {
    this.wsHandler = { handler, onServer }
  }

  /**
   * Handle a request through the framework: apply HTTP method spoofing
   * (`_method`) before delegating to Elysia's router. Used by {@link listen}
   * and available for tests.
   */
  async handle(request: Request): Promise<Response> {
    return this.elysia.handle(await methodOverride(request))
  }
}

/** Convenience wrapper mirroring `Application.create`. */
export function createApp(options?: CreateAppOptions): Promise<Application> {
  return Application.create(options)
}
