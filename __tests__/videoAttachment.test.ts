import {
  prepareVideo,
  VideoTooLongError,
  VideoUnreadableError,
} from '../lib/videoAttachment';
import { Video as VideoCompressor } from 'react-native-compressor';
import * as FileSystem from 'expo-file-system/legacy';

describe('prepareVideo', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('throws VideoTooLongError before compression when durationMs > 60_000', async () => {
    await expect(prepareVideo('file:///clip.mov', 61_000)).rejects.toThrow(
      VideoTooLongError
    );
    expect(VideoCompressor.compress).not.toHaveBeenCalled();
  });

  it('throws VideoUnreadableError and deletes the temp file when the compressed size is 0', async () => {
    (VideoCompressor.compress as jest.Mock).mockResolvedValueOnce(
      'file:///compressed.mp4'
    );
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({
      exists: true,
      size: 0,
    });

    await expect(prepareVideo('file:///clip.mov', 30_000)).rejects.toThrow(
      VideoUnreadableError
    );

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///compressed.mp4',
      { idempotent: true }
    );
  });
});
