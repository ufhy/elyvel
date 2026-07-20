import { DedupProvider } from '../providers/DedupProvider'

export default {
  name: 'Discovery Test App',
  port: 4321,
  // DedupProvider is ALSO in bootstrap/providers.generated.ts — should only
  // register()/boot() once.
  providers: [DedupProvider],
}
