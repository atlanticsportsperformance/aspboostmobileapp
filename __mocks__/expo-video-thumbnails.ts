/**
 * Test-only stub for `expo-video-thumbnails`.
 *
 * Only `getThumbnailAsync` (used by lib/videoAttachment.ts) is exercised in
 * tests. jest.fn() so tests can set per-case return values / rejections.
 */
export const getThumbnailAsync = jest.fn(async () => ({ uri: 'file:///thumb.jpg' }));
