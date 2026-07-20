import { ServiceProvider, token } from '../../../src/index'

export const DiscoveredToken = token<{ registered: boolean, booted: boolean }>('discovered')

/** Simulates a provider that would come from `bootstrap/providers.generated.ts`. */
export class DiscoveredProvider extends ServiceProvider {
  private readonly marker = { registered: false, booted: false }

  override register(): void {
    this.marker.registered = true
    this.app.container.instance(DiscoveredToken, this.marker)
  }

  override boot(): void {
    this.marker.booted = true
  }
}
