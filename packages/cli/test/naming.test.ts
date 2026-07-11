import { describe, expect, test } from 'bun:test'
import { makeNames } from '../src/naming'

describe('makeNames', () => {
  test('derives every casing from a bare name', () => {
    const n = makeNames('userProfile')
    expect(n.class).toBe('UserProfile')
    expect(n.camel).toBe('userProfile')
    expect(n.kebab).toBe('user-profile')
    expect(n.snake).toBe('user_profile')
  })

  test('appends a suffix when missing', () => {
    expect(makeNames('User', 'Controller').class).toBe('UserController')
  })

  test('does not duplicate a suffix already present', () => {
    expect(makeNames('UserController', 'Controller').class).toBe('UserController')
    expect(makeNames('user-controller', 'Controller').class).toBe('UserController')
  })

  test('normalizes mixed input styles', () => {
    expect(makeNames('create_posts_table').snake).toBe('create_posts_table')
    expect(makeNames('CreatePostsTable').snake).toBe('create_posts_table')
  })
})
