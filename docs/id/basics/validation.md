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
mencampur string dengan rule kustom — lihat di bawah).

| Kategori | Rule |
| --- | --- |
| Kehadiran | `required`, `nullable`, `sometimes`, `present`, `filled`, `required_if`, `required_unless`, `required_with`, `required_with_all`, `required_without`, `required_without_all`, `prohibited`, `prohibited_if`, `prohibited_unless`, `missing`, `missing_if`, `missing_with`, `accepted`, `accepted_if`, `declined`, `declined_if` |
| Tipe | `string`, `integer`, `numeric`, `boolean`, `array`, `date` |
| Format | `email`, `url`, `uuid`, `ulid`, `ip`, `mac_address`, `hex_color`, `json`, `timezone`, `alpha`, `alpha_num`, `alpha_dash`, `ascii`, `uppercase`, `lowercase`, `in`, `not_in`, `in_array`, `regex`, `starts_with`, `ends_with`, `doesnt_start_with`, `doesnt_end_with`, `digits`, `digits_between`, `decimal`, `multiple_of` |
| Ukuran | `min`, `max`, `size`, `between` — file diukur dalam kilobyte dan array dari jumlah elemennya (keduanya dideteksi dari nilainya sendiri); tambahkan `numeric` untuk membandingkan angka berdasarkan nilainya, bukan jumlah digitnya |
| Perbandingan | `same`, `different`, `confirmed`, `gt`, `gte`, `lt`, `lte`, `date_format`, `before`, `before_or_equal`, `after`, `after_or_equal`, `date_equals` |
| File | `file`, `image`, `mimes`, `mimetypes`, `dimensions`, `max` (kilobita) |
| Database | `unique`, `exists` |

`before`/`after`/`before_or_equal`/`after_or_equal`/`date_equals`
membandingkan terhadap field lain atau string tanggal literal:

```ts
rules(): Rules {
  return {
    starts_at: 'required|date',
    ends_at: 'required|date|after:starts_at',
  }
}
```

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

`EloquentServiceProvider` menyambungkan ini otomatis lewat
`configureDbRules(resolver, options)` — fungsi yang sama tersedia jika
kamu butuh resolver custom (misalnya sumber data non-Eloquent) atau ingin
mengatur berapa lama query `unique`/`exists` boleh menggantung sebelum
dibatalkan dengan `DbRuleTimeoutError` (default 5 detik — koneksi yang
macet kalau tidak akan menggantung request selamanya):

```ts
import { configureDbRules } from '@elyvel/validation'

configureDbRules(myResolver, { timeoutMs: 2000 })
```

### `file` / `image` / `mimes` / `dimensions`

Rule-rule ini membaca byte asli upload-nya (sniffing magic-number), bukan
nama file/ekstensi dari client atau header `Content-Type` — perlindungan
anti-spoofing "image hijacking" yang sama seperti rule file Laravel.
Sniffer di baliknya bisa langsung di-import kalau kamu menulis rule custom
yang perlu memeriksa upload-nya sendiri:

```ts
import { readImageDimensions, sniffFileMime, sniffImageMime } from '@elyvel/validation'

const mime = sniffFileMime(bytes)          // mis. 'application/pdf', atau undefined kalau tidak dikenali
const imageMime = sniffImageMime(bytes)    // lebih sempit: hanya format gambar asli
const dimensions = readImageDimensions(bytes) // { width, height } | undefined
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
`validate(value, fail, ctx)`. Anotasikan dengan `RuleObject` — itulah yang
memberi tahu TypeScript (dan editor) bahwa object tersebut wajib punya method
persis itu; salah nama atau signature-nya, error langsung menunjuk ke baris
definisi, bukan ke tempat rule itu dipakai:

```ts
import type { CustomRuleContext, FailFn, RuleObject } from '@elyvel/validation'

export const NoSpaces: RuleObject = {
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

`.validate()` melempar `ValidationException` saat gagal (sama seperti yang
dilempar FormRequest, yang sudah otomatis di-render error handler framework
sebagai 422 untuk request HTTP) — tangkap sendiri kalau kamu validasi di
luar request, misalnya payload webhook atau data job yang di-queue:

```ts
import { ValidationException } from '@elyvel/validation'

try {
  await Validator.make(payload, { email: 'required|email' }).validate()
}
catch (e) {
  if (e instanceof ValidationException) {
    e.errors // ErrorBag — Record<string, string[]>, satu entry per field yang invalid
  }
}
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

`distinct` mengecek nilai sebuah field wildcard unik di seluruh array (`distinct`
milik Laravel):

```ts
rules(): Rules {
  return { 'tags.*': 'distinct|string' }
}
```

Path bertitik juga bekerja di mana pun sebuah rule menyebut field **lain** —
`required_if:address.country,ID`, `same:user.password`, `lte:limits.max`,
`exclude_unless:address.country,ID`, dan seterusnya.

::: tip Hanya leaf yang tervalidasi yang dikembalikan
Data tervalidasi berisi tepat path yang dicakup rule-mu — bukan parent-nya.
Dengan `{'user.name': 'required'}` dan body `{user: {name: 'Ada', is_admin: true}}`,
kamu dapat `{user: {name: 'Ada'}}`: `is_admin` tidak pernah divalidasi, jadi ia
tidak sampai ke output yang akan kamu serahkan ke `create()`. Tambahkan rule
untuk sebuah field kalau kamu memang mau ia lolos.
:::

## Mengontrol alur validasi

Beberapa pseudo-rule mengubah *bagaimana* validasi berjalan, bukan mengecek
sebuah nilai:

- **`bail`** — hentikan validasi sebuah field pada rule pertama yang gagal,
  alih-alih mengumpulkan setiap kegagalannya (`bail` milik Laravel):

  ```ts
  rules(): Rules {
    return { email: 'bail|required|email|unique:users,email' }
  }
  ```

- **`exclude`** / **`exclude_if:field,value`** / **`exclude_unless:field,value`**
  / **`exclude_with:field`** / **`exclude_without:field`** — hapus field dari
  output tervalidasi sepenuhnya (dan lewati rule-nya sendiri), secara
  kondisional:

  ```ts
  rules(): Rules {
    return {
      payment_type: 'required|in:card,cash',
      card_token: 'exclude_unless:payment_type,card|required|string',
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
