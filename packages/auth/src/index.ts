export { Hash } from './hash'
export { type BetterAuthLike, type BetterAuthPluginOptions, betterAuthPlugin } from './better-auth'
export { migrateBetterAuth } from './better-auth-schema'
export { type EloquentAdapterOptions, eloquentAdapter } from './eloquent-adapter'
export { generateToken, hashToken } from './token'
export { AuthManager, type AuthConfig, type Attempt, createAuth } from './manager'
export { createGuard } from './guard'
export { AuthorizationError, Gate, createGate } from './gate'
export type {
  Authenticatable,
  Awaitable,
  Credentials,
  TokenStore,
  UserProvider,
} from './types'
