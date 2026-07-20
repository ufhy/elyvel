import type { ViewShared } from '@elyvel/view'
import { csrfField, html } from '@elyvel/view'

export interface FailedJobRow {
  id: string
  queue: string
  exception: string
  failedAt: number
}

export interface DashboardProps {
  pending: number
  failed: FailedJobRow[]
  jobsProcessed: number
  visits: number
}

export default function dashboard(props: DashboardProps, shared: ViewShared) {
  const status = shared.flash('status')
  return html`
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Worker Console</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 720px; margin: 3rem auto; color: #1a1a1a; }
        h1 { margin-bottom: 0.25rem; }
        .stat { font-size: 2rem; font-weight: 600; }
        .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; }
        button { padding: 0.5rem 1rem; cursor: pointer; }
        table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
        td, th { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid #eee; font-size: 0.9rem; }
        .status { color: #0a7; margin: 1rem 0; }
      </style>
    </head>
    <body>
      <h1>Worker Console</h1>
      <p>Queue + scheduler + notifications dogfood app.</p>
      ${status ? html`<p class="status">${String(status)}</p>` : ''}

      <div class="card">
        <div>Pending jobs</div>
        <div class="stat">${props.pending}</div>
      </div>

      <div class="card">
        <div>Jobs processed (database cache counter, written by queue:work)</div>
        <div class="stat">${props.jobsProcessed}</div>
      </div>

      <div class="card">
        <div>Your visits to this page (database session counter)</div>
        <div class="stat">${props.visits}</div>
      </div>

      <div class="card">
        <form method="post" action="/jobs/welcome" style="display:inline">
          ${csrfField(shared)}
          <button type="submit">Dispatch SendWelcomeNotificationJob</button>
        </form>
        <form method="post" action="/jobs/report" style="display:inline">
          ${csrfField(shared)}
          <button type="submit">Dispatch GenerateReportJob (flaky)</button>
        </form>
      </div>

      <div class="card">
        <h2>Failed jobs (${props.failed.length})</h2>
        <table>
          <tr><th>Queue</th><th>Failed at</th><th>Exception</th></tr>
          ${props.failed.map(f => html`
            <tr>
              <td>${f.queue}</td>
              <td>${new Date(f.failedAt).toISOString()}</td>
              <td>${f.exception.split('\n')[0]}</td>
            </tr>
          `)}
        </table>
      </div>
    </body>
    </html>
  `
}
