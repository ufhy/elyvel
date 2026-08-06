import { Model } from '@elyvel/database'

/** Fixture model — exists so application-info and tinker have one to find. */
export class Widget extends Model {
  static override table = 'widgets'
}
