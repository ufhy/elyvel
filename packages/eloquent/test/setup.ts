import { afterEach } from 'bun:test'
import { closeAllConnections } from '../src/connection'

// Close every DB connection opened during a test so PGlite (WASM) instances
// don't pile up across the suite and cause flaky, resource-starved runs.
afterEach(async () => {
  await closeAllConnections()
})
