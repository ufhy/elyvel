export { type BetterAuthLike, betterAuthPlugin, type BetterAuthPluginOptions } from './better-auth'
export { migrateBetterAuth } from './better-auth-schema'
export { eloquentAdapter, type EloquentAdapterOptions } from './eloquent-adapter'
export {
  AuthorizationError,
  createGate,
  Gate,
  gate,
  GateForUser,
  type Policy,
  Response,
  setDefaultGate,
} from './gate'
export { createGuard } from './guard'
export { Hash } from './hash'
export { type Attempt, type AuthConfig, AuthManager, createAuth } from './manager'
export { generateToken, hashToken } from './token'
export type {
  Authenticatable,
  Awaitable,
  Credentials,
  TokenStore,
  UserProvider,
} from './types'
