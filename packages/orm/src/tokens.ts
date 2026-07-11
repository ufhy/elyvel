import { token } from '@elysia-ravel/core'
import type { Connection } from './connection'

/** Container token for the default database connection. */
export const DatabaseToken = token<Connection>('db')
