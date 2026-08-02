# API Resources

The layer between a model and the JSON your API returns — Laravel's
`JsonResource`. Without one a controller either returns the model, which leaks
every column the day someone adds one, or hand-rolls an object literal per
endpoint, which drifts between the list and detail views of the same thing.

## Writing one

```ts
// app/resources/UserResource.ts
import { JsonResource } from '@elyvel/core'
import type { User } from '../models/User'

export class UserResource extends JsonResource<User> {
  toArray() {
    return {
      id: this.resource.id,
      name: this.resource.name,
      created_at: this.resource.created_at,
    }
  }
}
```

Return it from a route or controller — no `.toJSON()` at the call site:

```ts
route().get('/users/:id', async ({ params }) => UserResource.make(await User.findOrFail(params.id)))
```

```json
{ "data": { "id": 1, "name": "Ada", "created_at": "2026-01-01T00:00:00Z" } }
```

## Collections

```ts
UserResource.collection(await User.query().get())
```

```json
{ "data": [{ "id": 1, "name": "Ada" }, { "id": 2, "name": "Grace" }] }
```

## Conditional fields

`when()` **omits the key entirely** rather than sending `null`. That distinction
carries information: a client that checks `'email' in payload` to decide whether
it may edit the field would be told "yes" by a null.

```ts
toArray() {
  return {
    id: this.resource.id,
    email: this.when(this.isOwner, this.resource.email),
    deleted_at: this.whenNotNull(this.resource.deleted_at),
    admin_notes: this.mergeWhen(this.isAdmin, { internal_id: this.resource.internal_id }),
  }
}
```

- `when(condition, value, fallback?)` — value or nothing. Pass a function to
  defer work that shouldn't run when the condition is false.
- `whenNotNull(value, fallback?)` — drops `null`/`undefined` only. `0`, `''` and
  `false` are values and are kept.
- `mergeWhen(condition, object)` — spreads the object's keys into the parent.

## Relations, and the N+1 hiding in a serialiser

`whenLoaded()` includes a relation only if it was actually eager-loaded:

```ts
toArray() {
  return {
    id: this.resource.id,
    posts: this.whenLoaded('posts', () => PostResource.collection(this.resource.relations.posts)),
  }
}
```

Reading `this.resource.posts` unconditionally would issue a query per row — from
the serialisation layer, which is the last place anyone thinks to profile. With
`whenLoaded`, an endpoint that forgot `with('posts')` returns a response without
the key instead of quietly making N queries.

## Meta and the envelope

```ts
UserResource.collection(users).additional({ meta: { total, page } })
// { "data": [...], "meta": { "total": 42, "page": 1 } }

UserResource.make(user).wrapIn(null)
// { "id": 1, "name": "Ada" }
```

`data` is the default envelope, as in Laravel: it leaves room to add `meta` or
`links` later without breaking clients that already parse the response. Change it
for one response with `wrapIn(...)`, or for a whole class with
`static wrap = 'user'`.
