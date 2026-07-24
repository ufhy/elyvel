# Validation

Input is validated with **FormRequest** classes — the same mechanism used
throughout the framework, including [Authentication](/security/authentication)'s
register/login/reset flows. Rules are Laravel's familiar piped-string syntax.

## Writing a FormRequest

Extend `FormRequest` and define `rules()`. Call the static `validate(ctx)` in a
controller — it returns the validated data, or throws a `422` with a
Laravel-shaped error bag:

```ts
// app/requests/StorePostRequest.ts
import type { Rules } from '@elyvel/validation'
import { FormRequest } from '@elyvel/validation'

export class StorePostRequest extends FormRequest {
  rules(): Rules {
    return {
      title: 'required|string|max:255',
      body: 'required|string',
      published_at: 'nullable|date',
    }
  }
}
```

```ts
async store(ctx: MiddlewareContext) {
  const data = await StorePostRequest.validate(ctx)
  return Post.create(data)
}
```

Generate one with `bunx elyvel make:request StorePostRequest`.

A failed validation returns:

```json
{
  "message": "The title field is required. (and 1 more error)",
  "errors": {
    "title": ["The title field is required."],
    "body": ["The body field is required."]
  }
}
```

## Rules

Rules are a pipe-separated string per field, or an array (needed when mixing
strings with custom rules — see below). A representative set:

| Category | Rules |
| --- | --- |
| Presence | `required`, `nullable`, `sometimes`, `present`, `filled`, `required_if`, `required_unless`, `required_with`, `prohibited`, `prohibited_if` |
| Type | `string`, `integer`, `numeric`, `boolean`, `array`, `date` |
| Format | `email`, `url`, `uuid`, `ulid`, `ip`, `json`, `regex`, `alpha`, `alpha_num`, `alpha_dash` |
| Size | `min`, `max`, `size`, `between` (string length, number value, or array/file count — inferred from the field's type) |
| Comparison | `same`, `different`, `confirmed`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in` |
| Files | `file`, `image`, `mimes`, `dimensions`, `max` (kilobytes) |
| Database | `unique`, `exists` |

```ts
rules(): Rules {
  return {
    email: 'required|email|unique:users,email',
    password: 'required|string|min:8|confirmed',
    age: 'nullable|integer|min:18',
    cover_image: 'nullable|file|image|dimensions:min_width=200,min_height=200|max:5120',
  }
}
```

### `unique` / `exists`

Check the database directly — `unique:table,column` and `exists:table,column`
(column defaults to `id`). They're wired to `@elyvel/database` automatically by
`EloquentServiceProvider`, with a timeout so a stuck connection can't hang a
request forever.

```ts
slug: 'nullable|string|unique:posts,slug'
```

To exclude the current row on an update (Laravel's `unique:posts,slug,{id}`),
pass a third argument:

```ts
rules(ctx: RequestLike): Rules {
  return { slug: `unique:posts,slug,${(ctx.model as Post).id}` }
}
```

## Custom rules

Mix a closure or a rule object into a field's rule **array**. A closure calls
`fail(message)` to reject:

```ts
rules(): Rules {
  return {
    username: ['required', 'string', (value, fail) => {
      if (String(value).includes(' '))
        fail('The username field must not contain spaces.')
    }],
  }
}
```

A reusable rule is an object with a `validate(value, fail, ctx)` method.
Annotate it with `RuleObject` — that's what tells TypeScript (and your editor)
the object must have that exact method; get the name or signature wrong and
the error points right at the definition, not at wherever the rule is used:

```ts
import type { CustomRuleContext, FailFn, RuleObject } from '@elyvel/validation'

export const NoSpaces: RuleObject = {
  validate(value: unknown, fail: FailFn, ctx: CustomRuleContext) {
    if (String(value).includes(' '))
      fail(`The ${ctx.attribute} field must not contain spaces.`)
  },
}
```

::: tip Editor typing
Written inline, as above, `value`/`fail` are typed automatically — TypeScript
infers them from `Rules` (`value` is `unknown`, forcing a narrow before use;
`fail` autocompletes as `(message: string) => void`). That inference only
applies inside the array literal itself; pull the closure out into its own
variable and annotate it explicitly with `ClosureRule` (or type a standalone
object with `RuleObject`, as `NoSpaces` does above).
:::

## Password rules

Use `Password` for composable complexity rules — and set an app-wide default
once with `Password.defaults()` so every password-touching flow (registration,
reset, change-password) agrees. See
[Authentication → Password policy](/security/authentication#password-policy).

```ts
import { Password } from '@elyvel/validation'

password: ['required', 'string', Password.min(8).mixedCase().numbers().symbols()]
```

## Conditional rules

`rules(ctx)` is a plain method that receives the request context — including
`ctx.body` — so add rules conditionally with ordinary JS (Laravel's
`sometimes`, done inline):

```ts
class UpdateProfileRequest extends FormRequest {
  rules(ctx: RequestLike): Rules {
    const body = ctx.body as Record<string, unknown>
    return {
      name: 'required|string',
      ...(body.accountType === 'business' && { company: 'required|string' }),
    }
  }
}
```

Using `Validator` directly (without a FormRequest) exposes the same idea as a
chainable `.sometimes(fields, rules, when)`:

```ts
import { Validator } from '@elyvel/validation'

await Validator.make(data, { name: 'required|string' })
  .sometimes('company', 'required|string', data => data.accountType === 'business')
  .validate()
```

## Nested & wildcard fields

Dot-paths reach nested data, and `*` validates every item in an array:

```ts
rules(): Rules {
  return {
    'address.city': 'required|string',
    'tags.*': 'string|max:20',
  }
}
```

## Customizing messages & attribute names

Override `messages()` and `attributes()` on the FormRequest:

```ts
class StorePostRequest extends FormRequest {
  rules(): Rules {
    return { title: 'required|string' }
  }

  messages(): Record<string, string> {
    return { 'title.required': 'Give your post a title.' }
  }

  attributes(): Record<string, string> {
    return { title: 'post title' }
  }
}
```

## Preparing input before validation

Override `prepareForValidation` to normalize data before the rules run —
useful for deriving one field from another:

```ts
class StorePostRequest extends FormRequest {
  override prepareForValidation(data: Data): Data {
    if (typeof data.slug === 'string' && data.slug.trim() !== '')
      data.slug = Str.slug(data.slug)
    return data
  }

  rules(): Rules {
    return { slug: 'nullable|string|regex:^[a-z0-9]+(?:-[a-z0-9]+)*$|unique:posts,slug' }
  }
}
```

## Authorizing the request

Override `authorize()` to gate the whole request — returning `false` throws a
`403` before any rule runs:

```ts
class UpdatePostRequest extends FormRequest {
  override authorize(ctx: RequestLike): boolean {
    return gate().forUser(ctx.user as User | null).allows('update', ctx.model)
  }

  rules(): Rules {
    return { title: 'required|string' }
  }
}
```

## After validation

Override `passedValidation` to run logic once validation has succeeded, before
the validated data is returned — e.g. deriving a field that shouldn't itself be
validated:

```ts
override passedValidation(validated: Data, ctx: RequestLike): void {
  validated.author_id = (ctx.user as User).id
}
```
