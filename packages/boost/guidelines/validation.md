## Validation (@elyvel/validation)

- Validate request input with Form Requests (`elyvel make:request <Name>`) or
  inline `validate()` — Laravel-style string rules (`'required|email|max:255'`)
  and the same rule names.
- Custom rules register once with `registerRule(name, fn, message)`; the
  message is overridable via translations (`validation::<name>`).
- A failed validation throws — the framework turns it into a 422 (JSON errors
  for API clients, redirect-back with errors for the `web` group). Don't catch
  it yourself in handlers.
