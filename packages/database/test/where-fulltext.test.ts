import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { table } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

for (const d of dialects) {
  describe(`whereFullText (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('posts', (t) => {
        t.id()
        t.string('title')
        t.text('body')
        // MySQL requires a FULLTEXT index matching the EXACT column set used
        // in a query's MATCH() before it works at all — a composite index
        // doesn't satisfy a single-column MATCH(body), so both shapes this
        // test exercises need their own index. Postgres's `@@` works without
        // one (an index only speeds it up); SQLite ignores this entirely
        // (falls back to LIKE).
        if (d.name === 'mysql') {
          t.fullText('body')
          t.fullText(['title', 'body'])
        }
      })
      await table('posts').insertMany([
        { title: 'Elephants', body: 'Elephants are the largest living land animals on Earth today.' },
        { title: 'Bananas', body: 'Bananas are a popular tropical fruit grown around the world.' },
        { title: 'Oceans', body: 'Oceans cover most of the surface of our planet Earth.' },
      ])
    })

    test('matches rows containing the term, single column', async () => {
      const matches = await table('posts').whereFullText('body', 'elephants').get()
      expect(matches.map(r => r.title)).toEqual(['Elephants'])
    })

    test('matches across multiple columns', async () => {
      const matches = await table('posts').whereFullText(['title', 'body'], 'bananas').get()
      expect(matches.map(r => r.title)).toEqual(['Bananas'])
    })

    test('no match returns an empty result, not an error', async () => {
      const matches = await table('posts').whereFullText('body', 'giraffes').get()
      expect(matches).toEqual([])
    })

    test('orWhereFullText adds an OR condition', async () => {
      const matches = await table('posts')
        .where('title', 'Oceans')
        .orWhereFullText('body', 'bananas')
        .get()
      expect(matches.map(r => r.title).sort()).toEqual(['Bananas', 'Oceans'])
    })
  })
}
