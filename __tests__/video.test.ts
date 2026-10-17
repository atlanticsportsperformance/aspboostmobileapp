import { youTubeId, videoThumb, hasVideo } from '../lib/video';

describe('lib/video', () => {
  it('youTubeId handles watch, youtu.be, shorts, embed', () => {
    expect(youTubeId('https://www.youtube.com/watch?v=abc123XYZ_-')).toBe('abc123XYZ_-');
    expect(youTubeId('https://youtube.com/watch?feature=share&v=abc123')).toBe('abc123');
    expect(youTubeId('https://m.youtube.com/watch?v=abc123&t=10s')).toBe('abc123');
    expect(youTubeId('https://youtu.be/abc123?si=xyz')).toBe('abc123');
    expect(youTubeId('https://www.youtube.com/shorts/abc123')).toBe('abc123');
    expect(youTubeId('https://www.youtube.com/embed/abc123?rel=0')).toBe('abc123');
    expect(youTubeId('https://vimeo.com/12345')).toBeNull();
    expect(youTubeId(null)).toBeNull();
    expect(youTubeId(undefined)).toBeNull();
  });

  it('trims URLs with surrounding spaces', () => {
    expect(youTubeId('  https://youtu.be/abc123  ')).toBe('abc123');
    expect(youTubeId(' https://www.youtube.com/watch?v=abc123\n')).toBe('abc123');
    expect(hasVideo('  https://cdn.example.com/clip.mp4 ')).toBe(true);
  });

  it('videoThumb null for non-YouTube', () => {
    expect(videoThumb('https://youtu.be/abc123')).toBe('https://img.youtube.com/vi/abc123/hqdefault.jpg');
    expect(videoThumb('https://vimeo.com/12345')).toBeNull();
    expect(videoThumb('https://cdn.example.com/clip.mp4')).toBeNull();
    expect(videoThumb(null)).toBeNull();
  });

  it('hasVideo false for empty', () => {
    expect(hasVideo('')).toBe(false);
    expect(hasVideo('   ')).toBe(false);
    expect(hasVideo(null)).toBe(false);
    expect(hasVideo(undefined)).toBe(false);
    expect(hasVideo('not a url')).toBe(false);
    expect(hasVideo('ftp://x.com/a.mp4')).toBe(false);
    expect(hasVideo('https://cdn.example.com/clip.mp4')).toBe(true);
    expect(hasVideo('http://youtu.be/abc123')).toBe(true);
  });
});
