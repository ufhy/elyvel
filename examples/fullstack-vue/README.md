# Fullstack Vue

A [elysia-ravel](https://github.com/ufhy/elysia-ravel) application.

## Getting started

`ravel new` already created your `.env` with a generated `APP_KEY`.

```bash
bun install
bun run migrate           # create the database
bun run dev               # start the dev server
```

(Rotate the key anytime with `bun run key:generate`.)

## Layout

```
config/       Application configuration (app, database, session)
app/          Models, providers, and your domain code
routes/       HTTP routes (auto-mounted)
database/     Migrations and seeders
server.ts     Entry point — boots the framework
```

Add code with the CLI: `ravel make:model Post`, `ravel make:controller PostController`,
`ravel make:migration create_posts_table`, `ravel make:policy Post --model`.
