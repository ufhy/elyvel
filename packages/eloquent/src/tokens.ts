import { token } from '@elysia-ravel/core'
import type { Connection } from './connection'

/** Container token for the default Eloquent connection. */
export const DatabaseToken = token<Connection>('eloquent.connection')
