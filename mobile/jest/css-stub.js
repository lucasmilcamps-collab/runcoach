/**
 * `constants/theme.ts` imports `global.css` so Metro injects the web focus-ring
 * stylesheet into the bundle. Jest has no CSS transformer and would try to parse
 * it as JavaScript, so under test the import resolves to nothing — the palette
 * itself is what the tests are about.
 */
module.exports = {};
