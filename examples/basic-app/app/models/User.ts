import { defineModel, integer, sqliteTable, text } from '@elysia-ravel/orm'

/** The `users` table schema. Column types flow straight into the model API. */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

/** User model — `User.all()`, `User.find(id)`, `User.create({...})`, all typed. */
export const User = defineModel(users)

export default User
