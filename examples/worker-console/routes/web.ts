import type { MiddlewareContext, Session } from '@elyvel/core'
import { group, redirect, route } from '@elyvel/core'
import { table } from '@elyvel/database'
import { dispatch } from '@elyvel/queue'
import { view } from '@elyvel/view'
import { GenerateReportJob } from '../app/jobs/GenerateReportJob'
import { SendWelcomeNotificationJob } from '../app/jobs/SendWelcomeNotificationJob'
import dashboard from '../app/views/dashboard'

async function showDashboard() {
  const pending = await table('jobs').count()
  const failedRows = await table('failed_jobs').orderBy('failed_at', 'desc').get()
  const failed = failedRows.map(r => ({
    id: r.id as string,
    queue: r.queue as string,
    exception: r.exception as string,
    failedAt: r.failed_at as number,
  }))
  return view(dashboard, { pending, failed })
}

async function dispatchWelcome(ctx: MiddlewareContext) {
  await dispatch(new SendWelcomeNotificationJob('QA Tester'))
  ;(ctx.session as Session).flash('status', 'SendWelcomeNotificationJob dispatched — check the queue:work log.')
  return redirect('/')
}

async function dispatchReport(ctx: MiddlewareContext) {
  await dispatch(new GenerateReportJob('manual-report'))
  ;(ctx.session as Session).flash('status', 'GenerateReportJob dispatched (flaky — may retry a few times).')
  return redirect('/')
}

/**
 * Browser routes run through `group('web')` for CSRF — the dashboard's
 * dispatch buttons are plain HTML forms, not fetch() calls.
 */
export default route()
  .get('/api/health', () => ({ status: 'ok', app: 'Worker Console' }))
  .use(group('web'))
  .get('/', showDashboard)
  .post('/jobs/welcome', dispatchWelcome)
  .post('/jobs/report', dispatchReport)
