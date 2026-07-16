import { describe, expect, test } from 'bun:test'
import { AuthorizationError, createGate } from '../src/gate'

interface User {
  id: number
  role: 'admin' | 'member'
}
interface Post {
  authorId: number
}

const gate = createGate<User>()
  .define('post.update', (user, post: Post) => !!user && user.id === post.authorId)
  .define('admin', user => user?.role === 'admin')

describe('Gate', () => {
  test('allows when the ability passes', () => {
    expect(gate.allows('post.update', { id: 1, role: 'member' }, { authorId: 1 })).toBe(true)
  })

  test('denies when the ability fails', () => {
    expect(gate.denies('post.update', { id: 2, role: 'member' }, { authorId: 1 })).toBe(true)
  })

  test('denies unknown abilities', () => {
    expect(gate.allows('does.not.exist', { id: 1, role: 'admin' })).toBe(false)
  })

  test('denies for a null (guest) user', () => {
    expect(gate.allows('admin', null)).toBe(false)
  })

  test('authorize throws AuthorizationError when denied', () => {
    expect(() => gate.authorize('admin', { id: 1, role: 'member' })).toThrow(AuthorizationError)
  })

  test('authorize passes silently when allowed', () => {
    expect(() => gate.authorize('admin', { id: 1, role: 'admin' })).not.toThrow()
  })
})
