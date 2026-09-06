import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const SCREEN = read('screens/MessagesScreen.tsx');
const APP = read('App.tsx');
const PUSH = read('lib/pushNotifications.ts');
const APP_JSON = JSON.parse(read('app.json'));

describe('app icon badge is cleared when a thread is read (item 2)', () => {
  it('markConversationAsRead bails without a user id', () => {
    expect(SCREEN).toContain('async function markConversationAsRead(conversationId: string) {');
    expect(SCREEN).toMatch(/markConversationAsRead[\s\S]{0,400}if \(!currentUser\?\.id\) return;/);
    // The update itself no longer passes a possibly-undefined id.
    expect(SCREEN).not.toContain(".eq('user_id', currentUser?.id)");
  });

  it('clears the badge via expo-notifications, guarded', () => {
    expect(SCREEN).toContain("import * as Notifications from 'expo-notifications';");
    expect(SCREEN).toContain('await Notifications.setBadgeCountAsync(0);');
    expect(SCREEN).toMatch(/try \{\s*await Notifications\.setBadgeCountAsync\(0\);\s*\} catch/);
  });
});

describe('a cold-start push tap survives auth (item 3)', () => {
  it('parks the payload instead of dropping it when there is no session', () => {
    expect(APP).toContain('pendingNotificationRef');
    expect(APP).toMatch(/if \(!session\) \{\s*pendingNotificationRef\.current = data;\s*return;\s*\}/);
    expect(APP).not.toContain('if (!navigationRef.current || !session) return;');
  });

  it('replays and clears it in an effect watching session', () => {
    expect(APP).toMatch(/useEffect\(\(\) => \{[\s\S]{0,400}pendingNotificationRef\.current = null;[\s\S]{0,400}\}, \[session, handleNotificationNavigation\]\);/);
  });
});

describe('inbox realtime for conversations that are not open (item 4)', () => {
  it('subscribes to messages INSERTs with no conversation filter and cleans up', () => {
    expect(SCREEN).toContain("supabase\n      .channel('inbox-messages')");
    expect(SCREEN).toContain("{ event: 'INSERT', schema: 'public', table: 'messages' }");
    expect(SCREEN).toMatch(/inbox-messages[\s\S]*?return \(\) => \{\s*supabase\.removeChannel\(channel\);/);
  });

  it('skips the open thread, bumps unread, and moves the conversation to the top', () => {
    expect(SCREEN).toContain('if (row.conversation_id === selectedConversationIdRef.current) return;');
    expect(SCREEN).toContain('unread_count: prev[idx].unread_count + (fromSomeoneElse ? 1 : 0)');
    expect(SCREEN).toContain('return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];');
  });

  it('refetches the list when the conversation is unknown', () => {
    expect(SCREEN).toMatch(/if \(!known\) \{\s*fetchConversations\(currentUser\.id\)/);
  });
});

describe('a push into an archived conversation opens it (item 5)', () => {
  it('un-archives the participant row, refetches, and retries at most once', () => {
    expect(SCREEN).toContain('async function unarchiveAndRefetch(conversationId: string) {');
    expect(SCREEN).toContain("update({ is_archived: false })");
    expect(SCREEN).toMatch(/unarchiveAndRefetch[\s\S]{0,600}await fetchConversations\(userId\);/);
    expect(SCREEN).toContain('unarchiveAttemptedRef.current = routeConversationId;');
  });
});

describe('the thread stops yanking to the bottom (item 6)', () => {
  it('tracks proximity to the bottom from onScroll', () => {
    expect(SCREEN).toContain('function handleMessagesScroll(event: any) {');
    expect(SCREEN).toContain('isNearBottomRef.current = distanceFromBottom <= 120;');
    expect(SCREEN).toContain('onScroll={handleMessagesScroll}');
  });

  it('auto-scrolls only when near the bottom or explicitly forced', () => {
    expect(SCREEN).not.toContain('onContentSizeChange={() => messagesEndRef.current?.scrollToEnd({ animated: false })}');
    expect(SCREEN).toContain('if (isNearBottomRef.current || shouldForceScrollRef.current) {');
    // The user's own send always follows.
    expect(SCREEN).toMatch(/isNearBottomRef\.current = true;\s*shouldForceScrollRef\.current = true;/);
  });
});

describe('optimistic send with a failed-state retry (item 7)', () => {
  it('appends a local bubble before the upload starts', () => {
    expect(SCREEN).toContain("status?: 'sending' | 'failed';");
    expect(SCREEN).toContain('const optimistic: Message = {');
    expect(SCREEN).toContain("status: 'sending',");
    expect(SCREEN).toContain('const localId = retryOfLocalId ?? `local-');
  });

  it('replaces the bubble with the server message on success', () => {
    expect(SCREEN).toContain('delete pendingSendsRef.current[localId];');
    expect(SCREEN).toContain('const idx = withoutServerDupe.findIndex(m => m.id === localId);');
  });

  it('marks it failed, stashes the retry payload, and only alerts on a retry', () => {
    expect(SCREEN).toContain('pendingSendsRef.current[localId] = { content: messageContent, attachments: currentAttachments };');
    expect(SCREEN).toContain("{ ...m, status: 'failed' as const }");
    expect(SCREEN).toMatch(/if \(isRetry\) \{\s*const message =/);
    // The composer text is not restored — it lives in the failed bubble.
    expect(SCREEN).not.toContain('setNewMessage(messageContent);');
  });

  it('renders a tap-to-retry affordance wired to retrySend', () => {
    expect(SCREEN).toContain('async function retrySend(localId: string) {');
    expect(SCREEN).toContain('onPress={() => retrySend(message.id)}');
    expect(SCREEN).toContain('Not sent · Tap to retry');
  });

  it('does not offer to delete a message that has no server row yet', () => {
    expect(SCREEN).toContain('onLongPress={() => isOwn && !message.status && deleteMessage(message.id)}');
  });
});

describe('the 60s video cap is enforced at pick time (item 8)', () => {
  it('normalizes the picker duration and rejects over-length library videos', () => {
    expect(SCREEN).toContain('function normalizeAssetDurationSeconds(');
    expect(SCREEN).toContain('normalizeAssetDurationSeconds(asset.duration) > MAX_VIDEO_DURATION_SECONDS');
    expect(SCREEN).toContain('`Videos must be ${MAX_VIDEO_DURATION_SECONDS} seconds or shorter.`');
  });
});

describe('documents are size-checked before upload (item 9)', () => {
  it('rejects assets over MAX_ATTACHMENT_BYTES in pickDocument', () => {
    expect(SCREEN).toContain('MAX_ATTACHMENT_BYTES,');
    expect(SCREEN).toMatch(/pickDocument[\s\S]{0,900}\(a\.size \?\? 0\) > MAX_ATTACHMENT_BYTES/);
    expect(SCREEN).toContain("Alert.alert(\n            'File Too Large',");
  });
});

describe('Android composer, keyboard and notification permission (item 10)', () => {
  it('gives KeyboardAvoidingView an Android behavior', () => {
    expect(SCREEN).toContain("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}");
  });

  it('sets softwareKeyboardLayoutMode and POST_NOTIFICATIONS in app.json', () => {
    expect(APP_JSON.expo.android.softwareKeyboardLayoutMode).toBe('pan');
    expect(APP_JSON.expo.android.permissions).toContain('android.permission.POST_NOTIFICATIONS');
  });
});

describe('older messages can be loaded (item 11)', () => {
  it('pages backwards by created_at and preserves scroll position', () => {
    expect(SCREEN).not.toContain('TODO: add load-older pagination');
    expect(SCREEN).toContain('async function loadOlderMessages() {');
    expect(SCREEN).toContain(".lt('created_at', before)");
    expect(SCREEN).toContain('.limit(MESSAGE_PAGE_SIZE)');
    expect(SCREEN).toContain('maintainVisibleContentPosition={{ minIndexForVisible: 1 }}');
    expect(SCREEN).toContain('Load earlier messages');
  });

  it('tracks the oldest loaded row and whether more exist', () => {
    expect(SCREEN).toContain('oldestLoadedAtRef');
    expect(SCREEN).toContain('setHasMoreMessages((data || []).length === MESSAGE_PAGE_SIZE);');
  });
});

describe('foreground banners are suppressed for the open thread (item 12)', () => {
  it('exports a setter the screen drives from the selected conversation', () => {
    expect(PUSH).toContain('export function setCurrentOpenConversationId(conversationId: string | null): void');
    expect(SCREEN).toContain("import { setCurrentOpenConversationId } from '../lib/pushNotifications';");
    expect(SCREEN).toContain('setCurrentOpenConversationId(selectedConversation?.id ?? null);');
    expect(SCREEN).toContain('return () => setCurrentOpenConversationId(null);');
  });

  it('the notification handler consults it', () => {
    expect(PUSH).toContain('const conversationId = data.conversationId || data.conversation_id;');
    expect(PUSH).toContain('shouldShowAlert: !isOpenThread,');
    expect(PUSH).toContain('shouldShowBanner: !isOpenThread,');
    // The list entry still appears; only the interruption is suppressed.
    expect(PUSH).toContain('shouldShowList: true,');
  });

  it('registers the Android "messages" channel the server targets', () => {
    expect(PUSH).toMatch(/setupPushNotifications[\s\S]{0,600}Platform\.OS === 'android'/);
    expect(PUSH).toContain("await Notifications.setNotificationChannelAsync('messages', {");
    expect(PUSH).toContain('importance: Notifications.AndroidImportance.HIGH,');
    expect(PUSH).toContain("sound: 'default',");
    expect(PUSH).toMatch(/setNotificationChannelAsync\('messages'[\s\S]{0,220}\} catch \(channelError\)/);
  });
});

describe('realtime recovery on foreground (item 13)', () => {
  it('refetches the list and the open thread on background -> active', () => {
    expect(SCREEN).toContain("AppState.addEventListener('change'");
    expect(SCREEN).toContain("(previousState === 'background' || previousState === 'inactive') && nextState === 'active'");
    expect(SCREEN).toMatch(/cameToForeground[\s\S]{0,400}fetchConversations\(currentUser\.id\)/);
    expect(SCREEN).toMatch(/const openId = selectedConversationIdRef\.current;[\s\S]{0,200}fetchMessages\(openId\)/);
    expect(SCREEN).toContain('return () => subscription.remove();');
  });
});

describe('photos are downscaled before upload (item 14)', () => {
  it('caps the longest edge at 2048 via expo-image-manipulator', () => {
    expect(SCREEN).toContain('const MAX_IMAGE_DIMENSION = 2048;');
    expect(SCREEN).toContain('longestEdge > MAX_IMAGE_DIMENSION');
    expect(SCREEN).toContain('{ resize: { width: MAX_IMAGE_DIMENSION } }');
    expect(SCREEN).toContain('{ resize: { height: MAX_IMAGE_DIMENSION } }');
    // the manipulator is lazy-required so a stale app binary degrades instead of crashing
    expect(SCREEN).toContain("return require('expo-image-manipulator');");
    expect(SCREEN).toContain('{ compress: 0.8, format: IM.SaveFormat.JPEG }');
    expect(SCREEN).toContain('{ compress: 0.8, format: IM2.SaveFormat.JPEG }');
  });

  it('carries the picker dimensions through to prepareForUpload', () => {
    expect(SCREEN).toContain('width: asset.width,');
    expect(SCREEN).toContain('height: asset.height,');
  });

  it('re-reads the size after producing a new file', () => {
    expect(SCREEN).toMatch(/if \(fileUri !== attachment\.uri\) \{[\s\S]{0,300}size = 0;/);
  });
});

describe('media whose URL went stale retries once (item 15)', () => {
  const COMPONENT = read('components/MessageAttachmentImage.tsx');

  it('re-resolves a fresh signed URL on the first error only', () => {
    expect(COMPONENT).toContain("import { resolveAttachmentDirectUrl } from '../lib/messagesApi';");
    expect(COMPONENT).toContain('onError={() => {');
    expect(COMPONENT).toMatch(/if \(retryUrl \|\| !storagePath\) \{\s*setFailed\(true\);/);
    expect(COMPONENT).toContain('resolveAttachmentDirectUrl(storagePath)');
    // A signed URL carries its own auth; sending headers as well is wrong.
    expect(COMPONENT).toContain('source={retryUrl ? { uri: retryUrl } : { uri, headers: authHeaders }}');
  });

  it('is used for both own and received message attachments', () => {
    expect((SCREEN.match(/<MessageAttachmentImage/g) || []).length).toBe(2);
    // The old inline <Image> blocks are gone.
    expect(SCREEN).not.toContain('style={styles.attachmentImage}');
  });
});
