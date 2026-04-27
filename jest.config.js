/**
 * Minimal Jest config for the Pulse decoder port.
 *
 * Decoder code is pure TypeScript (Uint8Array / Float64Array / DataView only,
 * no React Native imports), so we run tests in vanilla Node via ts-jest. No
 * jest-expo / react-native preset is needed — those add ~10s of startup and
 * pull in modules the decoder never touches.
 *
 * Tests read CSV captures from /Users/maxsmac/Desktop/motus/data/ via fs at
 * test time. Those files are NOT bundled into the RN app — they only exist
 * in the dev environment for verification.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Resolve `@/...` imports the same way the web app does. The decoder tests
  // were ported verbatim from aspboostapp and use absolute paths via this
  // alias.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
