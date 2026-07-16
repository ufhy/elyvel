import type { Migration } from '../../../src/index'

// A single migration exercising every column type — runs on SQLite and Postgres.
export default {
  up: schema =>
    schema.create('kitchen_sink', (t) => {
      t.id()
      // numeric
      t.smallInteger('small').nullable()
      t.integer('int').nullable()
      t.bigInteger('big').nullable()
      t.float('flt').nullable()
      t.double('dbl').nullable()
      t.decimal('price', 8, 2).nullable()
      t.boolean('active').nullable()
      // text
      t.char('code', 4).nullable()
      t.string('name').nullable()
      t.text('body').nullable()
      t.mediumText('mtext').nullable()
      t.longText('ltext').nullable()
      // identifiers / structured
      t.uuid('uid').nullable()
      t.json('meta').nullable()
      t.jsonb('meta2').nullable()
      t.binary('blob').nullable()
      // date / time
      t.date('d').nullable()
      t.time('tm').nullable()
      t.timestamp('ts').nullable()
      t.timestampTz('tstz').nullable()
      t.dateTime('dt').nullable()
      // network / misc
      t.inet('ip').nullable()
      t.cidr('net').nullable()
      t.macaddr('mac').nullable()
      t.interval('dur').nullable()
      // enum + arrays + fk
      t.enum('status', ['a', 'b']).nullable()
      t.array('tags', 'text').nullable()
      t.array('nums', 'integer').nullable()
      t.foreignId('user_id').nullable()
      // conventions
      t.timestamps()
      t.softDeletes()
      t.index('name')
    }),
  down: schema => schema.dropIfExists('kitchen_sink'),
} satisfies Migration
