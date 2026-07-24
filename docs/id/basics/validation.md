# Validasi

Input divalidasi dengan class **FormRequest** — mekanisme yang sama dipakai di
seluruh framework, termasuk alur register/login/reset di
[Autentikasi](/id/security/authentication). Rule menggunakan sintaks
piped-string yang familiar dari Laravel.

## Menulis FormRequest

Extend `FormRequest` dan definisikan `rules()`. Panggil static `validate(ctx)`
di controller — mengembalikan data yang sudah tervalidasi, atau melempar `422`
dengan error bag ala Laravel:

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

Generate dengan `bunx elyvel make:request StorePostRequest`.

Validasi yang gagal mengembalikan:

```json
{
  "message": "The title field is required. (and 1 more error)",
  "errors": {
    "title": ["The title field is required."],
    "body": ["The body field is required."]
  }
}
```

## Rule

Rule adalah string yang dipisah pipe per field, atau array (diperlukan saat
mencampur string dengan rule kustom — lihat di bawah). Sebagian rule yang umum
dipakai:

| Kategori | Rule |
| --- | --- |
| Kehadiran | `required`, `nullable`, `sometimes`, `present`, `filled`, `required_if`, `required_unless`, `required_with`, `prohibited`, `prohibited_if` |
| Tipe | `string`, `integer`, `numeric`, `boolean`, `array`, `date` |
| Format | `email`, `url`, `uuid`, `ulid`, `ip`, `json`, `regex`, `alpha`, `alpha_num`, `alpha_dash` |
| Ukuran | `min`, `max`, `size`, `between` (panjang string, nilai angka, atau jumlah item array/file — ditentukan dari tipe field) |
| Perbandingan | `same`, `different`, `confirmed`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in` |
| File | `file`, `image`, `mimes`, `dimensions`, `max` (kilobita) |
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

Mengecek langsung ke database — `unique:table,column` dan `exists:table,column`
(column default-nya `id`). Keduanya otomatis terhubung ke `@elyvel/database`
oleh `EloquentServiceProvider`, dengan timeout supaya koneksi yang macet tidak
menggantung request selamanya.

```ts
slug: 'nullable|string|unique:posts,slug'
```

Untuk mengecualikan baris saat ini pada update (`unique:posts,slug,{id}` di
Laravel), kirim argumen ketiga:

```ts
rules(ctx: RequestLike): Rules {
  return { slug: `unique:posts,slug,${(ctx.model as Post).id}` }
}
```

## Rule kustom

Campurkan closure atau rule object ke dalam **array** rule sebuah field.
Closure memanggil `fail(message)` untuk menolak:

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

Rule yang bisa dipakai ulang adalah object dengan method
`validate(value, fail, ctx)`:

```ts
import type { CustomRuleContext, FailFn } from '@elyvel/validation'

export const NoSpaces = {
  validate(value: unknown, fail: FailFn, ctx: CustomRuleContext) {
    if (String(value).includes(' '))
      fail(`The ${ctx.attribute} field must not contain spaces.`)
  },
}
```

::: tip Typing di editor
Ditulis inline seperti di atas, `value`/`fail` otomatis mendapat tipe —
TypeScript menginferensinya dari `Rules` (`value` bertipe `unknown`, memaksa
narrowing dulu sebelum dipakai; `fail` ter-autocomplete sebagai
`(message: string) => void`). Inferensi ini hanya berlaku di dalam array
literal itu sendiri; kalau closure dipindah ke variabel terpisah, anotasikan
manual dengan `ClosureRule` (atau ketik object mandiri dengan `RuleObject`,
seperti `NoSpaces` di atas).
:::

## Rule password

Gunakan `Password` untuk rule kompleksitas yang bisa dikomposisi — dan set
default satu app sekali dengan `Password.defaults()` supaya setiap alur yang
menyentuh password (registrasi, reset, ganti password) sepakat. Lihat
[Autentikasi → Kebijakan password](/id/security/authentication#kebijakan-password).

```ts
import { Password } from '@elyvel/validation'

password: ['required', 'string', Password.min(8).mixedCase().numbers().symbols()]
```

## Rule kondisional

`rules(ctx)` adalah method biasa yang menerima konteks request — termasuk
`ctx.body` — jadi tambahkan rule secara kondisional dengan JS biasa (`sometimes`
di Laravel, dilakukan inline):

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

Memakai `Validator` secara langsung (tanpa FormRequest) menyediakan ide yang
sama sebagai `.sometimes(fields, rules, when)` yang bisa dirangkai:

```ts
import { Validator } from '@elyvel/validation'

await Validator.make(data, { name: 'required|string' })
  .sometimes('company', 'required|string', data => data.accountType === 'business')
  .validate()
```

## Field nested & wildcard

Dot-path menjangkau data nested, dan `*` memvalidasi setiap item dalam array:

```ts
rules(): Rules {
  return {
    'address.city': 'required|string',
    'tags.*': 'string|max:20',
  }
}
```

## Mengustomisasi pesan & nama atribut

Override `messages()` dan `attributes()` di FormRequest:

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

## Mempersiapkan input sebelum validasi

Override `prepareForValidation` untuk menormalkan data sebelum rule dijalankan
— berguna untuk menurunkan satu field dari field lainnya:

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

## Mengotorisasi request

Override `authorize()` untuk menggerbang seluruh request — mengembalikan
`false` melempar `403` sebelum satu pun rule dijalankan:

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

## Setelah validasi

Override `passedValidation` untuk menjalankan logika setelah validasi berhasil,
sebelum data yang tervalidasi dikembalikan — misalnya menurunkan field yang
tidak seharusnya divalidasi sendiri:

```ts
override passedValidation(validated: Data, ctx: RequestLike): void {
  validated.author_id = (ctx.user as User).id
}
```
