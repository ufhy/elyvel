## Inertia (@elyvel/inertia)

- Handlers return `inertia('Pages/Users/Index', { users })`; pages are Vue
  components under `resources/js/pages/`. There is no JSON API contract for
  Inertia routes — do not add one for the frontend's sake.
- Share types, don't duplicate them: a frontend type mirroring a model must
  derive (`Pick`/`extends`) from the real model type.
- Navigation uses Inertia's `<Link>`/`router` — a plain `<a>` reloads the
  whole app.
