import type { Connection } from '../src/connection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { hasColumn, hasIndex, hasTable } from '../src/inspect'
import { QueryBuilder } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

for (const d of dialects) {
  const alterSupportsConstraints = d.name !== 'sqlite'

  describe(`schema Tier 1 + Tier 2 (${d.name})`, () => {
    let conn: Connection
    beforeEach(async () => {
      conn = await d.connect()
    })

    test('composite unique + composite primary key at create time', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('memberships', (t) => {
        t.integer('org_id')
        t.integer('user_id')
        t.string('role')
        t.primary(['org_id', 'user_id'])
        t.unique(['org_id', 'role'])
      })
      await new QueryBuilder(conn, 'memberships').insert({ org_id: 1, user_id: 1, role: 'admin' })
      expect(await hasIndex(conn, 'memberships', ['org_id', 'role'], 'unique')).toBe(true)

      await expect(
        new QueryBuilder(conn, 'memberships').insert({ org_id: 1, user_id: 1, role: 'member' }),
      ).rejects.toThrow()
    })

    test('unsigned integer variants + tinyInteger/mediumInteger accept normal values', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('gauges', (t) => {
        t.id()
        t.unsignedInteger('count')
        t.unsignedBigInteger('big_count')
        t.unsignedSmallInteger('small_count')
        t.unsignedTinyInteger('tiny_count')
        t.unsignedMediumInteger('medium_count')
        t.tinyInteger('signed_tiny')
        t.mediumInteger('signed_medium')
      })
      await new QueryBuilder(conn, 'gauges').insert({
        count: 5,
        big_count: 5,
        small_count: 5,
        tiny_count: 5,
        medium_count: 5,
        signed_tiny: -5,
        signed_medium: -5,
      })
      const row = await new QueryBuilder(conn, 'gauges').first()
      expect(Number(row?.count)).toBe(5)
      expect(Number(row?.signed_tiny)).toBe(-5)
    })

    test('year/tinyText/ipAddress/macAddress/dateTimeTz/timeTz/rememberToken round-trip', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('profiles', (t) => {
        t.id()
        t.year('birth_year')
        t.tinyText('bio')
        t.ipAddress('last_ip')
        t.macAddress('mac')
        t.dateTimeTz('seen_at')
        t.timeTz('daily_at')
        t.rememberToken()
      })
      await new QueryBuilder(conn, 'profiles').insert({
        birth_year: 1999,
        bio: 'hi',
        last_ip: '127.0.0.1',
        mac: '08:00:2b:01:02:03',
        seen_at: '2026-01-01 00:00:00',
        daily_at: '08:00:00',
        remember_token: null,
      })
      const row = await new QueryBuilder(conn, 'profiles').first()
      expect(Number(row?.birth_year)).toBe(1999)
      expect(row?.bio).toBe('hi')
      expect(await hasColumn(conn, 'profiles', 'remember_token')).toBe(true)
    })

    test('morph variants create the expected id/type columns with correct nullability', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('taggables', (t) => {
        t.id()
        t.morphs('taggable')
        t.nullableMorphs('n_taggable')
        t.uuidMorphs('u_taggable')
        t.nullableUuidMorphs('nu_taggable')
        t.ulidMorphs('l_taggable')
        t.nullableUlidMorphs('nl_taggable')
      })
      for (const name of ['taggable', 'n_taggable', 'u_taggable', 'nu_taggable', 'l_taggable', 'nl_taggable']) {
        expect(await hasColumn(conn, 'taggables', `${name}_id`)).toBe(true)
        expect(await hasColumn(conn, 'taggables', `${name}_type`)).toBe(true)
      }
      // Nullable variants accept NULL; the plain morphs() do not.
      await new QueryBuilder(conn, 'taggables').insert({
        taggable_id: 1,
        taggable_type: 'Post',
        n_taggable_id: null,
        n_taggable_type: null,
        u_taggable_id: '11111111-1111-1111-1111-111111111111',
        u_taggable_type: 'Post',
        nu_taggable_id: null,
        nu_taggable_type: null,
        l_taggable_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        l_taggable_type: 'Post',
        nl_taggable_id: null,
        nl_taggable_type: null,
      })
      const row = await new QueryBuilder(conn, 'taggables').first()
      expect(row?.n_taggable_id).toBeNull()
    })

    test('foreignUuid/foreignUlid/foreignIdFor create FK-able columns', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('parents_uuid', (t) => {
        t.uuid('id')
        t.primary('id')
      })
      await schema.create('children_uuid', (t) => {
        t.id()
        t.foreignUuid('parent_id').constrained('parents_uuid', 'id')
        t.foreignIdFor('Author') // -> author_id bigInteger
      })
      expect(await hasColumn(conn, 'children_uuid', 'parent_id')).toBe(true)
      expect(await hasColumn(conn, 'children_uuid', 'author_id')).toBe(true)
    })

    test('useCurrent() populates a default when the column is omitted on insert', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('events', (t) => {
        t.id()
        t.string('name')
        // timestampTz(), not timestamp() — plain timestamp()/datetime() stay
        // TEXT on MySQL for cross-dialect ISO-string consistency, and MySQL
        // rejects a CURRENT_TIMESTAMP default on a TEXT column.
        t.timestampTz('logged_at').useCurrent()
      })
      await new QueryBuilder(conn, 'events').insert({ name: 'boot' })
      const row = await new QueryBuilder(conn, 'events').first()
      expect(row?.logged_at).toBeTruthy()
    })

    test('comment() does not break table/column creation', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('commented', (t) => {
        t.id()
        t.string('note').comment('a free-form note')
      })
      await new QueryBuilder(conn, 'commented').insert({ note: 'hi' })
      expect(await hasColumn(conn, 'commented', 'note')).toBe(true)
    })

    test('dropTimestamps/dropSoftDeletes/dropMorphs/dropRememberToken remove the right columns', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('droppable', (t) => {
        t.id()
        t.timestamps()
        t.softDeletes()
        t.morphs('owner')
        t.rememberToken()
      })
      await schema.table('droppable', (t) => {
        t.dropTimestamps()
        t.dropSoftDeletes()
        t.dropMorphs('owner')
        t.dropRememberToken()
      })
      for (const col of ['created_at', 'updated_at', 'deleted_at', 'owner_id', 'owner_type', 'remember_token']) {
        expect(await hasColumn(conn, 'droppable', col)).toBe(false)
      }
    })

    test('hasTable/hasColumn/hasIndex reflect reality, including for tables/columns that never existed', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('reflected', (t) => {
        t.id()
        t.string('email').unique()
      })
      expect(await hasTable(conn, 'reflected')).toBe(true)
      expect(await hasTable(conn, 'never_existed')).toBe(false)
      expect(await hasColumn(conn, 'reflected', 'email')).toBe(true)
      expect(await hasColumn(conn, 'reflected', 'nope')).toBe(false)
    })

    test('withoutForeignKeyConstraints lets out-of-order inserts through, then restores enforcement', async () => {
      const schema = new SchemaBuilder(conn)
      await schema.create('fk_parents', (t) => {
        t.id()
      })
      await schema.create('fk_children', (t) => {
        t.id()
        t.foreignId('parent_id').constrained('fk_parents')
      })

      if (conn.dialect === 'pg') {
        // Postgres (both the real `pg` driver and the in-process `pglite`) has
        // no session-wide toggle in our implementation — a documented no-op,
        // so enforcement never actually lapses, even inside the block.
        await expect(
          schema.withoutForeignKeyConstraints(() =>
            new QueryBuilder(conn, 'fk_children').insert({ parent_id: 999 }),
          ),
        ).rejects.toThrow()
        return
      }

      await schema.withoutForeignKeyConstraints(async () => {
        await new QueryBuilder(conn, 'fk_children').insert({ parent_id: 999 })
      })
      await expect(
        new QueryBuilder(conn, 'fk_children').insert({ parent_id: 998 }),
      ).rejects.toThrow()
    })

    if (alterSupportsConstraints) {
      test('adding a constrained() column via table() (ALTER) actually creates the FK — the found bug', async () => {
        const schema = new SchemaBuilder(conn)
        await schema.create('fk2_parents', (t) => {
          t.id()
        })
        await schema.create('fk2_children', (t) => {
          t.id()
        })
        await schema.table('fk2_children', (t) => {
          t.foreignId('parent_id').constrained('fk2_parents')
        })
        await expect(
          new QueryBuilder(conn, 'fk2_children').insert({ parent_id: 12345 }),
        ).rejects.toThrow()
      })

      test('standalone foreign().references().on() with onDelete/onUpdate actions', async () => {
        const schema = new SchemaBuilder(conn)
        await schema.create('fk3_parents', (t) => {
          t.id()
        })
        await schema.create('fk3_children', (t) => {
          t.id()
          t.unsignedBigInteger('parent_id')
        })
        await schema.table('fk3_children', (t) => {
          t.foreign('parent_id').references('id').on('fk3_parents').cascadeOnDelete().cascadeOnUpdate()
        })
        await new QueryBuilder(conn, 'fk3_parents').insert({})
        const parent = await new QueryBuilder(conn, 'fk3_parents').first()
        await new QueryBuilder(conn, 'fk3_children').insert({ parent_id: Number(parent?.id) })
        await new QueryBuilder(conn, 'fk3_parents').where('id', Number(parent?.id)).delete()
        expect(await new QueryBuilder(conn, 'fk3_children').count()).toBe(0)
      })

      test('primary()/dropPrimary() and renameIndex() via table() (ALTER)', async () => {
        const schema = new SchemaBuilder(conn)
        await schema.create('altered_pk', (t) => {
          t.integer('a')
          t.integer('b')
          t.string('label')
          t.unique('label', 'altered_pk_label_unique')
        })
        await schema.table('altered_pk', (t) => {
          t.primary(['a', 'b'])
        })
        await new QueryBuilder(conn, 'altered_pk').insert({ a: 1, b: 1, label: 'x' })
        await expect(
          new QueryBuilder(conn, 'altered_pk').insert({ a: 1, b: 1, label: 'y' }),
        ).rejects.toThrow()

        await schema.table('altered_pk', (t) => {
          t.renameIndex('altered_pk_label_unique', 'altered_pk_label_uq')
        })
        expect(await hasIndex(conn, 'altered_pk', ['label'], 'unique')).toBe(true)
      })
    }
  })
}
