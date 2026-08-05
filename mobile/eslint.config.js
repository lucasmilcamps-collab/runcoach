// Committed rather than left to `expo lint`'s first-run scaffolding: that path
// downloads a config on demand, which fails behind a proxy and means the linter
// silently never runs. With the config in the repo, `npm run lint` works on a
// clean checkout and in CI.
//
// The rule that matters most here is `react-hooks/rules-of-hooks`. Colour in
// this app resolves through hooks (`useTheme`, and `makeStyles`, which returns
// one) — so a stylesheet read from a plain helper function instead of a
// component compiles, type-checks, and then crashes at runtime. Nothing else in
// the toolchain catches that.

const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'expo-env.d.ts', '.expo/*'],
  },
  {
    // Scoped to TypeScript: `eslint-config-expo` only registers the
    // @typescript-eslint plugin for these files, and a rule referencing a
    // plugin outside that scope is a hard config error.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // An unused import survives a refactor unnoticed and quietly grows the
      // bundle; args are allowed a leading underscore for deliberate skips.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
]);
