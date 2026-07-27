import { AuthServiceProvider } from './provider'

export { AuthGuard, VerifiedGuard } from './auth-middleware'
export {
  AuthActions,
  type AuthRequestClass,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  UpdatePasswordRequest,
  UpdateProfileRequest,
} from './auth-requests'
export {
  type BetterAuthLike,
  betterAuthPlugin,
  type BetterAuthPluginOptions,
  type User,
  webRoute,
} from './better-auth'
export { migrateBetterAuth } from './better-auth-schema'
export {
  type AuthFeatures,
  defineAuth,
  defineAuthConfig,
  type DefineAuthOptions,
  enabledSocialProviders,
} from './define-auth'
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
export {
  type Attempt,
  type AuthConfig,
  AuthManager,
  createAuth,
  TooManyAttemptsError,
} from './manager'
export { AuthAccount, AuthSession, AuthUser, AuthVerification } from './models'
export { authHasPlugin, type AuthInstance, AuthServiceProvider, AuthToken } from './provider'
export { actingAs, actingAsGuest, currentTestActor, stopActingAs } from './testing'
export { generateToken, hashToken } from './token'
export type {
  Authenticatable,
  Awaitable,
  Credentials,
  TokenStore,
  UserProvider,
} from './types'

/** Read by `elyvel package:discover` — see packages/core's discovery loader. */
export const elyvelProviders = [AuthServiceProvider]
