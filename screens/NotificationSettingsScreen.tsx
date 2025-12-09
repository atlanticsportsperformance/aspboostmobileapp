import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Switch,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import {
  isPushNotificationsEnabled,
  setupPushNotifications,
  unregisterPushToken,
  getStoredPushToken,
} from '../lib/pushNotifications';

interface NotificationSettings {
  email_booking_confirmations: boolean;
  email_booking_cancellations: boolean;
  email_event_deletions: boolean;
  email_session_reminders: boolean;
  email_commerce_notifications: boolean;
  send_to_parents: boolean;
}

const defaultSettings: NotificationSettings = {
  email_booking_confirmations: true,
  email_booking_cancellations: true,
  email_event_deletions: true,
  email_session_reminders: true,
  email_commerce_notifications: true,
  send_to_parents: true,
};

export default function NotificationSettingsScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<NotificationSettings>(defaultSettings);
  const [userId, setUserId] = useState<string>('');
  const [orgId, setOrgId] = useState<string>('');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    loadSettings();
    checkPushStatus();
  }, []);

  async function checkPushStatus() {
    const enabled = await isPushNotificationsEnabled();
    const token = await getStoredPushToken();
    setPushEnabled(enabled && !!token);
  }

  async function handlePushToggle(enabled: boolean) {
    setPushLoading(true);
    try {
      if (enabled) {
        const token = await setupPushNotifications();
        if (token) {
          setPushEnabled(true);
        } else {
          // Permission was denied or couldn't get token
          Alert.alert(
            'Enable Notifications',
            'To receive push notifications, please enable them in your device settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Open Settings',
                onPress: () => Linking.openSettings(),
              },
            ]
          );
        }
      } else {
        await unregisterPushToken();
        setPushEnabled(false);
      }
    } catch (error) {
      console.error('Error toggling push notifications:', error);
      Alert.alert('Error', 'Failed to update push notification settings.');
    } finally {
      setPushLoading(false);
    }
  }

  async function loadSettings() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }
      setUserId(user.id);

      // Get user's org_id from profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('org_id')
        .eq('id', user.id)
        .single();

      if (!profile?.org_id) {
        setLoading(false);
        return;
      }
      setOrgId(profile.org_id);

      // Try to get or create notification settings using RPC
      const { data: settingsData, error } = await supabase
        .rpc('get_or_create_notification_settings', {
          p_user_id: user.id,
          p_org_id: profile.org_id,
        });

      if (error) {
        console.error('Error loading notification settings:', error);
        // Fall back to querying directly
        const { data: directSettings } = await supabase
          .from('notification_settings')
          .select('*')
          .eq('user_id', user.id)
          .eq('org_id', profile.org_id)
          .single();

        if (directSettings) {
          setSettings({
            email_booking_confirmations: directSettings.email_booking_confirmations ?? true,
            email_booking_cancellations: directSettings.email_booking_cancellations ?? true,
            email_event_deletions: directSettings.email_event_deletions ?? true,
            email_session_reminders: directSettings.email_session_reminders ?? true,
            email_commerce_notifications: directSettings.email_commerce_notifications ?? true,
            send_to_parents: directSettings.send_to_parents ?? true,
          });
        }
      } else if (settingsData) {
        setSettings({
          email_booking_confirmations: settingsData.email_booking_confirmations ?? true,
          email_booking_cancellations: settingsData.email_booking_cancellations ?? true,
          email_event_deletions: settingsData.email_event_deletions ?? true,
          email_session_reminders: settingsData.email_session_reminders ?? true,
          email_commerce_notifications: settingsData.email_commerce_notifications ?? true,
          send_to_parents: settingsData.send_to_parents ?? true,
        });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    if (!userId || !orgId) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('notification_settings')
        .upsert({
          user_id: userId,
          org_id: orgId,
          email_booking_confirmations: settings.email_booking_confirmations,
          email_booking_cancellations: settings.email_booking_cancellations,
          email_event_deletions: settings.email_event_deletions,
          email_session_reminders: settings.email_session_reminders,
          email_commerce_notifications: settings.email_commerce_notifications,
          send_to_parents: settings.send_to_parents,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,org_id',
        });

      if (error) throw error;
      Alert.alert('Success', 'Notification settings saved successfully.');
    } catch (error) {
      console.error('Error saving settings:', error);
      Alert.alert('Error', 'Failed to save notification settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function updateSetting(key: keyof NotificationSettings, value: boolean) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9BDDFF" />
          <Text style={styles.loadingText}>Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color="#9BDDFF" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Push Notifications Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIconContainer, { backgroundColor: 'rgba(34, 197, 94, 0.15)' }]}>
              <Ionicons name="notifications-outline" size={20} color="#22C55E" />
            </View>
            <Text style={styles.sectionTitle}>Push Notifications</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Enable Push Notifications</Text>
                <Text style={styles.settingDescription}>
                  Receive instant notifications on your device
                </Text>
              </View>
              {pushLoading ? (
                <ActivityIndicator size="small" color="#9BDDFF" />
              ) : (
                <Switch
                  value={pushEnabled}
                  onValueChange={handlePushToggle}
                  trackColor={{ false: 'rgba(255,255,255,0.2)', true: '#22C55E' }}
                  thumbColor={pushEnabled ? '#FFFFFF' : '#888888'}
                  ios_backgroundColor="rgba(255,255,255,0.2)"
                />
              )}
            </View>
          </View>

          {!pushEnabled && (
            <Text style={styles.pushHint}>
              Enable push notifications to receive workout reminders, session updates, and important alerts.
            </Text>
          )}
        </View>

        {/* Email Notifications Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconContainer}>
              <Ionicons name="mail-outline" size={20} color="#9BDDFF" />
            </View>
            <Text style={styles.sectionTitle}>Email Notifications</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Booking Confirmations</Text>
                <Text style={styles.settingDescription}>
                  Receive emails when sessions are booked
                </Text>
              </View>
              <Switch
                value={settings.email_booking_confirmations}
                onValueChange={(value) => updateSetting('email_booking_confirmations', value)}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: '#9BDDFF' }}
                thumbColor={settings.email_booking_confirmations ? '#FFFFFF' : '#888888'}
                ios_backgroundColor="rgba(255,255,255,0.2)"
              />
            </View>

            <View style={styles.settingDivider} />

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Booking Cancellations</Text>
                <Text style={styles.settingDescription}>
                  Receive emails when sessions are cancelled
                </Text>
              </View>
              <Switch
                value={settings.email_booking_cancellations}
                onValueChange={(value) => updateSetting('email_booking_cancellations', value)}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: '#9BDDFF' }}
                thumbColor={settings.email_booking_cancellations ? '#FFFFFF' : '#888888'}
                ios_backgroundColor="rgba(255,255,255,0.2)"
              />
            </View>

            <View style={styles.settingDivider} />

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Event Deletions</Text>
                <Text style={styles.settingDescription}>
                  Receive emails when events are removed
                </Text>
              </View>
              <Switch
                value={settings.email_event_deletions}
                onValueChange={(value) => updateSetting('email_event_deletions', value)}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: '#9BDDFF' }}
                thumbColor={settings.email_event_deletions ? '#FFFFFF' : '#888888'}
                ios_backgroundColor="rgba(255,255,255,0.2)"
              />
            </View>

            <View style={styles.settingDivider} />

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Session Reminders</Text>
                <Text style={styles.settingDescription}>
                  Receive reminder emails before sessions
                </Text>
              </View>
              <Switch
                value={settings.email_session_reminders}
                onValueChange={(value) => updateSetting('email_session_reminders', value)}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: '#9BDDFF' }}
                thumbColor={settings.email_session_reminders ? '#FFFFFF' : '#888888'}
                ios_backgroundColor="rgba(255,255,255,0.2)"
              />
            </View>
          </View>
        </View>

        {/* Commerce Notifications Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconContainer}>
              <Ionicons name="card-outline" size={20} color="#9BDDFF" />
            </View>
            <Text style={styles.sectionTitle}>Membership & Packages</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Commerce Notifications</Text>
                <Text style={styles.settingDescription}>
                  Receive emails about memberships and packages
                </Text>
              </View>
              <Switch
                value={settings.email_commerce_notifications}
                onValueChange={(value) => updateSetting('email_commerce_notifications', value)}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: '#9BDDFF' }}
                thumbColor={settings.email_commerce_notifications ? '#FFFFFF' : '#888888'}
                ios_backgroundColor="rgba(255,255,255,0.2)"
              />
            </View>
          </View>
        </View>

        {/* Parent Notifications Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconContainer}>
              <Ionicons name="people-outline" size={20} color="#9BDDFF" />
            </View>
            <Text style={styles.sectionTitle}>Parent Notifications</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Send to Parents</Text>
                <Text style={styles.settingDescription}>
                  Also send notifications to linked parent emails
                </Text>
              </View>
              <Switch
                value={settings.send_to_parents}
                onValueChange={(value) => updateSetting('send_to_parents', value)}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: '#9BDDFF' }}
                thumbColor={settings.send_to_parents ? '#FFFFFF' : '#888888'}
                ios_backgroundColor="rgba(255,255,255,0.2)"
              />
            </View>
          </View>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={saveSettings}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#000000" />
          ) : (
            <Text style={styles.saveButtonText}>Save Settings</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backButtonText: {
    fontSize: 16,
    color: '#9BDDFF',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerSpacer: {
    width: 60,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  sectionIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(155, 221, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  settingDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginHorizontal: 16,
  },
  saveButton: {
    backgroundColor: '#9BDDFF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  pushHint: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 8,
    paddingHorizontal: 4,
    lineHeight: 18,
  },
});
