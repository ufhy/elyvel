import { createAuth, Hash } from '@elysia-ravel/auth'
import { eq, useDatabase } from '@elysia-ravel/orm'
import { personalAccessTokens, PersonalAccessToken } from './models/PersonalAccessToken'
import { User, users } from './models/User'

/**
 * Wire the framework's auth to this app's models. The provider/token-store
 * contracts keep `@elysia-ravel/auth` storage-agnostic; here we back them with
 * the (async) Drizzle models — fully typed, dialect-agnostic.
 */
export const auth = createAuth({
  provider: {
    retrieveById: async (id) => (await User.find(id)) ?? null,
    retrieveByCredentials: async ({ email }) =>
      (await User.where(eq(users.email, email)))[0] ?? null,
    validateCredentials: (user, { password }) => Hash.verify(password, user.password),
  },
  tokens: {
    store: async ({ userId, hashedToken }) => {
      await PersonalAccessToken.create({ userId: Number(userId), token: hashedToken })
    },
    findUserId: async (hashedToken) =>
      (await PersonalAccessToken.where(eq(personalAccessTokens.token, hashedToken)))[0]?.userId ??
      null,
    revoke: async (hashedToken) => {
      await useDatabase().delete(personalAccessTokens).where(eq(personalAccessTokens.token, hashedToken))
    },
  },
})
