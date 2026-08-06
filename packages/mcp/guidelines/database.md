## Database (@elyvel/database)

- Models extend `Model` in `app/models/`, Eloquent-style: `casts`, `fillable`,
  relations (`hasMany`, `belongsTo`, …), scopes, observers, and route-model
  binding all exist — check the model class before inventing helpers.
- Always use `User.query()` builders or model methods; never hand-write SQL in
  application code. For quick data inspection use the `database-query`
  tool instead of a script.
- Schema changes go through migrations: `elyvel make:migration <name>`, then
  `elyvel migrate`. Check the real schema first with the
  `database-schema` tool. `elyvel migrate:fresh` drops everything — never run
  it without explicit user approval.
- When creating a model, prefer `elyvel make:model <Name> --migration
  --factory` so the migration and factory match the model from the start.
- Eager-load relations you will iterate (`.with('posts')`) — N+1s are as real
  here as in Laravel.
- Concerns are the trait equivalent: `withConcerns(Post, HasStatus)` AFTER the
  class declaration — it mutates the class, it is not a base class to extend.
  Typed fields come from a same-named interface (`interface Post extends
  HasStatusFields {}`), and both that line and the class need
  `// eslint-disable-next-line ts/no-unsafe-declaration-merging` or the lint
  preset rejects the file.
