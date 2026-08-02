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
import { DriverRegistry, trans } from '@elyvel/support'
import { Elysia } from 'elysia'
import { ConfigRepository, ConfigToken, setConfigRepository } from './config'
import { Container } from './container'
import { currentTimezone, setAppTimezone } from './datetime'
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

/**
 * Loads `bootstrap/providers.generated.ts` — written by `elyvel package:discover`
 * — if present. Missing file (discovery never run, or nothing discoverable
 * installed) is NOT an error: this returns an empty array so app boot never
 * depends on that file existing.
 */
async function loadDiscoveredProviders(basePath: string): Promise<ServiceProviderClass[]> {
  const manifestPath = join(basePath, 'bootstrap', 'providers.generated.ts')
  if (!existsSync(manifestPath))
    return []
  const manifest = (await import(manifestPath)) as { discoveredProviders?: ServiceProviderClass[] }
  return manifest.discoveredProviders ?? []
}

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
      '[elyvel] No application has booted yet. Call Application.create() first.',
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

/**
 * Context a log-channel factory needs: the channel's own config, plus the
 * per-application bits it cannot know — how to resolve a relative path, and what
 * `pretty` defaults to for console and file.
 */
export interface LogDriverContext {
  config: LogChannelConfig
  path(relative: string): string
  consolePretty: boolean
  filePretty: boolean
}

const logDrivers = new DriverRegistry<Transport[], LogDriverContext>('Log channel driver')

/**
 * Register a log channel driver the framework doesn't ship — Laravel's
 * `Log::extend()`. Papertrail, a syslog socket, an HTTP sink: `Transport` was
 * always public, but `config/logging.ts` could only name four drivers.
 *
 * ```ts
 * registerLogDriver('http', ({ config }) => [new HttpTransport(config.url)])
 * ```
 */
export function registerLogDriver(
  name: string,
  factory: (context: LogDriverContext, name: string) => Transport[],
): void {
  logDrivers.extend(name, factory)
}

export class Application {
  readonly elysia: Elysia
  readonly container = new Container()
  readonly basePath: string

  private readonly providers: ServiceProvider[] = []
  private booted = false

  private constructor(basePath: string) {
    this.basePath = basePath
    this.elysia = new Elysia({ name: 'elyvel' })
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

  /**
   * The log manager — named channels plus `build()`/`stack()` for loggers
   * assembled at the call site (Laravel's `Log::build()` / `Log::stack()`).
   */
  get log(): LogManager {
    return this.container.make(LogManagerToken)
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

    const discovered = await loadDiscoveredProviders(app.basePath)
    const configured = app.config.get<ServiceProviderClass[]>('app.providers', [])
    // Discovered (package) providers first, then the app's own explicit list —
    // matches Laravel's ordering (package providers boot before the app's).
    // Deduped by class reference so a provider both auto-discovered AND
    // listed explicitly in config/app.ts only registers/boots once.
    const providerClasses = [...new Set([...discovered, ...configured, ...(options.providers ?? [])])]

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
    /**
     * The logger reads the LOGGING config and nothing else. It used to derive its
     * format from `app.env`, which meant a variable with no connection to logging
     * silently decided how log lines were written — and because files are
     * append-only, flipping APP_ENV mid-life left one `app.log` holding two
     * formats. The log viewer then showed 18 of its 64 entries.
     *
     * So: the console is human-readable and files are JSON, in every environment,
     * until `pretty` says otherwise. An app that wants the format to follow its
     * environment says so out loud in its own `config/logging.ts`, where that
     * decision is visible and deletable — the scaffolded config ships exactly that
     * line, commented, rather than hiding it in here.
     */
    const explicitPretty = this.config.get<boolean | undefined>('logging.pretty')
    const consolePretty = explicitPretty ?? true
    const filePretty = explicitPretty ?? false
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
          transportsByChannel.set(name, this.buildTransports(cfg, consolePretty, filePretty))
      }
      const resolve = (names: string[]) => names.flatMap(n => transportsByChannel.get(n) ?? [])

      channels = new Map()
      for (const [name, cfg] of Object.entries(channelConfigs)) {
        const transports
          = cfg.driver === 'stack'
            ? resolve(cfg.channels ?? [])
            : (transportsByChannel.get(name) ?? [])
        channels.set(name, new Logger({
          ...base,
          level: cfg.level ?? level,
          transports,
          // Only a `stack` carries this, matching Laravel's config shape.
          ignoreExceptions: cfg.driver === 'stack' ? cfg.ignoreExceptions : undefined,
        }))
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
      const transports: Transport[] = [new ConsoleTransport(consolePretty)]
      const file = this.config.get<string | undefined>('logging.file')
      if (file) {
        transports.push(
          new FileTransport(this.path(file), {
            maxBytes: this.config.get<number | undefined>('logging.maxBytes'),
            maxFiles: this.config.get<number | undefined>('logging.maxFiles'),
            // JSON unless asked otherwise — see registerLogger's note on why a
            // file's format must not follow the environment.
            pretty: filePretty,
          }),
        )
      }
      defaultLogger = new Logger({ ...base, transports })
      channels = new Map([['default', defaultLogger]])
    }

    setRequestLogger(defaultLogger)
    this.container.instance(LoggerToken, defaultLogger)
    this.container.instance(
      LogManagerToken,
      // The builder closes over the same base options and transport factory the
      // configured channels were built from, so an on-demand channel redacts and
      // formats identically to a declared one.
      new LogManager(channels, defaultLogger, cfg => new Logger({
        ...base,
        level: cfg.level ?? level,
        transports: this.buildTransports(cfg, consolePretty, filePretty),
      })),
    )
  }

  private buildTransports(cfg: ChannelConfig, consolePretty: boolean, filePretty: boolean): Transport[] {
    // A registered driver wins, so an app can add (or replace) one — Laravel's
    // `Log::extend()`. The built-ins below stay a switch because they need
    // `this.path()` and the two pretty defaults, which are per-application.
    if (logDrivers.has(cfg.driver))
      return logDrivers.resolve(cfg.driver, { config: cfg, path: p => this.path(p), consolePretty, filePretty })

    switch (cfg.driver) {
      case 'console':
        return [new ConsoleTransport(cfg.pretty ?? consolePretty)]
      case 'file':
        return [
          cfg.buffered
            ? new BufferedFileTransport(this.path(cfg.path), { ...cfg, pretty: cfg.pretty ?? filePretty })
            : new FileTransport(this.path(cfg.path), { ...cfg, pretty: cfg.pretty ?? filePretty }),
        ]
      case 'daily':
        return [
          new DailyFileTransport(this.path(cfg.path), {
            maxDays: cfg.maxDays,
            pretty: cfg.pretty ?? filePretty,
          }),
        ]
      // No transports: the channel exists, accepts writes, and drops them.
      case 'null':
        return []
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

  /**
   * Render styled HTML error pages for browsers (JSON for API) — framework default.
   *
   * `app.debug` is obeyed as written, and defaults to OFF. It used to default to
   * on and then be force-disabled when `app.env === 'production'` — safe, but it
   * meant the framework overrode a value the app had set, and the safety came
   * from a second environment variable rather than from the setting itself.
   * Laravel gets there without the override: `'debug' => (bool) env('APP_DEBUG',
   * false)`, read straight from config wherever it's needed. A deploy that
   * configures nothing therefore leaks nothing, and an app that asks for stack
   * traces gets them wherever it asked.
   */
  private registerErrorPages(): void {
    const debug = this.config.get<boolean>('app.debug') ?? false
    this.elysia.use(errorPages({ debug }))
  }

  /**
   * Expose the active timezone as `ctx.timezone` (the app default unless the app
   * narrows it per request with `setRequestTimezone`). No automatic detection —
   * the app decides where a per-user timezone comes from.
   */
  private registerTimezone(): void {
    this.elysia.derive({ as: 'global' }, () => ({ timezone: currentTimezone() }))
  }

  /**
   * Mount interactive OpenAPI docs (Scalar UI at `/openapi`, spec at `/openapi/json`),
   * built from Elysia's typed route schemas. On by default outside production; set
   * `config('openapi.enabled')` to override. Skipped if `@elysiajs/openapi` is absent.
   */
  private async registerOpenApi(): Promise<void> {
    const cfg = this.config.get<OpenApiConfig | undefined>('openapi') ?? {}
    // Exposure is the app's call, taken from config only. It used to default to
    // `app.env !== 'production'`, so the decision lived in a variable named after
    // something else and was invisible from `config/openapi.ts`. Laravel's
    // equivalent (Telescope) reads `config('telescope.enabled')` and nothing
    // else, with `env('TELESCOPE_ENABLED', true)` written in the app's own
    // config. The scaffolded `config/openapi.ts` does the same, and keeps docs
    // off in production on a line you can see and change.
    if ((cfg.enabled ?? true) === false)
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
        '[elyvel] Session cookie driver needs a secret — set `app.key` or `session.secret`.',
      )
    }
    // `secure` comes from config, and from nowhere else. It used to default to
    // `app.env === 'production'`, which reads well until the environment says
    // production for a host served over plain http — a browser refuses to send a
    // Secure cookie there, so sessions vanish with no error to explain it. Laravel
    // resolves it the same way, `env('SESSION_SECURE_COOKIE')` in the app's own
    // config/session.php, defaulting to off; the scaffolded config ships that line.
    this.elysia.use(
      sessionPlugin({
        driver,
        cookie: cfg.cookie ?? 'elyvel_session',
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
        lottery: cfg.lottery,
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
      fetch: async (request, srv) => {
        if (ws) {
          // No `authenticate` configured means every upgrade is anonymous —
          // fine for public-only channels, but the caller (e.g. broadcasting)
          // is responsible for warning that private/presence channels need it.
          if (ws.authenticate) {
            const identity = await ws.authenticate(request)
            // Only `false` rejects. `null`/`undefined` means "no identity, but
            // still allow the connection" (an anonymous viewer) — distinct
            // from an explicit reject, so a channel authorizer can still
            // differentiate "anonymous" from "actively denied" downstream.
            if (identity === false)
              return new Response(trans('core::errors.unauthorized', {}, 'Unauthorized'), { status: 401 })
            if ((srv as any).upgrade(request, { data: { identity } }))
              return undefined
          }
          else if (srv.upgrade(request)) {
            return undefined
          }
        }
        return this.handle(request)
      },
    })
    ws?.onServer?.(server)
    this.logger.info(`${this.config.get('app.name') ?? 'elyvel'} listening`, {
      url: `http://localhost:${resolved}`,
    })
    return this
  }

  private wsHandler: {
    handler: any
    onServer?(server: any): void
    authenticate?(request: Request): unknown | false | Promise<unknown | false>
  } | null = null

  /**
   * Register a Bun WebSocket handler; `listen()` upgrades WS handshakes to it and
   * calls `onServer` with the running server (used by broadcasting for pub/sub).
   * `authenticate`, if given, runs before every upgrade — return the connecting
   * client's identity to allow it (stored on `ws.data.identity`), `null`/`undefined`
   * to allow it anonymously (still stored, so downstream code can tell "no
   * identity" apart from an actively rejected one), or `false` to reject with
   * 401. Without `authenticate` at all, every connection is anonymous
   * (`ws.data.identity` is `undefined`) and none are ever rejected.
   */
  webSocket(
    handler: any,
    onServer?: (server: any) => void,
    authenticate?: (request: Request) => unknown | false | Promise<unknown | false>,
  ): void {
    this.wsHandler = { handler, onServer, authenticate }
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
