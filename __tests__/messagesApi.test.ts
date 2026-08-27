import { attachmentUrl, resolveAttachmentDirectUrl } from '../lib/messagesApi';
// Resolves to __mocks__/supabase.ts via jest.config.js moduleNameMapper —
// the same stub lib/messagesApi.ts's `import { supabase } from './supabase'`
// resolves to under test.
import { supabase } from '../lib/supabase';

describe('attachmentUrl', () => {
  it('encodes each path segment and strips a leading slash', () => {
    const url = attachmentUrl('/org/conv/a b.mp4');
    expect(url).toBe(
      `${process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app'}/api/messages/attachments/org/conv/a%20b.mp4`
    );
  });
});

describe('resolveAttachmentDirectUrl', () => {
  const originalGetSession = supabase.auth.getSession;
  const originalFetch = global.fetch;

  beforeEach(() => {
    supabase.auth.getSession = (async () => ({
      data: { session: { access_token: 'token-123' } },
    })) as typeof supabase.auth.getSession;
  });

  afterEach(() => {
    supabase.auth.getSession = originalGetSession;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('throws "response had no url" when the JSON body has no url', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(resolveAttachmentDirectUrl('org/conv/video.mp4')).rejects.toThrow(
      'response had no url'
    );
  });
});
