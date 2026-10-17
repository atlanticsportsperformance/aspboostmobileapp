import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const D = read('screens/exercise-detail-view.tsx');
const O = read('screens/block-overview.tsx');
const B = read('components/logger/FloatingVideoButton.tsx');
const Win = read('components/logger/FloatingVideoWindow.tsx');

describe('floating video wiring', () => {
  it('no inline YoutubePlayer left in the exercise body', () => {
    expect(D).not.toContain('<YoutubePlayer');
    expect(D).not.toContain("from 'react-native-youtube-iframe'");
    expect(D).not.toContain('function getYouTubeVideoId');
  });
  it('FloatingVideoButton rendered conditionally on hasVideo (and hidden with the keypad)', () => {
    expect(D.match(/<FloatingVideoButton/g)?.length).toBe(1);
    const i = D.indexOf('<FloatingVideoButton');
    const before = D.slice(Math.max(0, i - 200), i);
    expect(before).toContain('hasVideo(');
    expect(before).toContain('!activeInput');
  });
  it('the window is rendered and ⤢ opens the shared full-screen modal', () => {
    expect(D).toContain('<FloatingVideoWindow');
    expect(D).toContain('<VideoModal');
    expect(O).toContain('<VideoModal');
    expect(O).not.toContain('function getYouTubeVideoId');
    expect(O).toContain("from '../lib/video'");
  });
  it('non-YouTube links open full screen via Linking from the ▶', () => {
    const fn = D.slice(D.indexOf('const openVideo = '), D.indexOf('const openVideo = ') + 200);
    expect(fn).toContain('if (videoId) setFloatingVideoOpen(true)');
    expect(fn).toContain('Linking.openURL(videoUrl)');
  });
  it('button shows the thumbnail with ▶ over it, plain ▶ otherwise', () => {
    expect(B).toContain('videoThumb(');
    expect(B).toContain('▶');
    expect(B).toMatch(/if \(!hasVideo\(url\)\) return null/);
  });
  it('window loops, drags clamped to the screen, ✕ closes, ⤢ expands; non-YouTube opens via Linking', () => {
    expect(Win).toContain('<YoutubePlayer');
    expect(Win).toContain('loop: true');
    expect(Win).toContain('PanResponder.create');
    expect(Win).toContain('useWindowDimensions');
    expect(Win).toContain('clamp(');
    expect(Win).toContain('· DEMO');
    expect(Win).toContain('⤢');
    expect(Win).toContain('✕');
    expect(Win).toContain('Linking.openURL');
    // overlay never blocks logging: the wrapper passes touches through
    expect(Win).toContain('pointerEvents="box-none"');
  });
});
