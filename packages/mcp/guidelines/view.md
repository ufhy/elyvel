## Views & HTML (@elyvel/view)

- `html` tagged templates escape interpolated values by default; `raw()` opts
  out and is the only place XSS can enter — never wrap user input in it.
- Return `view(...)` (from `@elyvel/view`) for a server-rendered page. For
  Vue/Inertia apps use `inertia(...)` instead; do not mix the two for one page.
