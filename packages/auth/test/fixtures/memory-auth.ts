import { Hash } from '../../src/hash'
import { createAuth } from '../../src/manager'

interface MemoryUser {
  id: number
  name: string
  email: string
  password: string
}

/** An in-memory auth setup for tests — no database required. */
export async function makeMemoryAuth(overrides: { maxAttempts?: number, decayMinutes?: number } = {}) {
  const hashed = await Hash.make('secret')
  const users = new Map<number, MemoryUser>([
    [1, { id: 1, name: 'Ada', email: 'ada@example.com', password: hashed }],
  ])
  const tokens = new Map<string, number>() // hashedToken -> userId

  const auth = createAuth<MemoryUser>({
    ...overrides,
    provider: {
      retrieveById: id => users.get(Number(id)) ?? null,
      retrieveByCredentials: ({ email }) =>
        [...users.values()].find(u => u.email === email) ?? null,
      validateCredentials: (user, { password }) => Hash.verify(password, user.password),
    },
    tokens: {
      store: ({ userId, hashedToken }) => {
        tokens.set(hashedToken, Number(userId))
      },
      findUserId: hashedToken => tokens.get(hashedToken) ?? null,
      revoke: (hashedToken) => {
        tokens.delete(hashedToken)
      },
    },
  })

  return { auth, users, tokens }
}
