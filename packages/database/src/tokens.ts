import type { Connection } from './connection'
import { token } from '@elyvel/core'

/** Container token for the default Eloquent connection. */
export const DatabaseToken = token<Connection>('eloquent.connection')
