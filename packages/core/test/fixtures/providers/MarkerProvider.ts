import { ServiceProvider, token } from '../../../src/index'

export const MarkerToken = token<{ registered: boolean; booted: boolean }>('marker')

/** Records that register() and boot() ran, to assert the lifecycle in tests. */
export class MarkerProvider extends ServiceProvider {
  private readonly marker = { registered: false, booted: false }

  override register(): void {
    this.marker.registered = true
    this.app.container.instance(MarkerToken, this.marker)
  }

  override boot(): void {
    this.marker.booted = true
  }
}
