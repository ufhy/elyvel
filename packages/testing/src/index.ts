/**
 * Test helpers for elysia-ravel.
 *
 * - {@link createTestClient} / {@link TestClient} — drive an app through `handle()`
 *   (no port), returning a {@link TestResponse} with fluent assertions.
 * - {@link refreshDatabase} — a clean database per test.
 *
 * To authenticate requests, use `actingAs(user)` from `@elysia-ravel/auth`, which
 * makes the app resolve that user instead of a session cookie.
 */
export { createTestClient, type Handleable, type RequestOptions, TestClient } from './client'
export { refreshDatabase, type RefreshOptions } from './database'
export { TestResponse } from './response'
