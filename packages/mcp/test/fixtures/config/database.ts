import { defineDatabaseConfig } from '@elyvel/database'

export default defineDatabaseConfig({
  default: 'sqlite',
  connections: {
    // File-backed when the test provides a path: the repo-wide test preload
    // closes every DB connection after EACH test, so a :memory: database
    // would lose its tables between tests. A file survives reconnects.
    sqlite: { driver: 'sqlite', database: process.env.ELYVEL_MCP_TEST_DB ?? ':memory:' },
  },
})
