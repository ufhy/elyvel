import { defineAppConfig } from '@elyvel/core'
import { EloquentServiceProvider } from '@elyvel/database'

export default defineAppConfig({
  name: 'MCP Fixture',
  port: 4567,
  providers: [EloquentServiceProvider],
})
