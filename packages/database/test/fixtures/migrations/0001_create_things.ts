import type { Migration } from '../../../src/index'

export default {
  async up(schema) {
    await schema.create('things', (t) => {
      t.id()
      t.string('name')
      t.timestamps()
    })
  },
  async down(schema) {
    await schema.dropIfExists('things')
  },
} satisfies Migration
