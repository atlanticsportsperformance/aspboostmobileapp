/**
 * Test-only stub for `expo-file-system/legacy`.
 *
 * Minimal surface used by lib/messagesApi.ts and lib/videoAttachment.ts:
 * getInfoAsync, deleteAsync, createUploadTask, FileSystemUploadType. Each
 * function is a jest.fn() so individual tests can set return values /
 * implementations per-case.
 */
export const getInfoAsync = jest.fn(async () => ({ exists: true, size: 0 }));

export const deleteAsync = jest.fn(async () => undefined);

export const FileSystemUploadType = {
  BINARY_CONTENT: 'BINARY_CONTENT',
};

export const createUploadTask = jest.fn(() => ({
  uploadAsync: jest.fn(async () => ({ status: 200 })),
}));
