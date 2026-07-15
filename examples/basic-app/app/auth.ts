import { Hash, createAuth } from '@elysia-ravel/auth'
import { PersonalAccessToken } from './models/PersonalAccessToken'
import { User } from './models/User'

/**
 * Wire the framework's auth to this app's Eloquent models. The provider/token-
 * store contracts keep `@elysia-ravel/auth` storage-agnostic.
 */
export const auth = createAuth({
  provider: {
    retrieveById: async (id) => (await User.find(id)) ?? null,
    retrieveByCredentials: async ({ email }) => (await User.where('email', email).first()) ?? null,
    validateCredentials: (user, { password }) => Hash.verify(password, user.password),
  },
  tokens: {
    store: async ({ userId, hashedToken }) => {
      await PersonalAccessToken.create({ user_id: Number(userId), token: hashedToken })
    },
    findUserId: async (hashedToken) =>
      (await PersonalAccessToken.where('token', hashedToken).first())?.user_id ?? null,
    revoke: async (hashedToken) => {
      const token = await PersonalAccessToken.where('token', hashedToken).first()
      if (token) await token.delete()
    },
  },
})
