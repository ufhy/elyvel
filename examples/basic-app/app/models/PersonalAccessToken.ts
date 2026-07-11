import { defineModel, integer, sqliteTable, text } from '@elysia-ravel/orm'

/** Sanctum-style API tokens. Only the SHA-256 hash of a token is stored. */
export const personalAccessTokens = sqliteTable('personal_access_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  token: text('token').notNull().unique(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const PersonalAccessToken = defineModel(personalAccessTokens)

export default PersonalAccessToken
