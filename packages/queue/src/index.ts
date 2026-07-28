import { QueueServiceProvider } from './provider'

export {
  Batch,
  type BatchAdapter,
  batchAdapter,
  type BatchRecord,
  Bus,
  configureBatches,
  findBatch,
  MemoryBatchStore,
  PendingBatch,
  RedisBatchStore,
} from './batch'
export { defineQueueConfig, type QueueConfig, type QueueConnectionConfig } from './config-schema'
export { configureJobEncryption } from './encryption'
export { configureQueueEventDispatcher, Queue } from './events'
export {
  configureFailedJobs,
  type FailedJobAdapter,
  type FailedJobRecord,
  FailedJobRepository,
  failedJobs,
  MemoryFailedJobStore,
} from './failed'
export {
  backoffFor,
  CallQueuedClosure,
  decodeBody,
  encodeBody,
  Job,
  type JobClass,
  type JobConfig,
  reconstructJob,
  registerJob,
  type SerializedJob,
  serializeJob,
} from './job'
export { ListenerJob, queueListener, registerListener } from './listener-job'
export {
  configureAfterCommit,
  dispatch,
  type Dispatchable,
  type DispatchOptions,
  dispatchSync,
  QueueManager,
  queueManager,
  setDefaultQueue,
} from './manager'
export {
  configureRateLimiter,
  type JobMiddleware,
  MemoryRateLimiter,
  RateLimited,
  type RateLimiter,
  rateLimiter,
  RedisRateLimiter,
  ReleaseJob,
  runThroughMiddleware,
  WithoutOverlapping,
} from './middleware'
export { QueueServiceProvider, QueueToken } from './provider'
export {
  configureRestartSignal,
  RedisRestartSignal,
  type RestartSignal,
  restartSignal,
} from './restart'
export {
  configureModelSerializer,
  type ModelReference,
  type ModelSerializer,
  modelSerializer,
} from './serializes-models'
export {
  configureDatabaseQueue,
  DatabaseQueueStore,
  DEFAULT_QUEUE,
  MemoryQueueStore,
  type PushOptions,
  type QueueDbAdapter,
  type QueuedRecord,
  type QueueStore,
  type RedisLike,
  RedisQueueStore,
} from './store'
export {
  configureUniqueJobs,
  MemoryUniqueLock,
  RedisUniqueLock,
  uniqueKeyFor,
  type UniqueLock,
  uniqueLock,
} from './unique'

/** Read by `elyvel package:discover` — see packages/core's discovery loader. */
export const elyvelProviders = [QueueServiceProvider]
// CLI commands (`elyvelCommands`) live at the `@elyvel/queue/cli` subpath, not
// here — so a running app importing this main entry never loads them.
export { Worker, type WorkerOptions } from './worker'
