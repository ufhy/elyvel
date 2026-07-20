import { createApp } from '@elyvel/core'

// Bootstrap the framework: load config/, register providers, auto-mount routes/.
const app = await createApp({ basePath: import.meta.dir })

// Log uncaught exceptions / unhandled rejections through the app logger.
app.catchExceptions()

// listen() logs the bound URL via the framework logger.
await app.listen()
