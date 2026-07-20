import { ServiceProvider } from '../../../src/index'

/** Listed in BOTH bootstrap/providers.generated.ts and config/app.ts's `providers` — used to assert dedup-by-reference collapses it to a single register()/boot() run. */
export class DedupProvider extends ServiceProvider {
  static registerCount = 0
  static bootCount = 0

  override register(): void {
    DedupProvider.registerCount++
  }

  override boot(): void {
    DedupProvider.bootCount++
  }
}
