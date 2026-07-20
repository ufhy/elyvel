import antfu from '@antfu/eslint-config'

// Migrated from Biome. Stylistic defaults are pinned to the conventions the
// codebase already follows (single quotes, no semicolons, 2-space indent), so
// the switch stays diff-quiet. antfu auto-detects TypeScript + Vue; Vue support
// brings real `<template>`-aware linting (which Biome lacked).
export default antfu(
  {
    type: 'lib',
    typescript: true,
    vue: true,
    stylistic: {
      indent: 2,
      quotes: 'single',
      semi: false,
    },
    ignores: [
      '**/dist',
      '**/node_modules',
      '.vscode',
      // CLI scaffolding templates are *.tmpl (not valid TS/JS) — never lint them.
      'packages/cli/templates/**',
      '**/*.tmpl',
      // Vendored shadcn-vue primitives — owned by the app, kept in upstream style.
      '**/resources/js/components/ui/**',
      // READMEs carry illustrative (non-compiling) code fences — don't lint docs.
      '**/*.md',
    ],
  },
  // Global ignores must be their own ignores-only config object — nesting
  // `ignores` inside a config object that also sets `rules` (like the two
  // below) scopes it to that object only, not every config in this array.
  {
    ignores: ['**/bootstrap/providers.generated.ts'],
  },
  {
    // Match what Biome enforced + keep the patterns this codebase uses on purpose.
    rules: {
      // Biome had these off; the DB/generic layers rely on them.
      'ts/no-explicit-any': 'off',
      'ts/no-non-null-assertion': 'off',
      'ts/no-unsafe-function-type': 'off', // Biome noBannedTypes: off
      'ts/no-empty-object-type': 'off',
      'ts/no-this-alias': 'off', // `const self = this` is intentional
      'ts/no-use-before-define': 'off', // module-level lets referenced by hoisted fns
      // Style opinions Biome never enforced — off to keep the migration diff-quiet.
      'ts/explicit-function-return-type': 'off',
      'node/prefer-global/process': 'off',
      'node/prefer-global/buffer': 'off',
      'antfu/no-top-level-await': 'off', // ESM app entrypoints
      'no-console': 'off', // logger / mail-log transport / examples log on purpose
      'new-cap': 'off', // framework instantiates classes held in variables
      'no-new-func': 'off', // job/batch deserialization rebuilds functions on purpose
      'vue/multi-word-component-names': 'off',
      // Keep interface methods in `method(): T` form: property style flips param
      // variance under strictFunctionTypes and breaks structural assignability.
      'ts/method-signature-style': ['error', 'method'],
    },
  },
  {
    // Tests use `require()` for dynamic/isolated module loading.
    files: ['**/*.test.ts'],
    rules: {
      'ts/no-require-imports': 'off',
    },
  },
)
