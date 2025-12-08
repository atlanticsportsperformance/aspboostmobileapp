import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Modal,
  Image,
  Linking,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import YoutubePlayer from 'react-native-youtube-iframe';
import { supabase } from '../lib/supabase';
import { useAthlete } from '../contexts/AthleteContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLORS = {
  primary: '#9BDDFF',
  primaryDark: '#7BC5F0',
  secondary: '#F5F0E6',
  gold: '#D4AF37',
  white: '#FFFFFF',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  black: '#0A0A0A',
  purple500: '#A855F7',
  purple600: '#9333EA',
  red500: '#EF4444',
  green500: '#22C55E',
  amber500: '#F59E0B',
  blue500: '#3B82F6',
};

const CATEGORIES = ['Training', 'Nutrition', 'Recovery', 'Administrative', 'Performance', 'Schedule'];

interface Resource {
  id: string;
  athlete_id: string | null;
  uploaded_by: string;
  resource_type: 'file' | 'bulletin' | 'note' | 'report_link';
  file_name: string | null;
  file_type: 'image' | 'video' | 'document' | 'other' | null;
  file_url: string | null;
  file_size: number | null;
  mime_type: string | null;
  title: string | null;
  description: string | null;
  notes: string | null;
  pinned: boolean;
  category: string | null;
  visibility: 'all' | 'coaches_only' | 'athlete_only';
  created_at: string;
  is_group_resource: boolean;
  group_id: string | null;
  uploaded_by_profile: {
    first_name: string | null;
    last_name: string | null;
  } | null;
}

interface ReportMetadata {
  reportId?: string;
  reportDate?: string;
  sectionTypes?: string[];
  athleteName?: string;
}

type FilterType = 'all' | 'bulletins' | 'reports' | 'images' | 'videos' | 'documents';

export default function ResourcesScreen({ navigation, route }: any) {
  const { isParent } = useAthlete();
  const { athleteId: routeAthleteId, userId: routeUserId } = route.params || {};

  const [athleteId, setAthleteId] = useState<string | null>(routeAthleteId || null);
  // userId here represents the athlete's profile ID (for resource queries), not the logged-in user
  const [userId, setUserId] = useState<string | null>(routeUserId || null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);

  // FAB state and data presence
  const [fabOpen, setFabOpen] = useState(false);
  const [hasHittingData, setHasHittingData] = useState(false);
  const [hasPitchingData, setHasPitchingData] = useState(false);
  const [hasArmCareData, setHasArmCareData] = useState(false);
  const [hasForceProfileData, setHasForceProfileData] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }

      // Use passed userId (athlete's profile ID) or fallback to logged-in user
      let currentUserId = userId || user.id;
      let currentAthleteId = athleteId;

      // If no athleteId passed, look up by user_id
      if (!currentAthleteId) {
        const { data: athlete } = await supabase
          .from('athletes')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (athlete) {
          currentAthleteId = athlete.id;
          setAthleteId(athlete.id);
        }
        // Also set userId if not passed
        if (!userId) {
          currentUserId = user.id;
          setUserId(user.id);
        }
      }

      if (currentAthleteId && currentUserId) {
        await Promise.all([
          fetchResources(currentUserId, currentAthleteId),
          fetchFabData(currentAthleteId, user.id),
          markResourcesAsViewed(currentAthleteId),
        ]);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      setLoading(false);
    }
  }

  async function fetchResources(userIdParam: string, athleteIdParam: string) {
    try {
      // Get athlete's group IDs
      const { data: groupMemberships } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('athlete_id', athleteIdParam);

      const groupIds = groupMemberships?.map(g => g.group_id) || [];

      // Build query for resources
      let query = supabase
        .from('resources')
        .select(`
          *,
          uploaded_by_profile:profiles!uploaded_by(first_name, last_name)
        `)
        .neq('visibility', 'coaches_only')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false });

      // Filter by athlete_id OR group_id
      if (groupIds.length > 0) {
        query = query.or(`athlete_id.eq.${userIdParam},group_id.in.(${groupIds.join(',')})`);
      } else {
        query = query.eq('athlete_id', userIdParam);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching resources:', error);
        return;
      }

      // Debug: Log resource types to see what we're getting
      console.log('Resources loaded:', data?.length, 'items');
      console.log('Resource types:', data?.map(r => ({ id: r.id, type: r.resource_type, title: r.title, file_url: r.file_url })));
      setResources(data || []);
    } catch (error) {
      console.error('Error in fetchResources:', error);
    }
  }

  async function markResourcesAsViewed(athleteIdParam: string) {
    try {
      await supabase
        .from('athletes')
        .update({ last_viewed_resources_at: new Date().toISOString() })
        .eq('id', athleteIdParam);
    } catch (error) {
      console.error('Error marking resources as viewed:', error);
    }
  }

  async function fetchFabData(athleteIdParam: string, userIdParam: string) {
    try {
      // Check for hitting data (Blast + HitTrax)
      const [blastSwings, hittraxSessions] = await Promise.all([
        supabase.from('blast_swings').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
        supabase.from('hittrax_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
      ]);
      setHasHittingData((blastSwings.count || 0) > 0 || (hittraxSessions.count || 0) > 0);

      // Check for pitching data (TrackMan + Command)
      const [trackmanPitches, commandSessions] = await Promise.all([
        supabase.from('trackman_pitch_data').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
        supabase.from('command_training_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
      ]);
      setHasPitchingData((trackmanPitches.count || 0) > 0 || (commandSessions.count || 0) > 0);

      // Check for arm care data
      const { count: armCareCount } = await supabase
        .from('armcare_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteIdParam);
      setHasArmCareData((armCareCount || 0) > 0);

      // Check for force profile data
      const { count: forceCount } = await supabase
        .from('force_plate_percentiles')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteIdParam);
      setHasForceProfileData((forceCount || 0) > 0);

      // Count unread messages
      const { count: unreadCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', userIdParam)
        .eq('read', false);
      setUnreadMessagesCount(unreadCount || 0);
    } catch (error) {
      console.error('Error fetching FAB data:', error);
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (userId && athleteId) {
      await fetchResources(userId, athleteId);
    }
    setRefreshing(false);
  }, [userId, athleteId]);

  // Filter resources
  const filteredResources = resources.filter(resource => {
    if (filterType === 'all') return true;
    if (filterType === 'bulletins') return resource.resource_type === 'bulletin';
    if (filterType === 'reports') return resource.resource_type === 'report_link';
    if (filterType === 'images') return resource.file_type === 'image';
    if (filterType === 'videos') return resource.file_type === 'video';
    if (filterType === 'documents') return resource.file_type === 'document';
    return true;
  });

  const pinnedResources = filteredResources.filter(r => r.pinned);
  const unpinnedResources = filteredResources.filter(r => !r.pinned);

  // Helpers
  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatFileSize(bytes: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getYouTubeVideoId(text: string): string | null {
    // Handle text that may contain a URL anywhere in it
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      /(?:youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return match[1];
    }
    return null;
  }

  function getVimeoVideoId(url: string): string | null {
    const match = url.match(/(?:vimeo\.com\/)(\d+)/);
    return match ? match[1] : null;
  }

  function getRegularUrl(text: string): string | null {
    // Check if text contains a URL that's not YouTube or Vimeo
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    const match = text.match(urlPattern);
    if (match && match[0]) {
      const url = match[0];
      // Exclude YouTube and Vimeo URLs
      if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('vimeo.com')) {
        return null;
      }
      return url;
    }
    return null;
  }

  function getUploaderName(resource: Resource): string {
    if (resource.uploaded_by_profile) {
      const { first_name, last_name } = resource.uploaded_by_profile;
      if (first_name || last_name) {
        return `${first_name || ''} ${last_name || ''}`.trim();
      }
    }
    return 'Coach';
  }

  function getCategoryColor(category: string): string {
    switch (category.toLowerCase()) {
      case 'training': return '#3B82F6';
      case 'nutrition': return '#22C55E';
      case 'recovery': return '#8B5CF6';
      case 'administrative': return '#6B7280';
      case 'performance': return '#F59E0B';
      case 'schedule': return '#EC4899';
      default: return '#6B7280';
    }
  }

  function getFileIcon(fileType: string | null): string {
    switch (fileType) {
      case 'image': return 'image';
      case 'video': return 'videocam';
      case 'document': return 'document-text';
      default: return 'document';
    }
  }

  function toggleExpanded(id: string) {
    setExpandedDescriptions(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function openFile(url: string) {
    try {
      await Linking.openURL(url);
    } catch (error) {
      console.error('Error opening file:', error);
    }
  }

  // Render Resource Card
  function renderResourceCard(resource: Resource) {
    const isBulletin = resource.resource_type === 'bulletin';
    const isReportLink = resource.resource_type === 'report_link';
    const isExpanded = expandedDescriptions.has(resource.id);
    const youtubeVideoId = resource.notes ? getYouTubeVideoId(resource.notes) : null;
    const vimeoVideoId = resource.notes ? getVimeoVideoId(resource.notes) : null;
    const regularUrl = resource.notes ? getRegularUrl(resource.notes) : null;
    const hasVideo = youtubeVideoId || vimeoVideoId;

    if (isBulletin) {
      return (
        <View key={resource.id} style={styles.bulletinCard}>
          {/* Purple gradient left border */}
          <LinearGradient
            colors={[COLORS.purple500, COLORS.purple600]}
            style={styles.bulletinBorder}
          />

          <View style={styles.bulletinContent}>
            {/* Header */}
            <View style={styles.bulletinHeader}>
              <View style={styles.bulletinIconBox}>
                <Ionicons name="document-text" size={16} color={COLORS.purple500} />
              </View>
              <View style={styles.bulletinHeaderText}>
                <Text style={styles.bulletinTitle}>{resource.title || 'Bulletin'}</Text>
                <View style={styles.bulletinMeta}>
                  <Text style={styles.bulletinMetaText}>
                    Posted by {getUploaderName(resource)}
                  </Text>
                  <Text style={styles.bulletinMetaDot}>•</Text>
                  <Text style={styles.bulletinMetaText}>{formatDate(resource.created_at)}</Text>
                </View>
              </View>
              {resource.pinned && (
                <View style={styles.pinnedBadge}>
                  <Ionicons name="pin" size={10} color={COLORS.primary} />
                </View>
              )}
            </View>

            {/* Category badge */}
            {resource.category && (
              <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(resource.category) + '20' }]}>
                <Text style={[styles.categoryBadgeText, { color: getCategoryColor(resource.category) }]}>
                  {resource.category}
                </Text>
              </View>
            )}

            {/* Description */}
            {resource.description && (
              <View style={styles.bulletinDescriptionContainer}>
                <Text
                  style={styles.bulletinDescription}
                  numberOfLines={isExpanded ? undefined : 3}
                >
                  {resource.description}
                </Text>
                {resource.description.length > 150 && (
                  <TouchableOpacity onPress={() => toggleExpanded(resource.id)}>
                    <Text style={styles.readMoreText}>
                      {isExpanded ? 'Show less' : 'Read more'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Video embed - using react-native-youtube-iframe */}
            {youtubeVideoId && (
              <View style={styles.videoContainer}>
                <YoutubePlayer
                  height={200}
                  videoId={youtubeVideoId}
                  play={false}
                  webViewProps={{
                    allowsInlineMediaPlayback: true,
                  }}
                />
              </View>
            )}
            {/* Vimeo video embed */}
            {vimeoVideoId && !youtubeVideoId && (
              <View style={styles.videoContainer}>
                <WebView
                  style={styles.video}
                  source={{ uri: `https://player.vimeo.com/video/${vimeoVideoId}` }}
                  allowsFullscreenVideo={true}
                  allowsInlineMediaPlayback={true}
                  javaScriptEnabled={true}
                  domStorageEnabled={true}
                  scrollEnabled={false}
                  bounces={false}
                  startInLoadingState={true}
                  renderLoading={() => (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
                      <ActivityIndicator size="large" color={COLORS.primary} />
                    </View>
                  )}
                />
              </View>
            )}

            {/* Open Link button - for URLs that aren't YouTube/Vimeo */}
            {regularUrl && !hasVideo && (
              <TouchableOpacity
                style={styles.openLinkButton}
                onPress={() => Linking.openURL(regularUrl)}
              >
                <Ionicons name="open-outline" size={16} color={COLORS.black} />
                <Text style={styles.openLinkButtonText}>Open Link</Text>
              </TouchableOpacity>
            )}

            {/* Also check file_url for report links */}
            {resource.file_url && !regularUrl && !hasVideo && (
              <TouchableOpacity
                style={styles.openLinkButton}
                onPress={() => {
                  let url = resource.file_url!;
                  if (url.startsWith('/reports/public/')) {
                    url = `https://aspboostapp.vercel.app${url}`;
                  }
                  Linking.openURL(url);
                }}
              >
                <Ionicons name="open-outline" size={16} color={COLORS.black} />
                <Text style={styles.openLinkButtonText}>View Report</Text>
              </TouchableOpacity>
            )}

            {/* Group resource badge */}
            {resource.is_group_resource && (
              <View style={styles.groupBadge}>
                <Ionicons name="people" size={12} color={COLORS.blue500} />
                <Text style={styles.groupBadgeText}>Group Resource</Text>
              </View>
            )}
          </View>
        </View>
      );
    }

    // Report Link card
    if (resource.resource_type === 'report_link') {
      // Parse notes field for metadata
      let metadata: ReportMetadata = {};
      try {
        if (resource.notes) {
          metadata = JSON.parse(resource.notes);
        }
      } catch (e) {
        // Notes field is not JSON, that's okay
      }

      const sectionTypes = metadata.sectionTypes || [];
      const reportDate = metadata.reportDate || formatDate(resource.created_at);

      // Get display name for section types - matching web app exactly
      const getSectionDisplayName = (section: string): string => {
        const sectionLabels: Record<string, string> = {
          blast_motion: 'Blast Motion',
          hittrax: 'HitTrax',
          trackman: 'TrackMan',
          command_training: 'Command',
          force_plate: 'Force Plate',
          force_profile: 'Force Profile',
          force_metrics_history: 'Force History',
          cmj: 'CMJ',
          sj: 'Squat Jump',
          hj: 'Hop Jump',
          ppu: 'Push Up',
          imtp: 'IMTP',
          armcare: 'ArmCare',
          custom_notes: 'Notes',
        };
        return sectionLabels[section] || section;
      };

      // Handle opening report URL
      const handleOpenReport = () => {
        let url = resource.file_url;
        if (url) {
          // If URL starts with /reports/public/, prepend base URL
          if (url.startsWith('/reports/public/')) {
            url = `https://aspboostapp.vercel.app${url}`;
          }
          Linking.openURL(url);
        }
      };

      return (
        <TouchableOpacity
          key={resource.id}
          style={styles.reportCard}
          onPress={handleOpenReport}
          activeOpacity={0.8}
        >
          {/* Sky blue gradient left border */}
          <LinearGradient
            colors={[COLORS.primary, COLORS.primaryDark]}
            style={styles.reportBorder}
          />

          <View style={styles.reportContent}>
            {/* Header */}
            <View style={styles.reportHeader}>
              <LinearGradient
                colors={[COLORS.primary, COLORS.primaryDark]}
                style={styles.reportIconBox}
              >
                <Ionicons name="bar-chart" size={24} color={COLORS.black} />
              </LinearGradient>
              <View style={styles.reportHeaderText}>
                <View style={styles.reportTitleRow}>
                  <Text style={styles.reportTitle}>
                    {metadata.athleteName ? `Performance Report: ${metadata.athleteName}` : (resource.title || 'Performance Report')}
                  </Text>
                  <View style={styles.reportBadge}>
                    <Text style={styles.reportBadgeText}>Report</Text>
                  </View>
                </View>
                {resource.description && (
                  <Text style={styles.reportDescription} numberOfLines={1}>
                    {resource.description}
                  </Text>
                )}
                <View style={styles.reportMeta}>
                  {reportDate && (
                    <>
                      <Ionicons name="calendar-outline" size={12} color={COLORS.gray500} />
                      <Text style={styles.reportMetaText}>{reportDate}</Text>
                    </>
                  )}
                  {resource.uploaded_by_profile && (
                    <>
                      <Text style={styles.reportMetaDot}>•</Text>
                      <Text style={styles.reportMetaText}>
                        Added by {getUploaderName(resource)}
                      </Text>
                    </>
                  )}
                </View>
              </View>
            </View>

            {/* Section type pills */}
            {sectionTypes.length > 0 && (
              <View style={styles.sectionPillsContainer}>
                {sectionTypes.map((section, index) => (
                  <View key={index} style={styles.sectionPill}>
                    <Text style={styles.sectionPillText}>{getSectionDisplayName(section)}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* View Report button */}
            <View style={styles.reportButtonContainer}>
              <View style={styles.reportButton}>
                <Ionicons name="open-outline" size={14} color={COLORS.black} />
                <Text style={styles.reportButtonText}>View Report</Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      );
    }

    // File card
    return (
      <View key={resource.id} style={styles.fileCard}>
        {/* Preview */}
        <TouchableOpacity
          style={styles.filePreview}
          onPress={() => {
            if (resource.file_type === 'image' && resource.file_url) {
              setSelectedImageUrl(resource.file_url);
              setImageModalVisible(true);
            } else if (resource.file_url) {
              openFile(resource.file_url);
            }
          }}
          activeOpacity={0.8}
        >
          {resource.file_type === 'image' && resource.file_url ? (
            <Image source={{ uri: resource.file_url }} style={styles.fileImage} resizeMode="cover" />
          ) : resource.file_type === 'video' && resource.file_url ? (
            <View style={styles.fileVideoPreview}>
              <Ionicons name="play-circle" size={40} color={COLORS.white} />
            </View>
          ) : (
            <View style={styles.fileIconPreview}>
              <Ionicons name={getFileIcon(resource.file_type) as any} size={32} color={COLORS.gray400} />
            </View>
          )}
          {resource.pinned && (
            <View style={styles.filePinnedBadge}>
              <Ionicons name="pin" size={10} color={COLORS.primary} />
            </View>
          )}
        </TouchableOpacity>

        {/* Info */}
        <View style={styles.fileInfo}>
          <Text style={styles.fileTitle} numberOfLines={1}>
            {resource.title || resource.file_name || 'File'}
          </Text>
          {resource.description && (
            <Text style={styles.fileDescription} numberOfLines={2}>
              {resource.description}
            </Text>
          )}
          <View style={styles.fileMeta}>
            {resource.file_size && (
              <Text style={styles.fileMetaText}>{formatFileSize(resource.file_size)}</Text>
            )}
            <Text style={styles.fileMetaText}>{formatDate(resource.created_at)}</Text>
          </View>

          {/* Actions */}
          <View style={styles.fileActions}>
            <TouchableOpacity
              style={styles.fileActionButton}
              onPress={() => {
                if (resource.file_type === 'image' && resource.file_url) {
                  setSelectedImageUrl(resource.file_url);
                  setImageModalVisible(true);
                } else if (resource.file_url) {
                  openFile(resource.file_url);
                }
              }}
            >
              <Ionicons name={resource.file_type === 'image' ? 'expand-outline' : 'open-outline'} size={16} color={COLORS.primary} />
              <Text style={styles.fileActionText}>{resource.file_type === 'image' ? 'View Full' : 'View'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading resources...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={20} color={COLORS.gray400} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Notes & Resources</Text>
          <Text style={styles.subtitle}>Bulletins, media, and files from your coaches</Text>
        </View>

        {/* Filter Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterContainer}
          contentContainerStyle={styles.filterContent}
        >
          {(['all', 'bulletins', 'reports', 'images', 'videos', 'documents'] as FilterType[]).map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.filterTab, filterType === type && styles.filterTabActive]}
              onPress={() => setFilterType(type)}
            >
              {filterType === type ? (
                <LinearGradient
                  colors={[COLORS.primary, COLORS.primaryDark]}
                  style={styles.filterTabGradient}
                >
                  <Text style={styles.filterTabTextActive}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </Text>
                </LinearGradient>
              ) : (
                <Text style={styles.filterTabText}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Resources */}
        {filteredResources.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={56} color={COLORS.gray600} />
            <Text style={styles.emptyTitle}>No notes here yet!</Text>
            <Text style={styles.emptySubtitle}>
              When your coaches share bulletins, files, or notes with you, they'll appear here.
            </Text>
          </View>
        ) : (
          <>
            {/* Pinned Section */}
            {pinnedResources.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="pin" size={14} color={COLORS.primary} />
                  <Text style={styles.sectionTitle}>Pinned</Text>
                </View>
                {pinnedResources.map(renderResourceCard)}
              </View>
            )}

            {/* All Resources */}
            {unpinnedResources.length > 0 && (
              <View style={styles.section}>
                {pinnedResources.length > 0 && (
                  <Text style={styles.sectionTitle}>All Resources</Text>
                )}
                {unpinnedResources.map(renderResourceCard)}
              </View>
            )}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FAB Button - Dynamic based on athlete data (matching DashboardScreen exactly) */}
      <View style={styles.fabContainer}>
        {/* Notification Badge on FAB */}
        {unreadMessagesCount > 0 && !fabOpen && (
          <View style={styles.fabNotificationBadge}>
            <Text style={styles.fabNotificationBadgeText}>
              {unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}
            </Text>
          </View>
        )}
        <TouchableOpacity
          onPress={() => setFabOpen(!fabOpen)}
          style={styles.fab}
        >
          <LinearGradient
            colors={['#9BDDFF', '#B0E5FF', '#7BC5F0']}
            style={styles.fabGradient}
          >
            <Text style={styles.fabIcon}>{fabOpen ? '✕' : '☰'}</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* FAB Menu - Dynamic items based on athlete data */}
        <Modal
          visible={fabOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setFabOpen(false)}
        >
          <TouchableOpacity
            style={styles.fabOverlay}
            activeOpacity={1}
            onPress={() => setFabOpen(false)}
          >
            <View style={styles.fabMenu} onStartShouldSetResponder={() => true}>
              {/* ALWAYS SHOWN: Home */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate(isParent ? 'ParentDashboard' : 'Dashboard');
                }}
              >
                <Ionicons name="home" size={20} color="#FFFFFF" />
                <Text style={styles.fabMenuLabel}>Home</Text>
              </TouchableOpacity>

              {/* ALWAYS SHOWN: Messages with badge */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate('Messages');
                }}
              >
                <View style={styles.fabMenuIconContainer}>
                  <Ionicons name="chatbubble" size={20} color="#FFFFFF" />
                  {unreadMessagesCount > 0 && (
                    <View style={styles.fabMenuItemBadge}>
                      <Text style={styles.fabMenuItemBadgeText}>
                        {unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.fabMenuLabel}>Messages</Text>
              </TouchableOpacity>

              {/* ALWAYS SHOWN: Performance */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate('Performance', { athleteId });
                }}
              >
                <Ionicons name="stats-chart" size={20} color="#FFFFFF" />
                <Text style={styles.fabMenuLabel}>Performance</Text>
              </TouchableOpacity>

              {/* ALWAYS SHOWN: Leaderboard */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate('Leaderboard');
                }}
              >
                <Ionicons name="trophy" size={20} color="#FFFFFF" />
                <Text style={styles.fabMenuLabel}>Leaderboard</Text>
              </TouchableOpacity>

              {/* CONDITIONAL: Hitting - only if hasHittingData */}
              {hasHittingData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => {
                    setFabOpen(false);
                    navigation.navigate('HittingPerformance', { athleteId });
                  }}
                >
                  <MaterialCommunityIcons name="baseball-bat" size={20} color="#EF4444" />
                  <Text style={styles.fabMenuLabel}>Hitting</Text>
                </TouchableOpacity>
              )}

              {/* CONDITIONAL: Pitching - only if hasPitchingData */}
              {hasPitchingData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => {
                    setFabOpen(false);
                    navigation.navigate('PitchingPerformance', { athleteId });
                  }}
                >
                  <MaterialCommunityIcons name="baseball" size={20} color="#3B82F6" />
                  <Text style={styles.fabMenuLabel}>Pitching</Text>
                </TouchableOpacity>
              )}

              {/* CONDITIONAL: Arm Care - only if hasArmCareData */}
              {hasArmCareData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => {
                    setFabOpen(false);
                    navigation.navigate('ArmCare', { athleteId });
                  }}
                >
                  <MaterialCommunityIcons name="arm-flex" size={20} color="#10B981" />
                  <Text style={styles.fabMenuLabel}>Arm Care</Text>
                </TouchableOpacity>
              )}

              {/* CONDITIONAL: Force Profile - only if hasForceProfileData */}
              {hasForceProfileData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => {
                    setFabOpen(false);
                    navigation.navigate('ForceProfile', { athleteId });
                  }}
                >
                  <Ionicons name="trending-up" size={20} color="#A855F7" />
                  <Text style={styles.fabMenuLabel}>Force Profile</Text>
                </TouchableOpacity>
              )}

              {/* Notes/Resources - Active (current page) */}
              <TouchableOpacity
                style={[styles.fabMenuItem, styles.fabMenuItemActive]}
                onPress={() => setFabOpen(false)}
              >
                <Ionicons name="document-text" size={20} color="#9BDDFF" />
                <Text style={[styles.fabMenuLabel, styles.fabMenuLabelActive]}>Notes/Resources</Text>
              </TouchableOpacity>

              {/* Book a Class - always visible */}
              <TouchableOpacity
                style={styles.fabMenuItemBook}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate('Booking');
                }}
              >
                <Ionicons name="calendar" size={20} color="#000000" />
                <Text style={styles.fabMenuLabelBook}>Book a Class</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>

      {/* Image Viewer Modal */}
      <Modal
        visible={imageModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImageModalVisible(false)}
      >
        <View style={styles.imageModalOverlay}>
          <TouchableOpacity
            style={styles.imageModalCloseButton}
            onPress={() => setImageModalVisible(false)}
          >
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>
          {selectedImageUrl && (
            <Image
              source={{ uri: selectedImageUrl }}
              style={styles.imageModalImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  loadingContainer: { flex: 1, backgroundColor: COLORS.black, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: COLORS.gray400, fontSize: 14, marginTop: 16 },
  scrollView: { flex: 1, paddingHorizontal: 16 },

  // Header
  header: { paddingTop: 8, marginBottom: 16 },
  backButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backText: { color: COLORS.gray400, fontSize: 14, marginLeft: 8 },
  title: { fontSize: 28, fontWeight: 'bold', color: COLORS.white, marginBottom: 4 },
  subtitle: { fontSize: 14, color: COLORS.gray400 },

  // Filter Tabs
  filterContainer: { marginBottom: 20 },
  filterContent: { gap: 8 },
  filterTab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  filterTabActive: { padding: 0, borderWidth: 0, overflow: 'hidden' },
  filterTabGradient: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  filterTabText: { fontSize: 13, color: COLORS.gray400, textAlign: 'center' },
  filterTabTextActive: { fontSize: 13, color: COLORS.black, fontWeight: '600', textAlign: 'center' },

  // Empty State
  emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: COLORS.white, marginTop: 16, marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: COLORS.gray400, textAlign: 'center' },

  // Section
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: COLORS.white, marginBottom: 12 },

  // Bulletin Card
  bulletinCard: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(168,85,247,0.3)' },
  bulletinBorder: { width: 4 },
  bulletinContent: { flex: 1, padding: 12 },
  bulletinHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  bulletinIconBox: { width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(168,85,247,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  bulletinHeaderText: { flex: 1 },
  bulletinTitle: { fontSize: 16, fontWeight: '600', color: COLORS.white, marginBottom: 2 },
  bulletinMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  bulletinMetaText: { fontSize: 11, color: COLORS.gray500 },
  bulletinMetaDot: { fontSize: 11, color: COLORS.gray600, marginHorizontal: 4 },
  pinnedBadge: { backgroundColor: 'rgba(155,221,255,0.2)', padding: 4, borderRadius: 4 },
  categoryBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, marginBottom: 8 },
  categoryBadgeText: { fontSize: 10, fontWeight: '600' },
  bulletinDescriptionContainer: { marginBottom: 8 },
  bulletinDescription: { fontSize: 14, color: COLORS.gray400, lineHeight: 20 },
  readMoreText: { fontSize: 12, color: COLORS.primary, marginTop: 4, fontWeight: '500' },
  // Video Container (matching WorkoutExecutionScreen exactly)
  videoContainer: { width: '100%', height: 200, marginTop: 12, borderRadius: 8, overflow: 'hidden', backgroundColor: '#000' },
  video: { width: '100%', height: '100%' },
  openLinkButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, marginTop: 12, alignSelf: 'flex-start' },
  openLinkButtonText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
  groupBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  groupBadgeText: { fontSize: 11, color: COLORS.blue500 },

  // Report Link Card
  reportCard: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(155,221,255,0.3)' },
  reportBorder: { width: 4 },
  reportContent: { flex: 1, padding: 12 },
  reportHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  reportIconBox: { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12, shadowColor: '#9BDDFF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  reportHeaderText: { flex: 1 },
  reportTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  reportTitle: { fontSize: 17, fontWeight: '700', color: COLORS.white, flex: 1 },
  reportBadge: { backgroundColor: 'rgba(155,221,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  reportBadgeText: { fontSize: 11, color: COLORS.primary, fontWeight: '500' },
  reportDescription: { fontSize: 13, color: COLORS.gray400, marginTop: 2 },
  reportMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  reportMetaText: { fontSize: 11, color: COLORS.gray500 },
  reportMetaDot: { fontSize: 11, color: COLORS.gray600 },
  sectionPillsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  sectionPill: { backgroundColor: 'rgba(155,221,255,0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(155,221,255,0.3)' },
  sectionPillText: { fontSize: 11, color: COLORS.primary, fontWeight: '500' },
  reportButtonContainer: { flexDirection: 'row' },
  reportButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  reportButtonText: { fontSize: 13, fontWeight: '600', color: COLORS.black },

  // File Card
  fileCard: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filePreview: { width: 100, height: 100, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  fileImage: { width: '100%', height: '100%' },
  fileVideoPreview: { width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  fileIconPreview: { justifyContent: 'center', alignItems: 'center' },
  filePinnedBadge: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(155,221,255,0.3)', padding: 4, borderRadius: 4 },
  fileInfo: { flex: 1, padding: 12 },
  fileTitle: { fontSize: 14, fontWeight: '600', color: COLORS.white, marginBottom: 4 },
  fileDescription: { fontSize: 12, color: COLORS.gray400, marginBottom: 6 },
  fileMeta: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  fileMetaText: { fontSize: 10, color: COLORS.gray500 },
  fileActions: { flexDirection: 'row', gap: 8 },
  fileActionButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(155,221,255,0.1)', borderRadius: 6 },
  fileActionText: { fontSize: 12, color: COLORS.primary },

  // FAB Styles (matching DashboardScreen exactly)
  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 24,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowColor: '#9BDDFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fabIcon: {
    fontSize: 24,
    color: '#000000',
    fontWeight: 'bold',
  },
  fabOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    padding: 24,
    paddingBottom: 100,
  },
  fabMenu: {
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    minWidth: 220,
    padding: 8,
  },
  fabMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  fabMenuLabel: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  // FAB Dynamic styles (matching DashboardScreen exactly)
  fabNotificationBadge: {
    position: 'absolute',
    top: -4,
    left: -4,
    minWidth: 24,
    height: 24,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#000000',
    zIndex: 20,
  },
  fabNotificationBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFFFFF',
    paddingHorizontal: 4,
  },
  fabMenuItemActive: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.3)',
  },
  fabMenuLabelActive: {
    color: '#9BDDFF',
  },
  fabMenuIconContainer: {
    position: 'relative',
  },
  fabMenuItemBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    backgroundColor: '#EF4444',
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000000',
  },
  fabMenuItemBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFFFFF',
    paddingHorizontal: 3,
  },
  fabMenuItemBook: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#9BDDFF',
    marginTop: 8,
  },
  fabMenuLabelBook: {
    fontSize: 16,
    color: '#000000',
    fontWeight: '600',
  },

  // Image Modal
  imageModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageModalCloseButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  imageModalImage: {
    width: SCREEN_WIDTH - 32,
    height: '80%',
  },
});
