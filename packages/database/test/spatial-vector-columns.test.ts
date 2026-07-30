import type { ColumnDefinition } from '../src/grammar'
import { describe, expect, test } from 'bun:test'
import { grammarFor } from '../src/grammar'

/** `columnType` is protected; these tests exercise it as the grammar's own SQL. */
function typeOf(dialect: 'pg' | 'mysql' | 'sqlite', column: Partial<ColumnDefinition>): string {
  const grammar = grammarFor(dialect) as unknown as {
    columnType(c: ColumnDefinition): string
  }
  return grammar.columnType({ name: 'c', type: 'geometry', ...column } as ColumnDefinition)
}

describe('geometry and geography columns', () => {
  test('Postgres emits PostGIS types, parameterized by subtype and SRID', () => {
    expect(typeOf('pg', { type: 'geometry' })).toBe('GEOMETRY')
    expect(typeOf('pg', { type: 'geometry', subtype: 'point' })).toBe('GEOMETRY(point)')
    expect(typeOf('pg', { type: 'geometry', subtype: 'point', srid: 4326 })).toBe('GEOMETRY(point,4326)')
    expect(typeOf('pg', { type: 'geography', subtype: 'point' })).toBe('GEOGRAPHY(point)')
  })

  test('MySQL uses its native concrete spatial types and an SRID attribute', () => {
    expect(typeOf('mysql', { type: 'geometry' })).toBe('GEOMETRY')
    expect(typeOf('mysql', { type: 'geometry', subtype: 'point' })).toBe('POINT')
    expect(typeOf('mysql', { type: 'geometry', subtype: 'polygon', srid: 4326 })).toBe('POLYGON SRID 4326')
    // MySQL has no separate geography type — spatial columns there are geometry.
    expect(typeOf('mysql', { type: 'geography', subtype: 'point' })).toBe('POINT')
  })

  test('SQLite declares the type so a schema stays portable, though functions will not work', () => {
    expect(typeOf('sqlite', { type: 'geometry' })).toBe('GEOMETRY')
    expect(typeOf('sqlite', { type: 'geometry', subtype: 'point' })).toBe('GEOMETRY(point)')
  })

  test('the subtype is sanitized — it reaches the DDL, so it cannot carry SQL', () => {
    expect(typeOf('pg', { type: 'geometry', subtype: 'point); DROP TABLE users --' }))
      .toBe('GEOMETRY(pointDROPTABLEusers)')
    expect(typeOf('mysql', { type: 'geometry', subtype: 'point`; DROP TABLE users' }))
      .toBe('POINTDROPTABLEUSERS')
  })
})

describe('vector columns', () => {
  test('every dialect emits VECTOR(n)', () => {
    for (const dialect of ['pg', 'mysql', 'sqlite'] as const)
      expect(typeOf(dialect, { type: 'vector', dimensions: 1536 })).toBe('VECTOR(1536)')
  })

  test('a missing or nonsensical dimension count is refused, not silently defaulted', () => {
    expect(() => typeOf('pg', { type: 'vector' })).toThrow(/needs a positive integer/)
    expect(() => typeOf('pg', { type: 'vector', dimensions: 0 })).toThrow()
    expect(() => typeOf('pg', { type: 'vector', dimensions: -1 })).toThrow()
    expect(() => typeOf('pg', { type: 'vector', dimensions: 1.5 })).toThrow()
  })
})
