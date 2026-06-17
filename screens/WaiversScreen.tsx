import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Dimensions,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { getAthleteWaivers, formatSignatureType, formatWaiverDate } from '../lib/waiverApi';
import { SignedWaiver, PendingWaiver } from '../types/waiver';
import WaiverSigningSheet from '../components/booking/WaiverSigningSheet';

const SCREEN_HEIGHT = Dimensions.get('window').height;

const COLORS = {
  primary: '#9BDDFF',
  primaryDark: '#7BC5F0',
  black: '#0A0A0A',
  white: '#FFFFFF',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  green500: '#22C55E',
  yellow500: '#EAB308',
  red500: '#EF4444',
};

export default function WaiversScreen({ navigation, route }: any) {
  // blocking mode kept as an optional flag — triggered when mobile booking
  // flow detects pending waivers and routes here. Athletes reaching this
  // screen from the profile menu get the normal (non-blocking) experience.
  const blocking: boolean = route?.params?.blocking === true;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [athleteDob, setAthleteDob] = useState<string | null>(null);
  const [athleteIsMinor, setAthleteIsMinor] = useState(true); // fail closed by default
  const [signedWaivers, setSignedWaivers] = useState<SignedWaiver[]>([]);
  const [pendingWaivers, setPendingWaivers] = useState<PendingWaiver[]>([]);

  // Detail modal state
  const [selectedWaiver, setSelectedWaiver] = useState<SignedWaiver | null>(null);

  // Signing sheet state
  const [showSigningSheet, setShowSigningSheet] = useState(false);
  const [waiversToSign, setWaiversToSign] = useState<PendingWaiver[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setLoadError(false);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get athlete ID + DOB for local minor check
      const { data: athlete } = await supabase
        .from('athletes')
        .select('id, date_of_birth')
        .eq('user_id', user.id)
        .single();

      if (!athlete) {
        console.log('No athlete found for user');
        setLoading(false);
        return;
      }

      setAthleteId(athlete.id);
      setAthleteDob(athlete.date_of_birth ?? null);
      // FIX 2a: fail CLOSED on unknown DOB — treat null as minor so a
      // guardian-required waiver always demands the guardian form rather
      // than silently allowing a self-sign when age is unknown.
      // WaiverSigningSheet also receives athleteDob and recomputes per-waiver
      // using minorAgeThreshold, so this flag is a fallback for when DOB is
      // unavailable.
      if (athlete.date_of_birth) {
        const dob = new Date(athlete.date_of_birth);
        const now = new Date();
        let age = now.getFullYear() - dob.getFullYear();
        const m = now.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
        setAthleteIsMinor(age < 18);
      } else {
        // Unknown age → treat as minor (fail closed).
        setAthleteIsMinor(true);
      }

      // Load waivers
      const waiverData = await getAthleteWaivers(athlete.id);
      setSignedWaivers(waiverData.signed_waivers);
      setPendingWaivers(waiverData.pending_waivers);
    } catch (error) {
      console.error('Error loading waivers:', error);
      // FIX 3a: surface a distinct error state so blocking mode can show
      // a Retry button rather than leaving the user on a header-only screen.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, []);

  const handleSignWaiver = (waiver: PendingWaiver) => {
    setWaiversToSign([waiver]);
    setShowSigningSheet(true);
  };

  const navigateToDashboard = async () => {
    const { data: userData } = await supabase.auth.getUser();
    const isParent = userData?.user
      ? (
          await supabase
            .from('profiles')
            .select('account_type')
            .eq('id', userData.user.id)
            .maybeSingle()
        ).data?.account_type === 'parent'
      : false;
    navigation.reset({
      index: 0,
      routes: [{ name: isParent ? 'ParentDashboard' : 'Dashboard' }],
    });
  };

  const handleSigningComplete = async () => {
    setShowSigningSheet(false);
    setWaiversToSign([]);
    // FIX 1: loadData() refreshes pendingWaivers from /api/athletes/[id]/waivers
    // which DOES include league participation pendings. We then gate the
    // blocking-clear off the real refreshed list — not the athlete_pending_waivers
    // table, which never contains league waivers.
    await loadData();
    if (blocking) {
      // pendingWaivers is set synchronously by setPendingWaivers inside
      // loadData; read the ref via a functional form isn't available here,
      // but since loadData awaits before returning, React will have flushed
      // the state batch. We use a local re-fetch to read the authoritative
      // value without depending on closure-captured stale state.
      const freshData = athleteId ? await getAthleteWaivers(athleteId) : null;
      const remaining = freshData?.pending_waivers ?? [];
      if (remaining.length === 0) {
        await navigateToDashboard();
      }
    }
  };

  const renderWaiverContent = (html: string) => {
    // Basic HTML to text conversion
    const text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li>/gi, '• ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    return text;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // FIX 3: error state — transient network/auth failure. Show Retry so the
  // user isn't trapped on a header-only screen in blocking mode.
  if (loadError) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          {blocking ? (
            <View style={styles.headerPlaceholder} />
          ) : (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle}>Waivers</Text>
          <View style={styles.headerPlaceholder} />
        </View>
        <View style={styles.loadingContainer}>
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.gray600} />
          <Text style={{ color: COLORS.gray400, fontSize: 15, marginTop: 16, marginBottom: 24, textAlign: 'center', paddingHorizontal: 32 }}>
            Could not load your waivers. Check your connection and try again.
          </Text>
          <TouchableOpacity
            style={{ paddingVertical: 12, paddingHorizontal: 28, backgroundColor: COLORS.primary, borderRadius: 12 }}
            onPress={() => loadData()}
          >
            <Text style={{ color: COLORS.black, fontWeight: '700', fontSize: 15 }}>Retry</Text>
          </TouchableOpacity>
          {blocking && (
            <TouchableOpacity
              style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 6 }}
              onPress={() => navigateToDashboard()}
            >
              <Ionicons name="home-outline" size={14} color={COLORS.gray400} />
              <Text style={{ color: COLORS.gray400, fontSize: 13, fontWeight: '600' }}>
                Back to dashboard
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        {blocking ? (
          <View style={styles.headerPlaceholder} />
        ) : (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Waivers</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      {blocking && pendingWaivers.length > 0 && (
        <View
          style={{
            marginHorizontal: 16,
            marginTop: 12,
            padding: 14,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: 'rgba(239,68,68,0.4)',
            backgroundColor: 'rgba(239,68,68,0.08)',
            flexDirection: 'row',
            gap: 10,
          }}
        >
          <Ionicons name="lock-closed" size={20} color={COLORS.red500} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>
              Sign required waivers to continue
            </Text>
            <Text style={{ color: '#d1d5db', fontSize: 12, marginTop: 4, lineHeight: 17 }}>
              You have {pendingWaivers.length} required waiver
              {pendingWaivers.length === 1 ? '' : 's'} to sign before you can
              use ASP Boost. Booking, logging workouts, and other features are
              blocked until every required waiver is signed.
            </Text>
          </View>
        </View>
      )}

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Pending Waivers Section */}
        {pendingWaivers.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="alert-circle" size={18} color={COLORS.yellow500} />
              <Text style={styles.sectionTitle}>Needs Signature</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pendingWaivers.length}</Text>
              </View>
            </View>

            {pendingWaivers.map((waiver) => (
              <TouchableOpacity
                key={waiver.id}
                style={styles.pendingCard}
                onPress={() => handleSignWaiver(waiver)}
                activeOpacity={0.7}
              >
                <View style={styles.cardContent}>
                  <View style={styles.cardIcon}>
                    <Ionicons name="document-text" size={20} color={COLORS.yellow500} />
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardTitle}>{waiver.name}</Text>
                    {waiver.description && (
                      <Text style={styles.cardDescription} numberOfLines={1}>
                        {waiver.description}
                      </Text>
                    )}
                    <Text style={styles.pendingLabel}>Tap to sign</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.gray500} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Signed Waivers Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="checkmark-circle" size={18} color={COLORS.green500} />
            <Text style={styles.sectionTitle}>Signed Waivers</Text>
          </View>

          {signedWaivers.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="document-outline" size={32} color={COLORS.gray600} />
              <Text style={styles.emptyText}>No signed waivers yet</Text>
            </View>
          ) : (
            signedWaivers.map((waiver) => (
              <TouchableOpacity
                key={waiver.id}
                style={[styles.signedCard, waiver.needsResigning && styles.needsResigningCard]}
                onPress={() => setSelectedWaiver(waiver)}
                activeOpacity={0.7}
              >
                <View style={styles.cardContent}>
                  <View style={[styles.cardIcon, styles.signedIcon]}>
                    <Ionicons
                      name={waiver.needsResigning ? 'alert' : 'checkmark'}
                      size={20}
                      color={waiver.needsResigning ? COLORS.yellow500 : COLORS.green500}
                    />
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardTitle}>{waiver.waiver.name}</Text>
                    <Text style={styles.cardMeta}>
                      Signed {formatWaiverDate(waiver.signedAt)} • {formatSignatureType(waiver.signatureType)}
                    </Text>
                    {waiver.needsResigning && (
                      <Text style={styles.resiginingLabel}>New version available</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.gray500} />
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.footer} />
      </ScrollView>

      {/* Signed Waiver Detail Modal */}
      <Modal
        visible={!!selectedWaiver}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedWaiver(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <Ionicons name="document-text" size={20} color={COLORS.green500} />
                <Text style={styles.modalTitle}>Waiver Details</Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setSelectedWaiver(null)}
              >
                <Ionicons name="close" size={24} color={COLORS.gray400} />
              </TouchableOpacity>
            </View>

            {selectedWaiver && (
              <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
                <Text style={styles.modalWaiverName}>{selectedWaiver.waiver.name}</Text>

                {/* Signature Info */}
                <View style={styles.signatureInfoCard}>
                  <View style={styles.signatureInfoRow}>
                    <Text style={styles.signatureInfoLabel}>Signed On</Text>
                    <Text style={styles.signatureInfoValue}>
                      {formatWaiverDate(selectedWaiver.signedAt)}
                    </Text>
                  </View>
                  <View style={styles.signatureInfoRow}>
                    <Text style={styles.signatureInfoLabel}>Method</Text>
                    <Text style={styles.signatureInfoValue}>
                      {formatSignatureType(selectedWaiver.signatureType)}
                    </Text>
                  </View>
                  <View style={styles.signatureInfoRow}>
                    <Text style={styles.signatureInfoLabel}>Version</Text>
                    <Text style={styles.signatureInfoValue}>
                      v{selectedWaiver.waiverVersion}
                      {selectedWaiver.needsResigning && (
                        <Text style={styles.newVersionText}> (New: v{selectedWaiver.waiver.version})</Text>
                      )}
                    </Text>
                  </View>
                  {selectedWaiver.signedByRelationship && (
                    <View style={styles.signatureInfoRow}>
                      <Text style={styles.signatureInfoLabel}>Signed By</Text>
                      <Text style={styles.signatureInfoValue}>
                        {selectedWaiver.signedByRelationship}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Waiver Content */}
                <Text style={styles.contentLabel}>Waiver Content</Text>
                <View style={styles.contentCard}>
                  <Text style={styles.contentText}>
                    {renderWaiverContent(selectedWaiver.waiver.content)}
                  </Text>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Waiver Signing Sheet.
          FIX 3b: pass onBackToDashboard in blocking mode so a transient
          failure (or a user choosing not to sign right now) can never
          permanently trap someone on this screen. */}
      {athleteId && (
        <WaiverSigningSheet
          visible={showSigningSheet}
          waivers={waiversToSign}
          athleteId={athleteId}
          athleteIsMinor={athleteIsMinor}
          athleteDob={athleteDob}
          onClose={() => {
            setShowSigningSheet(false);
            setWaiversToSign([]);
          }}
          onComplete={handleSigningComplete}
          {...(blocking ? { onBackToDashboard: () => navigateToDashboard() } : {})}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.white,
  },
  headerPlaceholder: {
    width: 40,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  badge: {
    backgroundColor: COLORS.yellow500,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.black,
  },
  pendingCard: {
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.3)',
  },
  signedCard: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  needsResigningCard: {
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderColor: 'rgba(234, 179, 8, 0.3)',
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(234, 179, 8, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  signedIcon: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: 2,
  },
  cardDescription: {
    fontSize: 13,
    color: COLORS.gray400,
  },
  cardMeta: {
    fontSize: 12,
    color: COLORS.gray500,
  },
  pendingLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.yellow500,
    marginTop: 4,
  },
  resiginingLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.yellow500,
    marginTop: 4,
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray500,
    marginTop: 12,
  },
  footer: {
    height: 40,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.black,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: SCREEN_HEIGHT * 0.85,
    paddingBottom: 34,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  modalCloseButton: {
    padding: 4,
  },
  modalContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  modalWaiverName: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 16,
  },
  signatureInfoCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  signatureInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  signatureInfoLabel: {
    fontSize: 14,
    color: COLORS.gray400,
  },
  signatureInfoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  newVersionText: {
    color: COLORS.yellow500,
    fontWeight: '600',
  },
  contentLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray400,
    marginBottom: 8,
  },
  contentCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  contentText: {
    fontSize: 14,
    color: COLORS.gray400,
    lineHeight: 22,
  },
});
