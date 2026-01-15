import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useStripe, initStripe, CardField, useConfirmSetupIntent } from '@stripe/stripe-react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app';

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
}

interface Payment {
  id: string;
  amount_cents: number;
  currency: string;
  payment_method: string;
  status: string;
  created_at: string;
  notes: string | null;
}

interface LinkedAthlete {
  id: string;
  athlete_id: string;
  first_name: string;
  last_name: string;
}

export default function BillingScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [linkedAthletes, setLinkedAthletes] = useState<LinkedAthlete[]>([]);
  const [selectedAthleteName, setSelectedAthleteName] = useState('');
  const [showAthleteSelector, setShowAthleteSelector] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loadingPaymentMethods, setLoadingPaymentMethods] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);

  // Add card modal state
  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const [setupIntentClientSecret, setSetupIntentClientSecret] = useState<string | null>(null);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);

  // Action loading states
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [settingDefaultCardId, setSettingDefaultCardId] = useState<string | null>(null);

  const { confirmSetupIntent } = useConfirmSetupIntent();

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (athleteId) {
      fetchPaymentMethods();
      fetchPaymentHistory();
    }
  }, [athleteId]);

  async function fetchInitialData() {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }

      // Check if user is an athlete
      const { data: athleteData } = await supabase
        .from('athletes')
        .select('id, first_name, last_name')
        .eq('user_id', user.id)
        .single();

      if (athleteData) {
        setAthleteId(athleteData.id);
        setSelectedAthleteName(`${athleteData.first_name} ${athleteData.last_name}`);
        setLinkedAthletes([{ ...athleteData, athlete_id: athleteData.id }]);
        return;
      }

      // Check if user is a parent - use athlete_guardians table (same as rest of app)
      const { data: guardianLinks } = await supabase
        .from('athlete_guardians')
        .select(`
          athlete_id,
          athlete:profiles!athlete_guardians_athlete_id_fkey(
            id,
            first_name,
            last_name
          )
        `)
        .eq('guardian_id', user.id);

      if (guardianLinks && guardianLinks.length > 0) {
        // Need to get the athletes table ID for each linked profile
        const athletePromises = guardianLinks
          .filter((link: any) => link.athlete)
          .map(async (link: any) => {
            // Look up athletes table ID from user_id (profile id)
            const { data: athleteRecord } = await supabase
              .from('athletes')
              .select('id, first_name, last_name')
              .eq('user_id', link.athlete.id)
              .single();

            if (athleteRecord) {
              return {
                id: athleteRecord.id,
                athlete_id: athleteRecord.id,
                first_name: athleteRecord.first_name || link.athlete.first_name,
                last_name: athleteRecord.last_name || link.athlete.last_name,
              };
            }
            return null;
          });

        const athletes = (await Promise.all(athletePromises)).filter(Boolean);

        setLinkedAthletes(athletes);
        if (athletes.length > 0) {
          setAthleteId(athletes[0].athlete_id);
          setSelectedAthleteName(`${athletes[0].first_name} ${athletes[0].last_name}`);
        }
      }
    } catch (error) {
      console.error('Error fetching initial data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPaymentMethods() {
    if (!athleteId) return;

    try {
      setLoadingPaymentMethods(true);
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(`${API_URL}/api/stripe/payment-methods?athlete_id=${athleteId}`, {
        headers: session?.access_token ? {
          'Authorization': `Bearer ${session.access_token}`,
        } : {},
      });

      const data = await response.json();

      if (response.ok) {
        setPaymentMethods(data.payment_methods || []);
      } else {
        console.error('Error fetching payment methods:', data.error);
      }
    } catch (error) {
      console.error('Error fetching payment methods:', error);
    } finally {
      setLoadingPaymentMethods(false);
    }
  }

  async function fetchPaymentHistory() {
    if (!athleteId) return;

    try {
      setLoadingPayments(true);
      const { data: paymentData } = await supabase
        .from('payments')
        .select('id, amount_cents, currency, payment_method, status, created_at, notes')
        .eq('athlete_id', athleteId)
        .order('created_at', { ascending: false })
        .limit(50);

      setPayments(paymentData || []);
    } catch (error) {
      console.error('Error fetching payment history:', error);
    } finally {
      setLoadingPayments(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([fetchPaymentMethods(), fetchPaymentHistory()]);
    setRefreshing(false);
  }

  function selectAthlete(athlete: LinkedAthlete) {
    setAthleteId(athlete.athlete_id);
    setSelectedAthleteName(`${athlete.first_name} ${athlete.last_name}`);
    setShowAthleteSelector(false);
    setPaymentMethods([]);
    setPayments([]);
  }

  async function handleAddCard() {
    if (!athleteId) return;

    try {
      setAddingCard(true);
      const { data: { session } } = await supabase.auth.getSession();

      // Create setup intent
      const response = await fetch(`${API_URL}/api/stripe/setup-intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ athlete_id: athleteId }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert('Error', data.error || 'Failed to initialize card setup');
        setAddingCard(false);
        return;
      }

      setSetupIntentClientSecret(data.client_secret);
      setStripeAccountId(data.stripe_account);

      // Reinitialize Stripe with connected account
      if (data.stripe_account) {
        await initStripe({
          publishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',
          stripeAccountId: data.stripe_account,
          merchantIdentifier: 'merchant.com.aspboost',
          urlScheme: 'aspboost',
        });
      }

      setShowAddCardModal(true);
      setAddingCard(false);
    } catch (error) {
      console.error('Error initializing card setup:', error);
      Alert.alert('Error', 'Failed to initialize card setup');
      setAddingCard(false);
    }
  }

  async function handleSaveCard() {
    if (!setupIntentClientSecret || !cardComplete) return;

    try {
      setAddingCard(true);

      const { setupIntent, error } = await confirmSetupIntent(setupIntentClientSecret, {
        paymentMethodType: 'Card',
      });

      if (error) {
        Alert.alert('Error', error.message || 'Failed to save card');
        setAddingCard(false);
        return;
      }

      // Success
      setShowAddCardModal(false);
      setSetupIntentClientSecret(null);
      setCardComplete(false);
      Alert.alert('Success', 'Card saved successfully!');
      await fetchPaymentMethods();
    } catch (error: any) {
      console.error('Error saving card:', error);
      Alert.alert('Error', error.message || 'Failed to save card');
    } finally {
      setAddingCard(false);
    }
  }

  async function handleDeleteCard(paymentMethodId: string) {
    Alert.alert(
      'Remove Card',
      'Are you sure you want to remove this card?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingCardId(paymentMethodId);
              const { data: { session } } = await supabase.auth.getSession();

              const response = await fetch(
                `${API_URL}/api/stripe/payment-methods/${paymentMethodId}?athlete_id=${athleteId}`,
                {
                  method: 'DELETE',
                  headers: session?.access_token ? {
                    'Authorization': `Bearer ${session.access_token}`,
                  } : {},
                }
              );

              const data = await response.json();

              if (!response.ok) {
                Alert.alert('Error', data.error || 'Failed to remove card');
                return;
              }

              Alert.alert('Success', 'Card removed successfully');
              await fetchPaymentMethods();
            } catch (error) {
              console.error('Error deleting card:', error);
              Alert.alert('Error', 'Failed to remove card');
            } finally {
              setDeletingCardId(null);
            }
          },
        },
      ]
    );
  }

  async function handleSetDefaultCard(paymentMethodId: string) {
    try {
      setSettingDefaultCardId(paymentMethodId);
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(
        `${API_URL}/api/stripe/payment-methods/${paymentMethodId}?athlete_id=${athleteId}`,
        {
          method: 'PATCH',
          headers: session?.access_token ? {
            'Authorization': `Bearer ${session.access_token}`,
          } : {},
        }
      );

      const data = await response.json();

      if (!response.ok) {
        Alert.alert('Error', data.error || 'Failed to set default card');
        return;
      }

      Alert.alert('Success', 'Default card updated');
      await fetchPaymentMethods();
    } catch (error) {
      console.error('Error setting default card:', error);
      Alert.alert('Error', 'Failed to set default card');
    } finally {
      setSettingDefaultCardId(null);
    }
  }

  function formatAmount(cents: number, currency: string) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatBrand(brand: string) {
    const brandMap: Record<string, string> = {
      visa: 'Visa',
      mastercard: 'Mastercard',
      amex: 'American Express',
      discover: 'Discover',
      diners: 'Diners Club',
      jcb: 'JCB',
      unionpay: 'UnionPay',
    };
    return brandMap[brand.toLowerCase()] || brand;
  }

  function getPaymentMethodLabel(method: string) {
    const labels: Record<string, string> = {
      stripe: 'Card',
      cash: 'Cash',
      check: 'Check',
      comp: 'Comp',
      other: 'Other',
    };
    return labels[method] || method;
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'succeeded': return '#22C55E';
      case 'pending': return '#EAB308';
      case 'failed': return '#EF4444';
      case 'refunded': return '#9CA3AF';
      case 'cancelled': return '#6B7280';
      default: return '#9CA3AF';
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case 'succeeded': return 'checkmark-circle';
      case 'pending': return 'time';
      case 'failed': return 'alert-circle';
      case 'refunded': return 'return-down-back';
      case 'cancelled': return 'close-circle';
      default: return 'help-circle';
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9BDDFF" />
          <Text style={styles.loadingText}>Loading billing...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!athleteId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Ionicons name="card-outline" size={48} color="#6B7280" />
          <Text style={styles.loadingText}>No Account Found</Text>
          <Text style={styles.emptySubtext}>Unable to load billing information.</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButtonEmpty}>
            <Text style={styles.backButtonEmptyText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBackButton}>
          <Ionicons name="chevron-back" size={24} color="#9CA3AF" />
          <Text style={styles.headerBackText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Billing & Payments</Text>

        {/* Athlete Selector for Parents */}
        {linkedAthletes.length > 1 ? (
          <TouchableOpacity
            onPress={() => setShowAthleteSelector(!showAthleteSelector)}
            style={styles.athleteSelector}
          >
            <Ionicons name="person" size={16} color="#9CA3AF" />
            <Text style={styles.athleteSelectorText}>{selectedAthleteName}</Text>
            <Ionicons
              name={showAthleteSelector ? 'chevron-up' : 'chevron-down'}
              size={16}
              color="#9CA3AF"
            />
          </TouchableOpacity>
        ) : (
          <Text style={styles.headerSubtitle}>{selectedAthleteName}</Text>
        )}
      </View>

      {/* Athlete Selector Dropdown */}
      {showAthleteSelector && (
        <View style={styles.athleteDropdown}>
          {linkedAthletes.map((athlete) => (
            <TouchableOpacity
              key={athlete.athlete_id}
              style={[
                styles.athleteDropdownItem,
                athlete.athlete_id === athleteId && styles.athleteDropdownItemSelected,
              ]}
              onPress={() => selectAthlete(athlete)}
            >
              <Text style={styles.athleteDropdownItemText}>
                {athlete.first_name} {athlete.last_name}
              </Text>
              {athlete.athlete_id === athleteId && (
                <Ionicons name="checkmark" size={18} color="#9BDDFF" />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#9BDDFF"
          />
        }
      >
        {/* Payment Methods Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="card" size={20} color="#A855F7" />
              <Text style={styles.sectionTitle}>Payment Methods</Text>
            </View>
            <TouchableOpacity
              style={styles.addButton}
              onPress={handleAddCard}
              disabled={addingCard}
            >
              {addingCard ? (
                <ActivityIndicator size="small" color="#9BDDFF" />
              ) : (
                <>
                  <Ionicons name="add" size={18} color="#9BDDFF" />
                  <Text style={styles.addButtonText}>Add Card</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionDescription}>
            Manage your saved cards. Cards are stored securely with Stripe.
          </Text>

          {loadingPaymentMethods ? (
            <View style={styles.loadingSection}>
              <ActivityIndicator size="small" color="#9BDDFF" />
            </View>
          ) : paymentMethods.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="card-outline" size={40} color="#4B5563" />
              <Text style={styles.emptyStateText}>No saved payment methods</Text>
              <TouchableOpacity
                style={styles.emptyStateButton}
                onPress={handleAddCard}
                disabled={addingCard}
              >
                <Ionicons name="add" size={16} color="#9BDDFF" />
                <Text style={styles.emptyStateButtonText}>Add a card</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.cardsList}>
              {paymentMethods.map((pm) => (
                <View
                  key={pm.id}
                  style={[
                    styles.paymentMethodCard,
                    pm.is_default && styles.paymentMethodCardDefault,
                  ]}
                >
                  <View style={styles.paymentMethodInfo}>
                    <Ionicons
                      name="card"
                      size={24}
                      color={pm.brand.toLowerCase() === 'visa' ? '#1A1F71' : '#EB001B'}
                    />
                    <View style={styles.paymentMethodDetails}>
                      <View style={styles.paymentMethodNameRow}>
                        <Text style={styles.paymentMethodName}>
                          {formatBrand(pm.brand)} •••• {pm.last4}
                        </Text>
                        {pm.is_default && (
                          <View style={styles.defaultBadge}>
                            <Text style={styles.defaultBadgeText}>Default</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.paymentMethodExpiry}>
                        Expires {pm.exp_month.toString().padStart(2, '0')}/{pm.exp_year}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.paymentMethodActions}>
                    {!pm.is_default && (
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => handleSetDefaultCard(pm.id)}
                        disabled={settingDefaultCardId === pm.id}
                      >
                        {settingDefaultCardId === pm.id ? (
                          <ActivityIndicator size="small" color="#9CA3AF" />
                        ) : (
                          <Ionicons name="star-outline" size={20} color="#9CA3AF" />
                        )}
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleDeleteCard(pm.id)}
                      disabled={deletingCardId === pm.id}
                    >
                      {deletingCardId === pm.id ? (
                        <ActivityIndicator size="small" color="#EF4444" />
                      ) : (
                        <Ionicons name="trash-outline" size={20} color="#EF4444" />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Transaction History Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="receipt" size={20} color="#3B82F6" />
              <Text style={styles.sectionTitle}>Transaction History</Text>
            </View>
          </View>

          {loadingPayments ? (
            <View style={styles.loadingSection}>
              <ActivityIndicator size="small" color="#9BDDFF" />
            </View>
          ) : payments.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="receipt-outline" size={40} color="#4B5563" />
              <Text style={styles.emptyStateText}>No transactions yet</Text>
            </View>
          ) : (
            <View style={styles.transactionsList}>
              {payments.map((payment) => (
                <View key={payment.id} style={styles.transactionCard}>
                  <View style={styles.transactionIconContainer}>
                    <Ionicons
                      name={getStatusIcon(payment.status) as any}
                      size={20}
                      color={getStatusColor(payment.status)}
                    />
                  </View>
                  <View style={styles.transactionInfo}>
                    <Text style={styles.transactionAmount}>
                      {formatAmount(payment.amount_cents, payment.currency)}
                    </Text>
                    <Text style={styles.transactionMeta}>
                      {getPaymentMethodLabel(payment.payment_method)} • {formatDate(payment.created_at)}
                    </Text>
                    {payment.notes && (
                      <Text style={styles.transactionNotes} numberOfLines={1}>
                        {payment.notes}
                      </Text>
                    )}
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: `${getStatusColor(payment.status)}20` }]}>
                    <Text style={[styles.statusBadgeText, { color: getStatusColor(payment.status) }]}>
                      {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Add Card Modal - Full Screen */}
      <Modal
        visible={showAddCardModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setShowAddCardModal(false);
          setSetupIntentClientSecret(null);
          setCardComplete(false);
        }}
      >
        <SafeAreaView style={styles.addCardModalContainer}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            {/* Header */}
            <View style={styles.addCardModalHeader}>
              <TouchableOpacity
                onPress={() => {
                  setShowAddCardModal(false);
                  setSetupIntentClientSecret(null);
                  setCardComplete(false);
                }}
                style={styles.addCardModalCloseButton}
              >
                <Ionicons name="close" size={28} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.addCardModalTitle}>Add Card</Text>
              <View style={{ width: 44 }} />
            </View>

            {/* Content */}
            <View style={styles.addCardModalContent}>
              <View style={styles.cardIconContainer}>
                <Ionicons name="card" size={48} color="#9BDDFF" />
              </View>

              <Text style={styles.addCardModalHeading}>Payment Details</Text>
              <Text style={styles.addCardModalDescription}>
                Your card will be saved securely with Stripe for future purchases.
              </Text>

              <View style={styles.cardFieldContainer}>
                <CardField
                  postalCodeEnabled={true}
                  placeholders={{
                    number: '4242 4242 4242 4242',
                  }}
                  cardStyle={{
                    backgroundColor: '#111111',
                    textColor: '#FFFFFF',
                    placeholderColor: '#6B7280',
                    borderWidth: 0,
                    borderRadius: 0,
                    fontSize: 16,
                  }}
                  style={styles.cardField}
                  onCardChange={(cardDetails) => {
                    setCardComplete(cardDetails.complete);
                  }}
                />
              </View>

              <View style={styles.secureNotice}>
                <Ionicons name="lock-closed" size={14} color="#6B7280" />
                <Text style={styles.secureNoticeText}>
                  Secured by Stripe. We never store your card details.
                </Text>
              </View>
            </View>

            {/* Footer Actions */}
            <View style={styles.addCardModalFooter}>
              <TouchableOpacity
                style={[
                  styles.saveCardButton,
                  (!cardComplete || addingCard) && styles.saveCardButtonDisabled,
                ]}
                onPress={handleSaveCard}
                disabled={!cardComplete || addingCard}
              >
                {addingCard ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.saveCardButtonText}>Save Card</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
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
    color: '#9CA3AF',
    fontSize: 14,
    marginTop: 16,
  },
  emptySubtext: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 4,
  },
  backButtonEmpty: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
  },
  backButtonEmptyText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  headerBackText: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 4,
  },
  athleteSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
  },
  athleteSelectorText: {
    color: '#E5E7EB',
    fontSize: 14,
  },
  athleteDropdown: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#1F2937',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  athleteDropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  athleteDropdownItemSelected: {
    backgroundColor: 'rgba(155,221,255,0.1)',
  },
  athleteDropdownItemText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 20,
  },
  section: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  sectionDescription: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 16,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(155,221,255,0.1)',
    borderRadius: 8,
  },
  addButtonText: {
    color: '#9BDDFF',
    fontSize: 13,
    fontWeight: '500',
  },
  loadingSection: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
  },
  emptyStateText: {
    color: '#6B7280',
    fontSize: 14,
    marginTop: 8,
  },
  emptyStateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  emptyStateButtonText: {
    color: '#9BDDFF',
    fontSize: 14,
  },
  cardsList: {
    gap: 12,
  },
  paymentMethodCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  paymentMethodCardDefault: {
    borderColor: 'rgba(155,221,255,0.3)',
  },
  paymentMethodInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  paymentMethodDetails: {
    flex: 1,
  },
  paymentMethodNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  paymentMethodName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  defaultBadge: {
    backgroundColor: 'rgba(155,221,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  defaultBadgeText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#9BDDFF',
  },
  paymentMethodExpiry: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 2,
  },
  paymentMethodActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionButton: {
    padding: 8,
  },
  transactionsList: {
    gap: 8,
  },
  transactionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  transactionIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  transactionInfo: {
    flex: 1,
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  transactionMeta: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  transactionNotes: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // Add Card Modal Styles
  addCardModalContainer: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  addCardModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  addCardModalCloseButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addCardModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  addCardModalContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  cardIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 24,
  },
  addCardModalHeading: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  addCardModalDescription: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  cardFieldContainer: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  cardField: {
    width: '100%',
    height: 56,
  },
  secureNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
  },
  secureNoticeText: {
    fontSize: 13,
    color: '#6B7280',
  },
  addCardModalFooter: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  saveCardButton: {
    paddingVertical: 16,
    backgroundColor: '#9BDDFF',
    borderRadius: 12,
    alignItems: 'center',
  },
  saveCardButtonDisabled: {
    opacity: 0.5,
  },
  saveCardButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
  },
});
