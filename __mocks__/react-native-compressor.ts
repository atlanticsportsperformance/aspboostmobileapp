/**
 * Test-only stub for `react-native-compressor`.
 *
 * Only the `Video.compress` static used by lib/videoAttachment.ts is
 * exercised in tests. jest.fn() so tests can set per-case return values.
 */
export const Video = {
  compress: jest.fn(async (uri: string) => uri),
};
