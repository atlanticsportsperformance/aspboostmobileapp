import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Alert,
  FlatList,
  Dimensions,
  Image,
  Linking,
  ActionSheetIOS,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import YoutubePlayer from 'react-native-youtube-iframe';
import {
  sendMessage as sendMessageApi,
  uploadAttachment,
  getAuthHeaders,
  attachmentUrl,
  resolveAttachmentDirectUrl,
  type LocalFile,
  type OutgoingAttachment,
} from '../lib/messagesApi';
import {
  uploadVideoAttachment,
  MAX_VIDEO_DURATION_SECONDS,
  VideoTooLongError,
  VideoTooLargeError,
} from '../lib/videoAttachment';
import { VideoAttachmentPreview } from '../components/VideoAttachmentPreview';
import { VideoPlayerModal } from '../components/VideoPlayerModal';
import { LinkEmbed } from '../components/LinkEmbed';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  avatar_url?: string;
  app_role?: string;
}

interface Conversation {
  id: string;
  type: string;
  title?: string;
  updated_at: string;
  participants: Array<{
    user_id: string;
    profiles: Profile;
  }>;
  last_message?: {
    content: string;
    created_at: string;
    sender_id: string | null;
    is_system_message?: boolean;
  };
  unread_count: number;
}

// Check if conversation is the Notifications or Automation channel
function isNotificationsConversation(conversation: Conversation): boolean {
  return (conversation.title === 'Notifications' || conversation.title === '🤖 Automation') &&
    (conversation.type === 'announcement' || conversation.type === 'notifications');
}

interface Message {
  id: string;
  content: string;
  sender_id: string | null;
  created_at: string;
  sender: Profile | null;
  is_system_message?: boolean;
  system_message_type?: string;
  attachments?: Array<{
    // A stored file has storage_path and no file_url; an external link
    // (pasted YouTube/Vimeo) has file_url and no storage_path. Exactly one is
    // present — see lib/messaging/message-body.ts on the API side.
    file_url?: string;
    storage_path?: string;
    file_name: string;
    file_type: string;
    file_size: number;
    mime_type?: string;
    thumbnail_path?: string;
    duration_seconds?: number;
  }>;
}

export default function MessagesScreen({ navigation }: any) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [athleteId, setAthleteId] = useState<string>('');
  const [orgId, setOrgId] = useState<string>('');
  const messagesEndRef = useRef<ScrollView>(null);

  // New conversation dialog state
  const [showNewConversationDialog, setShowNewConversationDialog] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<Profile[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Attachment state
  const [attachments, setAttachments] = useState<Array<{
    uri: string;
    name: string;
    type: string;
    size?: number;
    duration?: number;
  }>>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  // Compression takes real time (seconds); this drives a "Preparing video…"
  // label so the composer doesn't look frozen/crashed while it runs.
  const [preparingVideo, setPreparingVideo] = useState(false);
  // Successful uploads, keyed by the attachment's local `uri`. A partial
  // failure (e.g. attachment 2 of 3 throws) must not re-upload attachment 1
  // on retry — signUpload mints a fresh storage path every call, so a
  // re-upload would orphan the first object. Cleared on send success, on
  // attachment removal, and whenever the selected conversation changes.
  const uploadedAttachmentsCacheRef = useRef<Record<string, OutgoingAttachment>>({});
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);

  // Image viewer state
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  // Fullscreen video player state. `playingVideoUri` is always an
  // already-playable URL (a resolved signed URL, or a legacy public
  // file_url) — never the `/api/messages/attachments/...` endpoint URL. See
  // `openVideoAttachment` below and the Task 14 carry-forward ruling.
  const [playingVideoUri, setPlayingVideoUri] = useState<string | null>(null);
  const [authHeaders, setAuthHeaders] = useState<Record<string, string>>({});

  // Load current user and conversations
  useEffect(() => {
    loadUserAndConversations();
  }, []);

  // Needed so <Image> can authenticate its request to the attachment
  // endpoint (it carries no cookie session on this app).
  useEffect(() => {
    getAuthHeaders()
      .then(setAuthHeaders)
      .catch((error) => console.error('Could not load auth headers:', error));
  }, []);

  async function loadUserAndConversations() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }

      setCurrentUser(user);

      // First try to get athlete info (for athlete users)
      const { data: athlete } = await supabase
        .from('athletes')
        .select('id, org_id')
        .eq('user_id', user.id)
        .single();

      if (athlete) {
        setAthleteId(athlete.id);
        setOrgId(athlete.org_id);
      } else {
        // For parent accounts, get org_id from their profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('org_id')
          .eq('id', user.id)
          .single();

        if (profile?.org_id) {
          setOrgId(profile.org_id);
        }
      }

      await fetchConversations(user.id);
    } catch (error) {
      console.error('Error loading user:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchConversations(userId: string) {
    try {
      // Fetch conversations where user is a participant
      const { data: participations, error: partError } = await supabase
        .from('conversation_participants')
        .select('conversation_id, last_read_at')
        .eq('user_id', userId)
        .eq('is_archived', false);

      if (partError) throw partError;
      if (!participations || participations.length === 0) {
        setConversations([]);
        return;
      }

      const conversationIds = participations.map(p => p.conversation_id);
      const lastReadMap = new Map(participations.map(p => [p.conversation_id, p.last_read_at]));

      // Fetch conversations with participants
      const { data: convs, error: convError } = await supabase
        .from('conversations')
        .select(`
          id,
          type,
          title,
          updated_at,
          participants:conversation_participants (
            user_id,
            profiles:user_id (
              id,
              first_name,
              last_name,
              email,
              avatar_url
            )
          )
        `)
        .in('id', conversationIds)
        .order('updated_at', { ascending: false });

      if (convError) throw convError;

      // Derive last-message + unread for ALL conversations in 2 batched queries
      // instead of 2 per conversation (was an N+1: 20 conversations = 40 round-trips
      // on every open). Query 1 pulls lightweight message metadata (no content) for
      // every conversation; Query 2 pulls content only for each conversation's latest.
      const { data: msgMeta } = await supabase
        .from('messages')
        .select('id, conversation_id, created_at, sender_id')
        .in('conversation_id', conversationIds)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

      const lastMsgByConv = new Map<string, { id: string; created_at: string; sender_id: string }>();
      const unreadByConv = new Map<string, number>();
      for (const m of msgMeta || []) {
        // Rows are newest-first, so the first row seen per conversation is its latest.
        if (!lastMsgByConv.has(m.conversation_id)) {
          lastMsgByConv.set(m.conversation_id, { id: m.id, created_at: m.created_at, sender_id: m.sender_id });
        }
        // Unread = messages from others newer than this user's last_read_at
        // (all of others' messages when never read) — same semantics as before.
        if (m.sender_id !== userId) {
          const lastRead = lastReadMap.get(m.conversation_id);
          if (!lastRead || new Date(m.created_at) > new Date(lastRead)) {
            unreadByConv.set(m.conversation_id, (unreadByConv.get(m.conversation_id) || 0) + 1);
          }
        }
      }

      // Content for just the latest message of each conversation.
      const lastMsgIds = Array.from(lastMsgByConv.values()).map(v => v.id);
      const contentById = new Map<string, string>();
      if (lastMsgIds.length > 0) {
        const { data: lastMsgs } = await supabase
          .from('messages')
          .select('id, content')
          .in('id', lastMsgIds);
        for (const lm of lastMsgs || []) contentById.set(lm.id, lm.content);
      }

      const conversationsWithMessages = (convs || []).map((conv) => {
        const last = lastMsgByConv.get(conv.id);
        return {
          ...conv,
          last_message: last
            ? { content: contentById.get(last.id) || '', created_at: last.created_at, sender_id: last.sender_id }
            : undefined,
          unread_count: unreadByConv.get(conv.id) || 0,
        };
      });

      setConversations(conversationsWithMessages);
    } catch (error) {
      console.error('Error fetching conversations:', error);
    }
  }

  async function fetchMessages(conversationId: string) {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          id,
          content,
          sender_id,
          created_at,
          attachments,
          is_system_message,
          system_message_type,
          sender:sender_id (
            id,
            first_name,
            last_name,
            email,
            avatar_url
          )
        `)
        .eq('conversation_id', conversationId)
        .eq('is_deleted', false)
        // Bound to the most recent 100 (newest-first, then reversed for display)
        // instead of loading an entire long thread. TODO: add load-older pagination.
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setMessages((data || []).reverse());

      // Scroll to bottom after messages load
      setTimeout(() => {
        messagesEndRef.current?.scrollToEnd({ animated: false });
      }, 100);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  }

  async function selectConversation(conversation: Conversation) {
    setSelectedConversation(conversation);
    setMessages([]);
    await fetchMessages(conversation.id);
    await markConversationAsRead(conversation.id);
  }

  async function markConversationAsRead(conversationId: string) {
    try {
      await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', currentUser?.id);

      // Update local state
      setConversations(prev =>
        prev.map(c =>
          c.id === conversationId ? { ...c, unread_count: 0 } : c
        )
      );
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  }

  // Setup realtime subscription for messages
  // A cached upload belongs to one conversation's storage path; switching
  // conversations invalidates it regardless of whether the attachment picker
  // state also gets cleared.
  useEffect(() => {
    uploadedAttachmentsCacheRef.current = {};
  }, [selectedConversation?.id]);

  useEffect(() => {
    if (!currentUser || !selectedConversation) return;

    const channel = supabase
      .channel(`conversation:${selectedConversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${selectedConversation.id}`,
        },
        async (payload) => {
          // Fetch full message with sender details
          const { data: newMessage } = await supabase
            .from('messages')
            .select(`
              id,
              content,
              sender_id,
              created_at,
              attachments,
              is_system_message,
              system_message_type,
              sender:sender_id (
                id,
                first_name,
                last_name,
                email,
                avatar_url
              )
            `)
            .eq('id', payload.new.id)
            .single();

          if (newMessage) {
            setMessages(prev => {
              const exists = prev.some(m => m.id === newMessage.id);
              if (exists) return prev;
              return [...prev, newMessage as Message];
            });

            // Mark as read if from another user
            if (newMessage.sender_id !== currentUser.id) {
              markConversationAsRead(selectedConversation.id);
            }

            // Scroll to bottom
            setTimeout(() => {
              messagesEndRef.current?.scrollToEnd({ animated: true });
            }, 100);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser, selectedConversation]);

  // Setup realtime subscription for new conversations
  useEffect(() => {
    if (!currentUser) return;

    const channel = supabase
      .channel('new-conversations')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_participants',
          filter: `user_id=eq.${currentUser.id}`,
        },
        async () => {
          // Refresh conversations list
          await fetchConversations(currentUser.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser]);

  async function sendMessage() {
    if (!selectedConversation || (!newMessage.trim() && attachments.length === 0)) return;

    setSending(true);
    setUploading(attachments.length > 0);
    const messageContent = newMessage.trim();
    const currentAttachments = [...attachments];
    setNewMessage('');
    setAttachments([]);
    setUploadErrors({});

    try {
      // Upload attachments sequentially (not Promise.all): two concurrent
      // video uploads on gym LTE starve each other and make the progress bar
      // meaningless. Each file streams from disk straight to its signed URL
      // via lib/messagesApi.ts — no fetch(uri).blob()/arrayBuffer() — so a
      // video-sized file doesn't get materialized in the JS heap.
      const uploadedAttachments: OutgoingAttachment[] = [];
      for (const attachment of currentAttachments) {
        // Reuse a prior successful upload on retry rather than re-uploading:
        // signUpload mints a fresh storage path every call, so redoing an
        // already-succeeded upload would leave the first object orphaned.
        const cached = uploadedAttachmentsCacheRef.current[attachment.uri];
        if (cached) {
          uploadedAttachments.push(cached);
          continue;
        }

        const isVideo = (attachment.type || '').startsWith('video/');
        const onProgress = (pct: number) =>
          setUploadProgress((p) => ({ ...p, [attachment.uri]: pct }));

        try {
          let uploaded: OutgoingAttachment;
          if (isVideo) {
            setPreparingVideo(true);
            try {
              uploaded = await uploadVideoAttachment(
                selectedConversation.id,
                { uri: attachment.uri, name: attachment.name, mimeType: 'video/mp4', size: attachment.size ?? 0 },
                attachment.duration,
                onProgress
              );
            } finally {
              setPreparingVideo(false);
            }
          } else {
            const prepared = await prepareForUpload(attachment);
            uploaded = await uploadAttachment(selectedConversation.id, prepared, onProgress);
          }
          uploadedAttachmentsCacheRef.current[attachment.uri] = uploaded;
          uploadedAttachments.push(uploaded);
        } catch (uploadError) {
          console.error('Error uploading attachment:', uploadError);
          // VideoTooLongError/VideoTooLargeError carry a message written for
          // a user to read directly — surface it as-is rather than a generic
          // "Upload failed".
          const isVideoLimitError =
            uploadError instanceof VideoTooLongError || uploadError instanceof VideoTooLargeError;
          setUploadErrors((e) => ({
            ...e,
            [attachment.uri]:
              isVideoLimitError || (uploadError instanceof Error && uploadError.message)
                ? (uploadError as Error).message
                : 'Upload failed',
          }));
          // Don't leave a stale progress bar from this failed attempt sitting
          // at whatever percentage it reached.
          setUploadProgress((p) => {
            const next = { ...p };
            delete next[attachment.uri];
            return next;
          });
          throw uploadError;
        }
      }

      // All sends go through the API — including attachment-only sends,
      // which the server now accepts — so email/push/in-app notifications
      // fire. The API route owns the conversation's updated_at bump.
      const data = await sendMessageApi(selectedConversation.id, messageContent, uploadedAttachments);

      // The send succeeded, so every attachment in this batch is now
      // durably referenced by the message — nothing left to reuse on retry.
      for (const attachment of currentAttachments) {
        delete uploadedAttachmentsCacheRef.current[attachment.uri];
      }

      // Add message to local state
      if (data) {
        setMessages(prev => {
          const exists = prev.some(m => m.id === data.id);
          if (exists) return prev;
          return [...prev, data as unknown as Message];
        });
      }

      // Refresh conversations to update last message
      await fetchConversations(currentUser.id);

      // Scroll to bottom
      setTimeout(() => {
        messagesEndRef.current?.scrollToEnd({ animated: true });
      }, 100);

      setUploadProgress({});
    } catch (error) {
      console.error('Error sending message:', error);
      setNewMessage(messageContent);
      // Put the attachments back so the user can retry without re-picking,
      // whether the failure was an upload or the send call itself.
      setAttachments(currentAttachments);
      // Surface the real error (expired session, rejected mime, locked
      // conversation, network drop, ...) instead of one indistinguishable
      // generic message — this is the only diagnostic a device tester gets.
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to send message. Please try again.';
      Alert.alert('Error', message);
    } finally {
      setSending(false);
      setUploading(false);
    }
  }

  async function deleteMessage(messageId: string) {
    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase
                .from('messages')
                .update({ is_deleted: true })
                .eq('id', messageId);

              setMessages(prev => prev.filter(m => m.id !== messageId));
              await fetchConversations(currentUser.id);
            } catch (error) {
              console.error('Error deleting message:', error);
              Alert.alert('Error', 'Failed to delete message.');
            }
          },
        },
      ]
    );
  }

  async function deleteConversation(conversationId: string) {
    Alert.alert(
      'Delete Conversation',
      'Are you sure you want to delete this conversation?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // For athletes, archive the conversation
              await supabase
                .from('conversation_participants')
                .update({ is_archived: true })
                .eq('conversation_id', conversationId)
                .eq('user_id', currentUser.id);

              setConversations(prev => prev.filter(c => c.id !== conversationId));
              if (selectedConversation?.id === conversationId) {
                setSelectedConversation(null);
                setMessages([]);
              }
            } catch (error) {
              console.error('Error deleting conversation:', error);
              Alert.alert('Error', 'Failed to delete conversation.');
            }
          },
        },
      ]
    );
  }

  async function fetchAvailableUsers() {
    if (!orgId) return;

    setLoadingUsers(true);
    try {
      const myId = currentUser?.id;
      // Read the current user's role so we can scope who they may start a
      // conversation with. (profiles is readable by any authed user.)
      const { data: currentProfile } = await supabase
        .from('profiles')
        .select('org_id, app_role')
        .eq('id', myId)
        .single();

      const myOrgId = currentProfile?.org_id;
      if (!myOrgId) {
        setAvailableUsers([]);
        return;
      }

      const role = currentProfile?.app_role;
      const isAdmin = role === 'admin' || role === 'super_admin' || role === 'god_mode';
      const isCoach = role === 'coach';
      const isAthlete = role === 'athlete';

      const profileCols = 'id, first_name, last_name, email, avatar_url, app_role';
      const STAFF_ROLES = ['admin', 'super_admin', 'coach', 'god_mode'];
      let recipients: Profile[] = [];

      if (isAdmin) {
        // Admins can message anyone in their org (all staff + all athletes).
        const { data } = await supabase
          .from('profiles')
          .select(profileCols)
          .eq('org_id', myOrgId)
          .neq('id', myId);
        recipients = (data as Profile[]) || [];
      } else if (isCoach) {
        // Coaches can message all staff plus the athletes linked to them
        // via coach_athletes (mirrors the ArmCare athlete scoping).
        const [{ data: staff }, { data: links }] = await Promise.all([
          supabase
            .from('profiles')
            .select(profileCols)
            .eq('org_id', myOrgId)
            .neq('id', myId)
            .in('app_role', STAFF_ROLES),
          supabase
            .from('coach_athletes')
            .select('athlete:athlete_id ( user_id )')
            .eq('coach_id', myId),
        ]);

        const athleteUserIds = (links || [])
          .map((l: any) => l.athlete?.user_id)
          .filter((id: string | null | undefined): id is string => !!id);

        let athleteProfiles: Profile[] = [];
        if (athleteUserIds.length > 0) {
          const { data: ap } = await supabase
            .from('profiles')
            .select(profileCols)
            .in('id', athleteUserIds)
            .neq('id', myId);
          athleteProfiles = (ap as Profile[]) || [];
        }

        // Merge + dedupe (a coach who is also linked shouldn't appear twice).
        const byId = new Map<string, Profile>();
        [...((staff as Profile[]) || []), ...athleteProfiles].forEach(p => byId.set(p.id, p));
        recipients = Array.from(byId.values());
      } else if (isAthlete) {
        // Athletes can message their assigned coach(es) via coach_athletes,
        // plus admins in their org (mirrors /api/messaging/available-users).
        const { data: athleteRecord } = await supabase
          .from('athletes')
          .select('id')
          .eq('user_id', myId)
          .single();

        let coachUserIds: string[] = [];
        if (athleteRecord?.id) {
          // coach_athletes.coach_id is already the coach's profile id.
          const { data: assignedCoaches } = await supabase
            .from('coach_athletes')
            .select('coach_id')
            .eq('athlete_id', athleteRecord.id);
          coachUserIds = (assignedCoaches || [])
            .map((c: any) => c.coach_id)
            .filter((id: string | null | undefined): id is string => !!id);
        }

        const [{ data: admins }, coachRes] = await Promise.all([
          supabase
            .from('profiles')
            .select(profileCols)
            .eq('org_id', myOrgId)
            .neq('id', myId)
            .in('app_role', ['admin', 'super_admin']),
          coachUserIds.length > 0
            ? supabase
                .from('profiles')
                .select(profileCols)
                .eq('org_id', myOrgId)
                .neq('id', myId)
                .in('id', coachUserIds)
            : Promise.resolve({ data: [] as Profile[] }),
        ]);

        // Merge + dedupe (a coach who is also an admin shouldn't appear twice).
        const byId = new Map<string, Profile>();
        [...((admins as Profile[]) || []), ...(((coachRes as any).data as Profile[]) || [])]
          .forEach(p => byId.set(p.id, p));
        recipients = Array.from(byId.values());
      } else {
        // Parents (and any other role) can only message admins.
        const { data } = await supabase
          .from('profiles')
          .select(profileCols)
          .eq('org_id', myOrgId)
          .neq('id', myId)
          .in('app_role', ['admin', 'super_admin']);
        recipients = (data as Profile[]) || [];
      }

      recipients.sort((a, b) => (a.first_name || '').localeCompare(b.first_name || ''));
      setAvailableUsers(recipients);
    } catch (error) {
      console.error('Error fetching available users:', error);
      setAvailableUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function createNewConversation() {
    if (!selectedUserId || !orgId) return;

    setCreatingConversation(true);
    try {
      // Get or create direct conversation
      const { data: conversationId, error: rpcError } = await supabase
        .rpc('get_or_create_direct_conversation', {
          p_user1_id: currentUser.id,
          p_user2_id: selectedUserId,
          p_org_id: orgId,
        });

      if (rpcError) throw rpcError;

      if (conversationId) {
        // Close dialog first
        setShowNewConversationDialog(false);
        setSelectedUserId(null);
        setUserSearchQuery('');

        // Refresh conversations list
        await fetchConversations(currentUser.id);

        // Fetch the full conversation data to select it
        const { data: convData } = await supabase
          .from('conversations')
          .select(`
            id,
            type,
            title,
            updated_at,
            participants:conversation_participants (
              user_id,
              profiles:user_id (
                id,
                first_name,
                last_name,
                email,
                avatar_url
              )
            )
          `)
          .eq('id', conversationId)
          .single();

        if (convData) {
          // Auto-select the conversation to open the chat
          const fullConversation: Conversation = {
            ...convData,
            unread_count: 0,
          };
          selectConversation(fullConversation);
        }
      }
    } catch (error) {
      console.error('Error creating conversation:', error);
      Alert.alert('Error', 'Failed to start conversation. Please try again.');
    } finally {
      setCreatingConversation(false);
    }
  }

  function getConversationTitle(conversation: Conversation): string {
    if (conversation.title) return conversation.title;

    if (!conversation.participants || conversation.participants.length === 0) {
      return 'Conversation';
    }

    if (conversation.type === 'direct') {
      const otherParticipant = conversation.participants.find(
        p => p.user_id !== currentUser?.id
      );
      if (otherParticipant?.profiles) {
        const { first_name, last_name, email } = otherParticipant.profiles;
        return first_name || last_name
          ? `${first_name || ''} ${last_name || ''}`.trim()
          : email;
      }
    }
    return 'Conversation';
  }

  function getInitials(profile: Profile): string {
    const first = profile?.first_name?.[0] || '';
    const last = profile?.last_name?.[0] || '';
    return (first + last).toUpperCase() || profile?.email?.[0]?.toUpperCase() || '?';
  }

  function formatTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatMessageTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // Extract YouTube video ID from URL
  function extractYouTubeVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  // Check if message content contains a YouTube URL
  function getYouTubeVideoId(content: string): string | null {
    const urlPattern = /(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)[^\s]+)/gi;
    const matches = content.match(urlPattern);
    if (matches) {
      for (const match of matches) {
        const videoId = extractYouTubeVideoId(match);
        if (videoId) return videoId;
      }
    }
    return null;
  }

  // Pick image from library
  async function pickImage() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photo library to send images.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.8,
        // Gives the native iOS trim UI, so an over-length clip can be
        // trimmed in place rather than rejected outright.
        allowsEditing: true,
        videoMaxDuration: MAX_VIDEO_DURATION_SECONDS,
      });

      if (!result.canceled && result.assets) {
        const newAttachments = result.assets.map(asset => {
          let mimeType = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
          let fileName = asset.fileName || `file_${Date.now()}`;

          if (mimeType === 'image/heic' || mimeType === 'image/heif') {
            mimeType = 'image/jpeg';
            fileName = fileName.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
          }

          return {
            uri: asset.uri,
            name: fileName,
            type: mimeType,
            size: asset.fileSize,
            duration: asset.duration ?? undefined,
          };
        });
        setAttachments(prev => [...prev, ...newAttachments]);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to open photo library. Please try again.');
    }
  }

  // Take photo with camera
  async function takePhoto() {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow camera access to take photos.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setAttachments(prev => [...prev, {
          uri: asset.uri,
          name: asset.fileName || `photo_${Date.now()}.jpg`,
          type: asset.mimeType || 'image/jpeg',
          size: asset.fileSize,
        }]);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to open camera. Please try again.');
    }
  }

  // Record video with camera
  async function recordVideo() {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow camera access to record video.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        videoMaxDuration: MAX_VIDEO_DURATION_SECONDS,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setAttachments(prev => [...prev, {
          uri: asset.uri,
          name: asset.fileName || `video_${Date.now()}.mp4`,
          type: 'video/mp4',
          size: asset.fileSize,
          duration: asset.duration ?? undefined,
        }]);
      }
    } catch (error) {
      console.error('Error recording video:', error);
      Alert.alert('Error', 'Failed to open the camera. Please try again.');
    }
  }

  // Show attachment menu - toggle the popup
  function showAttachmentOptions() {
    setShowAttachmentMenu(!showAttachmentMenu);
  }

  // Handle attachment option selection
  function handleAttachmentOption(option: 'photo' | 'camera' | 'video' | 'document') {
    setShowAttachmentMenu(false);
    // Small delay to ensure menu closes before picker opens
    setTimeout(() => {
      if (option === 'photo') {
        pickImage();
      } else if (option === 'camera') {
        takePhoto();
      } else if (option === 'video') {
        recordVideo();
      } else if (option === 'document') {
        pickDocument();
      }
    }, 100);
  }

  // Pick document
  async function pickDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
      });

      if (!result.canceled && result.assets) {
        const newAttachments = result.assets.map(asset => ({
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || 'application/octet-stream',
          size: asset.size,
        }));
        setAttachments(prev => [...prev, ...newAttachments]);
      }
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document. Please try again.');
    }
  }

  // Remove attachment
  function removeAttachment(index: number) {
    setAttachments(prev => {
      const removed = prev[index];
      if (removed) {
        delete uploadedAttachmentsCacheRef.current[removed.uri];
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  // Opens a video attachment in the fullscreen player. Per the Task 14
  // carry-forward ruling, expo-video's player is not handed the
  // `/api/messages/attachments/...` endpoint URL directly — it has no cookie
  // session and isn't trusted to carry an Authorization header through that
  // endpoint's 302 redirect to Supabase Storage. A stored attachment is
  // resolved to its signed URL first, here, with the header attached to
  // THIS request; a legacy pre-migration attachment's public file_url needs
  // no resolution and is used as-is.
  async function openVideoAttachment(attachment: { storage_path?: string; file_url?: string }) {
    if (attachment.storage_path) {
      try {
        const resolved = await resolveAttachmentDirectUrl(attachment.storage_path);
        setPlayingVideoUri(resolved);
      } catch (error) {
        console.error('Could not resolve video URL:', error);
        Alert.alert('Error', 'Could not load this video. Please try again.');
      }
    } else if (attachment.file_url) {
      setPlayingVideoUri(attachment.file_url);
    }
  }

  // Prepares a picked file for upload: converts HEIC/HEIF to JPEG (Supabase
  // Storage and most viewers don't render HEIC) and guarantees `size` is
  // populated, since signUpload rejects a zero/missing size_bytes. The actual
  // upload (signing + streaming from disk) lives in lib/messagesApi.ts.
  async function prepareForUpload(attachment: {
    uri: string;
    name: string;
    type: string;
    size?: number;
  }): Promise<LocalFile> {
    let mimeType = attachment.type;
    let fileName = attachment.name;
    let fileUri = attachment.uri;

    // Convert HEIC/HEIF images to JPEG using ImageManipulator
    if (mimeType === 'image/heic' || mimeType === 'image/heif' || fileName.toLowerCase().endsWith('.heic') || fileName.toLowerCase().endsWith('.heif')) {
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          attachment.uri,
          [], // No transformations, just convert format
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
        );
        fileUri = manipulated.uri;
        mimeType = 'image/jpeg';
        fileName = fileName.replace(/\.(heic|heif)$/i, '.jpg');
      } catch (manipError) {
        console.warn('Failed to convert HEIC, trying original:', manipError);
        // Fall back to JPEG mime type anyway
        mimeType = 'image/jpeg';
        fileName = fileName.replace(/\.(heic|heif)$/i, '.jpg');
      }
    }

    let size = attachment.size || 0;
    if (!size) {
      // This SDK's InfoOptions has no `size` flag to opt into — size comes
      // back whenever the file exists, with no extra option needed.
      const info = await FileSystem.getInfoAsync(fileUri);
      size = info.exists ? info.size ?? 0 : 0;
    }

    if (!size || !Number.isFinite(size)) {
      throw new Error(`Could not determine file size for ${fileName}`);
    }

    return { uri: fileUri, name: fileName, mimeType, size };
  }

  // Format file size
  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  const filteredConversations = conversations.filter(conv =>
    getConversationTitle(conv).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredUsers = availableUsers.filter(user => {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim().toLowerCase();
    const email = user.email.toLowerCase();
    const query = userSearchQuery.toLowerCase();
    return fullName.includes(query) || email.includes(query);
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9BDDFF" />
          <Text style={styles.loadingText}>Loading messages...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Conversation List View
  if (!selectedConversation) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <Text style={styles.backButtonText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Messages</Text>
            <TouchableOpacity
              onPress={() => {
                setShowNewConversationDialog(true);
                fetchAvailableUsers();
              }}
              style={styles.newButton}
            >
              <LinearGradient
                colors={['#9BDDFF', '#7BC5F0']}
                style={styles.newButtonGradient}
              >
                <Text style={styles.newButtonText}>+ New</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search conversations..."
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        {/* Conversations List */}
        {filteredConversations.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>💬</Text>
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptySubtitle}>Your coach will message you here</Text>
          </View>
        ) : (
          <FlatList
            data={filteredConversations}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.conversationsList}
            renderItem={({ item: conversation }) => {
              const otherParticipant = conversation.participants.find(
                p => p.user_id !== currentUser?.id
              );
              const isNotifications = isNotificationsConversation(conversation);

              return (
                <TouchableOpacity
                  style={[
                    styles.conversationItem,
                    selectedConversation?.id === conversation.id && styles.conversationItemSelected,
                  ]}
                  onPress={() => selectConversation(conversation)}
                  onLongPress={() => !isNotifications && deleteConversation(conversation.id)}
                >
                  {/* Avatar */}
                  {isNotifications ? (
                    <LinearGradient
                      colors={['#A855F7', '#6366F1']}
                      style={styles.avatar}
                    >
                      <Text style={styles.avatarEmoji}>🤖</Text>
                    </LinearGradient>
                  ) : (
                    <LinearGradient
                      colors={['#9BDDFF', '#7BC5F0']}
                      style={styles.avatar}
                    >
                      <Text style={styles.avatarText}>
                        {otherParticipant?.profiles ? getInitials(otherParticipant.profiles) : '?'}
                      </Text>
                    </LinearGradient>
                  )}

                  {/* Content */}
                  <View style={styles.conversationContent}>
                    <View style={styles.conversationHeader}>
                      <Text style={[
                        styles.conversationName,
                        isNotifications && styles.conversationNamePurple
                      ]} numberOfLines={1}>
                        {getConversationTitle(conversation)}
                      </Text>
                      {conversation.last_message && (
                        <Text style={styles.conversationTime}>
                          {formatTime(conversation.last_message.created_at)}
                        </Text>
                      )}
                    </View>

                    {conversation.last_message && (
                      <Text style={styles.conversationPreview} numberOfLines={1}>
                        {conversation.last_message.sender_id === currentUser?.id && 'You: '}
                        {conversation.last_message.content}
                      </Text>
                    )}
                  </View>

                  {/* Unread Badge */}
                  {conversation.unread_count > 0 && (
                    <View style={[
                      styles.unreadBadge,
                      isNotifications && styles.unreadBadgePurple
                    ]}>
                      <Text style={styles.unreadBadgeText}>
                        {conversation.unread_count}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        )}

        {/* New Conversation Modal */}
        <Modal
          visible={showNewConversationDialog}
          animationType="slide"
          transparent
          onRequestClose={() => setShowNewConversationDialog(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>New Message</Text>
              <Text style={styles.modalSubtitle}>Select a person to start a conversation</Text>

              {/* User Search */}
              <View style={styles.modalSearchContainer}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  style={styles.modalSearchInput}
                  placeholder="Search by name or email..."
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={userSearchQuery}
                  onChangeText={setUserSearchQuery}
                />
              </View>

              {/* User List */}
              <ScrollView style={styles.userList}>
                {loadingUsers ? (
                  <View style={styles.userListLoading}>
                    <ActivityIndicator size="small" color="#9BDDFF" />
                  </View>
                ) : filteredUsers.length === 0 ? (
                  <Text style={styles.userListEmpty}>
                    {userSearchQuery ? 'No users found' : 'No one available to message'}
                  </Text>
                ) : (
                  filteredUsers.map(user => {
                    // Determine role label
                    const getRoleLabel = (role?: string) => {
                      if (role === 'admin' || role === 'super_admin') return 'Admin';
                      if (role === 'coach') return 'Coach';
                      return null;
                    };
                    const roleLabel = getRoleLabel(user.app_role);
                    const isAdmin = user.app_role === 'admin' || user.app_role === 'super_admin';

                    return (
                      <TouchableOpacity
                        key={user.id}
                        style={[
                          styles.userItem,
                          selectedUserId === user.id && styles.userItemSelected,
                        ]}
                        onPress={() => setSelectedUserId(user.id)}
                      >
                        <LinearGradient
                          colors={isAdmin ? ['#A855F7', '#9333EA'] : ['#9BDDFF', '#7BC5F0']}
                          style={styles.userAvatar}
                        >
                          <Text style={styles.userAvatarText}>{getInitials(user)}</Text>
                        </LinearGradient>
                        <View style={styles.userInfo}>
                          <View style={styles.userNameRow}>
                            <Text style={styles.userName}>
                              {user.first_name || user.last_name
                                ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                                : user.email}
                            </Text>
                            {roleLabel && (
                              <View style={[
                                styles.roleBadge,
                                isAdmin ? styles.roleBadgeAdmin : styles.roleBadgeCoach
                              ]}>
                                <Text style={[
                                  styles.roleBadgeText,
                                  isAdmin ? styles.roleBadgeTextAdmin : styles.roleBadgeTextCoach
                                ]}>
                                  {roleLabel}
                                </Text>
                              </View>
                            )}
                          </View>
                          {(user.first_name || user.last_name) && (
                            <Text style={styles.userEmail}>{user.email}</Text>
                          )}
                        </View>
                        {selectedUserId === user.id && (
                          <View style={styles.selectedIndicator}>
                            <View style={styles.selectedIndicatorInner} />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>

              {/* Actions */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={() => {
                    setShowNewConversationDialog(false);
                    setSelectedUserId(null);
                    setUserSearchQuery('');
                  }}
                >
                  <Text style={styles.modalCancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalStartButton,
                    (!selectedUserId || creatingConversation) && styles.modalStartButtonDisabled,
                  ]}
                  onPress={createNewConversation}
                  disabled={!selectedUserId || creatingConversation}
                >
                  <LinearGradient
                    colors={['#9BDDFF', '#7BC5F0']}
                    style={styles.modalStartButtonGradient}
                  >
                    <Text style={styles.modalStartButtonText}>
                      {creatingConversation ? 'Starting...' : 'Start Conversation'}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // Conversation View
  const isNotificationsChat = selectedConversation ? isNotificationsConversation(selectedConversation) : false;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Chat Header */}
        <View style={[
          styles.chatHeader,
          isNotificationsChat && styles.chatHeaderPurple
        ]}>
          <TouchableOpacity
            onPress={() => {
              setSelectedConversation(null);
              setMessages([]);
            }}
            style={styles.chatBackButton}
          >
            <Text style={[
              styles.chatBackButtonText,
              isNotificationsChat && styles.chatBackButtonTextPurple
            ]}>‹</Text>
          </TouchableOpacity>

          <View style={styles.chatHeaderInfo}>
            {isNotificationsChat && (
              <View style={styles.chatHeaderAvatarContainer}>
                <LinearGradient
                  colors={['#A855F7', '#6366F1']}
                  style={styles.chatHeaderAvatar}
                >
                  <Text style={styles.chatHeaderAvatarEmoji}>🤖</Text>
                </LinearGradient>
              </View>
            )}
            <View>
              <Text style={[
                styles.chatHeaderTitle,
                isNotificationsChat && styles.chatHeaderTitlePurple
              ]} numberOfLines={1}>
                {getConversationTitle(selectedConversation)}
              </Text>
              <Text style={styles.chatHeaderSubtitle}>
                {isNotificationsChat
                  ? 'Automated notifications from the system'
                  : selectedConversation.type === 'direct' ? 'Direct Message' : 'Group'}
              </Text>
            </View>
          </View>

          {!isNotificationsChat && (
            <TouchableOpacity
              onPress={() => deleteConversation(selectedConversation.id)}
              style={styles.chatDeleteButton}
            >
              <Text style={styles.chatDeleteButtonText}>🗑️</Text>
            </TouchableOpacity>
          )}
          {isNotificationsChat && <View style={styles.chatDeleteButton} />}
        </View>

        {/* Messages */}
        <ScrollView
          ref={messagesEndRef}
          style={styles.messagesContainer}
          contentContainerStyle={styles.messagesContent}
          onContentSizeChange={() => messagesEndRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.map((message) => {
            const isOwn = message.sender_id === currentUser?.id;
            const isSystemMessage = message.is_system_message === true;
            const youtubeVideoId = getYouTubeVideoId(message.content);

            // System message rendering
            if (isSystemMessage) {
              return (
                <View key={message.id} style={styles.messageRow}>
                  <LinearGradient
                    colors={['#A855F7', '#6366F1']}
                    style={styles.messageAvatar}
                  >
                    <Text style={styles.systemMessageAvatarEmoji}>🤖</Text>
                  </LinearGradient>

                  <View style={styles.systemMessageBubble}>
                    <Text style={styles.systemMessageSender}>Automation</Text>
                    <Text style={styles.systemMessageText}>{message.content}</Text>
                    <Text style={styles.systemMessageTime}>
                      {formatMessageTime(message.created_at)}
                    </Text>
                  </View>
                </View>
              );
            }

            return (
              <TouchableOpacity
                key={message.id}
                style={[styles.messageRow, isOwn && styles.messageRowOwn]}
                onLongPress={() => isOwn && deleteMessage(message.id)}
                activeOpacity={0.8}
              >
                {!isOwn && (
                  <LinearGradient
                    colors={['#9BDDFF', '#7BC5F0']}
                    style={styles.messageAvatar}
                  >
                    <Text style={styles.messageAvatarText}>
                      {message.sender ? getInitials(message.sender) : '?'}
                    </Text>
                  </LinearGradient>
                )}

                <View style={[styles.messageBubble, isOwn ? styles.messageBubbleOwn : styles.messageBubbleOther]}>
                  {isOwn ? (
                    <LinearGradient
                      colors={['#9BDDFF', '#7BC5F0']}
                      style={styles.messageBubbleGradient}
                    >
                      {/* Attachments for own messages */}
                      {message.attachments && message.attachments.length > 0 && (
                        <View style={styles.attachmentsContainer}>
                          {message.attachments.map((attachment, idx) => (
                            <TouchableOpacity
                              key={idx}
                              onPress={() => {
                                if (attachment.file_type === 'image') {
                                  setViewingImage(
                                    attachment.storage_path
                                      ? attachmentUrl(attachment.storage_path)
                                      : attachment.file_url ?? null
                                  );
                                } else if (attachment.file_type !== 'video') {
                                  Linking.openURL(attachment.file_url ?? '');
                                }
                                // video: no-op — VideoAttachmentPreview handles its own press.
                              }}
                            >
                              {attachment.file_type === 'image' ? (
                                <Image
                                  source={{
                                    uri: attachment.storage_path
                                      ? attachmentUrl(attachment.storage_path)
                                      : attachment.file_url ?? '',
                                    headers: authHeaders,
                                  }}
                                  style={styles.attachmentImage}
                                  resizeMode="cover"
                                />
                              ) : attachment.file_type === 'video' ? (
                                (attachment.mime_type || '').includes('youtube') ||
                                (attachment.mime_type || '').includes('vimeo') ? (
                                  <LinkEmbed url={attachment.file_url ?? ''} />
                                ) : (
                                  <VideoAttachmentPreview
                                    attachment={attachment}
                                    authHeaders={authHeaders}
                                    onPress={() => openVideoAttachment(attachment)}
                                  />
                                )
                              ) : (
                                <View style={styles.fileAttachment}>
                                  <Text style={styles.fileIcon}>📎</Text>
                                  <View style={styles.fileInfo}>
                                    <Text style={styles.attachmentFileName} numberOfLines={1}>
                                      {attachment.file_name}
                                    </Text>
                                    {attachment.file_size > 0 && (
                                      <Text style={styles.attachmentFileSize}>
                                        {formatFileSize(attachment.file_size)}
                                      </Text>
                                    )}
                                  </View>
                                </View>
                              )}
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}

                      {/* YouTube Embed for own messages */}
                      {youtubeVideoId && (
                        <View style={styles.youtubeContainer}>
                          <YoutubePlayer
                            height={160}
                            width={SCREEN_WIDTH * 0.65}
                            videoId={youtubeVideoId}
                            play={false}
                          />
                        </View>
                      )}

                      {message.content && (
                        <Text style={[styles.messageText, styles.messageTextOwn]}>
                          {message.content}
                        </Text>
                      )}
                      <Text style={[styles.messageTime, styles.messageTimeOwn]}>
                        {formatMessageTime(message.created_at)}
                      </Text>
                    </LinearGradient>
                  ) : (
                    <>
                      {/* Attachments for other messages */}
                      {message.attachments && message.attachments.length > 0 && (
                        <View style={styles.attachmentsContainer}>
                          {message.attachments.map((attachment, idx) => (
                            <TouchableOpacity
                              key={idx}
                              onPress={() => {
                                if (attachment.file_type === 'image') {
                                  setViewingImage(
                                    attachment.storage_path
                                      ? attachmentUrl(attachment.storage_path)
                                      : attachment.file_url ?? null
                                  );
                                } else if (attachment.file_type !== 'video') {
                                  Linking.openURL(attachment.file_url ?? '');
                                }
                                // video: no-op — VideoAttachmentPreview handles its own press.
                              }}
                            >
                              {attachment.file_type === 'image' ? (
                                <Image
                                  source={{
                                    uri: attachment.storage_path
                                      ? attachmentUrl(attachment.storage_path)
                                      : attachment.file_url ?? '',
                                    headers: authHeaders,
                                  }}
                                  style={styles.attachmentImage}
                                  resizeMode="cover"
                                />
                              ) : attachment.file_type === 'video' ? (
                                (attachment.mime_type || '').includes('youtube') ||
                                (attachment.mime_type || '').includes('vimeo') ? (
                                  <LinkEmbed url={attachment.file_url ?? ''} />
                                ) : (
                                  <VideoAttachmentPreview
                                    attachment={attachment}
                                    authHeaders={authHeaders}
                                    onPress={() => openVideoAttachment(attachment)}
                                  />
                                )
                              ) : (
                                <View style={styles.fileAttachmentOther}>
                                  <Text style={styles.fileIcon}>📎</Text>
                                  <View style={styles.fileInfo}>
                                    <Text style={styles.attachmentFileNameOther} numberOfLines={1}>
                                      {attachment.file_name}
                                    </Text>
                                    {attachment.file_size > 0 && (
                                      <Text style={styles.attachmentFileSizeOther}>
                                        {formatFileSize(attachment.file_size)}
                                      </Text>
                                    )}
                                  </View>
                                </View>
                              )}
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}

                      {/* YouTube Embed for other messages */}
                      {youtubeVideoId && (
                        <View style={styles.youtubeContainer}>
                          <YoutubePlayer
                            height={160}
                            width={SCREEN_WIDTH * 0.65}
                            videoId={youtubeVideoId}
                            play={false}
                          />
                        </View>
                      )}

                      {message.content && (
                        <Text style={styles.messageText}>{message.content}</Text>
                      )}
                      <Text style={styles.messageTime}>
                        {formatMessageTime(message.created_at)}
                      </Text>
                    </>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Compression runs for real seconds; without this the composer looks
            frozen/crashed while it's happening. */}
        {!isNotificationsChat && preparingVideo && (
          <View style={styles.preparingVideoContainer}>
            <ActivityIndicator size="small" color="rgba(255,255,255,0.7)" />
            <Text style={styles.preparingVideoText}>Preparing video…</Text>
          </View>
        )}

        {/* Attachment Preview - only show if not notifications channel */}
        {!isNotificationsChat && attachments.length > 0 && (
          <View style={styles.attachmentPreviewContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {attachments.map((attachment, index) => (
                <View key={index} style={styles.attachmentPreviewItem}>
                  {attachment.type.startsWith('image/') ? (
                    <Image
                      source={{ uri: attachment.uri }}
                      style={styles.attachmentPreviewImage}
                      resizeMode="cover"
                    />
                  ) : attachment.type.startsWith('video/') ? (
                    <View style={styles.attachmentPreviewFile}>
                      <Text style={styles.attachmentPreviewIcon}>🎬</Text>
                    </View>
                  ) : (
                    <View style={styles.attachmentPreviewFile}>
                      <Text style={styles.attachmentPreviewIcon}>📎</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.removeAttachmentButton}
                    onPress={() => removeAttachment(index)}
                  >
                    <Text style={styles.removeAttachmentText}>×</Text>
                  </TouchableOpacity>
                  <Text style={styles.attachmentPreviewName} numberOfLines={1}>
                    {attachment.name}
                  </Text>
                  {uploadProgress[attachment.uri] !== undefined && uploadProgress[attachment.uri] < 100 && (
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${uploadProgress[attachment.uri]}%` }]} />
                    </View>
                  )}
                  {uploadErrors[attachment.uri] && (
                    <Text style={styles.uploadError} numberOfLines={2}>
                      {uploadErrors[attachment.uri]}
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Message Input - show read-only message for notifications channel */}
        {isNotificationsChat ? (
          <View style={styles.notificationsInputContainer}>
            <Text style={styles.notificationsInputText}>
              This is an automated notification channel. You cannot reply to these messages.
            </Text>
          </View>
        ) : (
          <View style={styles.inputContainer}>
            {/* Attachment Button */}
            <TouchableOpacity
              style={styles.attachmentButton}
              onPress={showAttachmentOptions}
            >
              <Text style={styles.attachmentButtonText}>+</Text>
            </TouchableOpacity>

            <TextInput
              style={styles.messageInput}
              placeholder="Type a message..."
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={newMessage}
              onChangeText={setNewMessage}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!newMessage.trim() && attachments.length === 0 || sending) && styles.sendButtonDisabled,
              ]}
              onPress={sendMessage}
              disabled={(!newMessage.trim() && attachments.length === 0) || sending}
            >
              <LinearGradient
                colors={['#9BDDFF', '#7BC5F0']}
                style={styles.sendButtonGradient}
              >
                {sending || uploading ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.sendButtonText}>➤</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* Attachment Menu Popup - positioned above the + button */}
        {showAttachmentMenu && (
          <>
            {/* Backdrop to close menu when tapping outside */}
            <TouchableOpacity
              style={styles.attachmentMenuBackdrop}
              activeOpacity={1}
              onPress={() => setShowAttachmentMenu(false)}
            />
            {/* Menu popup */}
            <View style={styles.attachmentMenuPopup}>
              <TouchableOpacity
                style={styles.attachmentMenuPopupItem}
                onPress={() => handleAttachmentOption('photo')}
              >
                <Text style={styles.attachmentMenuIcon}>🖼️</Text>
                <Text style={styles.attachmentMenuText}>Photo/Video</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachmentMenuPopupItem}
                onPress={() => handleAttachmentOption('camera')}
              >
                <Text style={styles.attachmentMenuIcon}>📷</Text>
                <Text style={styles.attachmentMenuText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachmentMenuPopupItem}
                onPress={() => handleAttachmentOption('video')}
              >
                <Text style={styles.attachmentMenuIcon}>🎥</Text>
                <Text style={styles.attachmentMenuText}>Record Video</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachmentMenuPopupItem}
                onPress={() => handleAttachmentOption('document')}
              >
                <Text style={styles.attachmentMenuIcon}>📄</Text>
                <Text style={styles.attachmentMenuText}>Document</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Full Screen Image Viewer Modal */}
        <Modal
          visible={viewingImage !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setViewingImage(null)}
        >
          <TouchableOpacity
            style={styles.imageViewerOverlay}
            activeOpacity={1}
            onPress={() => setViewingImage(null)}
          >
            <View style={styles.imageViewerContainer}>
              {viewingImage && (
                <Image
                  source={{ uri: viewingImage, headers: authHeaders }}
                  style={styles.imageViewerImage}
                  resizeMode="contain"
                />
              )}
            </View>
            <TouchableOpacity
              style={styles.imageViewerCloseButton}
              onPress={() => setViewingImage(null)}
            >
              <Text style={styles.imageViewerCloseText}>×</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        <VideoPlayerModal
          uri={playingVideoUri}
          visible={!!playingVideoUri}
          onClose={() => setPlayingVideoUri(null)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backButton: {
    padding: 4,
  },
  backButtonText: {
    fontSize: 16,
    color: '#9BDDFF',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  newButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  newButtonGradient: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  newButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    color: '#FFFFFF',
    fontSize: 14,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
    opacity: 0.5,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
  },
  conversationsList: {
    padding: 8,
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  conversationItemSelected: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  conversationContent: {
    flex: 1,
    minWidth: 0,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  conversationName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    flex: 1,
    marginRight: 8,
  },
  conversationNamePurple: {
    color: '#A855F7',
  },
  avatarEmoji: {
    fontSize: 20,
  },
  conversationTime: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  conversationPreview: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
  },
  unreadBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#9BDDFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  unreadBadgePurple: {
    backgroundColor: '#A855F7',
  },
  unreadBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000',
  },
  // Chat View Styles
  keyboardAvoid: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  chatHeaderPurple: {
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    borderBottomColor: 'rgba(168, 85, 247, 0.2)',
  },
  chatBackButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatBackButtonText: {
    fontSize: 28,
    color: '#9BDDFF',
    fontWeight: '300',
  },
  chatBackButtonTextPurple: {
    color: '#A855F7',
  },
  chatHeaderInfo: {
    flex: 1,
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chatHeaderAvatarContainer: {
    marginRight: 10,
  },
  chatHeaderAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatHeaderAvatarEmoji: {
    fontSize: 18,
  },
  chatHeaderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  chatHeaderTitlePurple: {
    color: '#A855F7',
  },
  chatHeaderSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  chatDeleteButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatDeleteButtonText: {
    fontSize: 20,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 8,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-end',
  },
  messageRowOwn: {
    justifyContent: 'flex-end',
  },
  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  messageAvatarText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#000000',
  },
  // System message styles
  systemMessageAvatarEmoji: {
    fontSize: 16,
  },
  systemMessageBubble: {
    maxWidth: '75%',
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    padding: 12,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  systemMessageSender: {
    fontSize: 12,
    fontWeight: '600',
    color: '#A855F7',
    marginBottom: 4,
  },
  systemMessageText: {
    fontSize: 15,
    color: '#FFFFFF',
    lineHeight: 22,
  },
  systemMessageTime: {
    fontSize: 11,
    color: 'rgba(168, 85, 247, 0.7)',
    marginTop: 6,
  },
  messageBubble: {
    maxWidth: '75%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  messageBubbleOwn: {
    borderBottomRightRadius: 4,
  },
  messageBubbleOther: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderBottomLeftRadius: 4,
    padding: 12,
  },
  messageBubbleGradient: {
    padding: 12,
  },
  messageText: {
    fontSize: 15,
    color: '#FFFFFF',
    lineHeight: 20,
  },
  messageTextOwn: {
    color: '#000000',
  },
  messageTime: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 4,
  },
  messageTimeOwn: {
    color: 'rgba(0,0,0,0.5)',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'flex-end',
  },
  notificationsInputContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(168, 85, 247, 0.2)',
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    alignItems: 'center',
  },
  notificationsInputText: {
    fontSize: 13,
    color: 'rgba(168, 85, 247, 0.8)',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  messageInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 15,
    marginRight: 8,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonGradient: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonText: {
    fontSize: 20,
    color: '#000000',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 16,
  },
  modalSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  modalSearchInput: {
    flex: 1,
    height: 40,
    color: '#FFFFFF',
    fontSize: 14,
  },
  userList: {
    maxHeight: 300,
    marginBottom: 16,
  },
  userListLoading: {
    padding: 32,
    alignItems: 'center',
  },
  userListEmpty: {
    textAlign: 'center',
    padding: 32,
    color: 'rgba(255,255,255,0.4)',
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  userItemSelected: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userAvatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  userInfo: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  roleBadgeAdmin: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
  },
  roleBadgeCoach: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  roleBadgeTextAdmin: {
    color: '#A855F7',
  },
  roleBadgeTextCoach: {
    color: '#9BDDFF',
  },
  userEmail: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  selectedIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#9BDDFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedIndicatorInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#000000',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  modalCancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalStartButton: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  modalStartButtonDisabled: {
    opacity: 0.5,
  },
  modalStartButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalStartButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000000',
  },
  // Attachment styles
  attachmentButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  attachmentButtonText: {
    fontSize: 24,
    color: '#9BDDFF',
    fontWeight: '300',
  },
  attachmentsContainer: {
    marginBottom: 8,
  },
  attachmentImage: {
    width: SCREEN_WIDTH * 0.55,
    height: 150,
    borderRadius: 8,
    marginBottom: 4,
  },
  videoAttachment: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  videoAttachmentOther: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  videoIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  fileAttachment: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  fileAttachmentOther: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  fileIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  fileInfo: {
    flex: 1,
  },
  attachmentFileName: {
    fontSize: 13,
    color: '#000000',
    fontWeight: '500',
  },
  attachmentFileNameOther: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  attachmentFileSize: {
    fontSize: 11,
    color: 'rgba(0,0,0,0.5)',
    marginTop: 2,
  },
  attachmentFileSizeOther: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  youtubeContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 8,
  },
  preparingVideoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
  },
  preparingVideoText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
  },
  // Attachment preview styles
  attachmentPreviewContainer: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  attachmentPreviewItem: {
    marginRight: 12,
    alignItems: 'center',
    width: 80,
  },
  attachmentPreviewImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  attachmentPreviewFile: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentPreviewIcon: {
    fontSize: 24,
  },
  removeAttachmentButton: {
    position: 'absolute',
    top: -4,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeAttachmentText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
    lineHeight: 18,
  },
  attachmentPreviewName: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
    textAlign: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginTop: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 1.5,
    backgroundColor: '#9BDDFF',
  },
  uploadError: {
    fontSize: 9,
    color: '#FF6B6B',
    marginTop: 4,
    textAlign: 'center',
  },
  // Attachment menu styles
  attachmentMenuBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  attachmentMenuPopup: {
    position: 'absolute',
    bottom: 70,
    left: 12,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  attachmentMenuPopupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  attachmentMenuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  attachmentMenu: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: 30,
    paddingHorizontal: 16,
  },
  attachmentMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  attachmentMenuIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  attachmentMenuText: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  attachmentMenuCancel: {
    justifyContent: 'center',
    borderBottomWidth: 0,
    marginTop: 8,
  },
  attachmentMenuCancelText: {
    fontSize: 16,
    color: '#FF4444',
    fontWeight: '600',
    textAlign: 'center',
  },
  // Image viewer styles
  imageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerContainer: {
    width: SCREEN_WIDTH,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerImage: {
    width: SCREEN_WIDTH,
    height: '80%',
  },
  imageViewerCloseButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerCloseText: {
    fontSize: 28,
    color: '#FFFFFF',
    fontWeight: '300',
    lineHeight: 32,
  },
});
