import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import { useStripe, initStripe } from '@stripe/stripe-react-native';
import { supabase } from '../../lib/supabase';
import {
  BookableEvent,
  PaymentMethod,
  EligibilityData,
  formatEventTime,
  formatFullDate,
} from '../../types/booking';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app';

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface ClassDetailsSheetProps {
  visible: boolean;
  event: BookableEvent | null;
  eligibility: EligibilityData | null;
  paymentMethods: PaymentMethod[];
  loading: boolean;
  bookingInProgress: boolean;
  athleteId: string | null;
  onClose: () => void;
  onReserve: (paymentMethod: PaymentMethod) => void;
  onViewMemberships: () => void;
  onPaymentSuccess?: () => void;
}

export default function ClassDetailsSheet({
  visible,
  event,
  eligibility,
  paymentMethods,
  loading,
  bookingInProgress,
  athleteId,
  onClose,
  onReserve,
  onViewMemberships,
  onPaymentSuccess,
}: ClassDetailsSheetProps) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [paymentInProgress, setPaymentInProgress] = useState(false);

  React.useEffect(() => {
    if (paymentMethods.length > 0 && !selectedPaymentId) {
      setSelectedPaymentId(paymentMethods[0].id);
    }
  }, [paymentMethods]);

  if (!event) return null;

  const spotsRemaining = event.capacity - event.bookedCount;
  const hasMissingRestrictions =
    eligibility?.missingRestrictions && eligibility.missingRestrictions.length > 0;

  // Check drop-in status
  const isDropIn = eligibility?.sourceType === 'drop_in';
  const dropInPriceCents = eligibility?.dropInPriceCents ?? null;
  const isFreeDropIn = isDropIn && dropInPriceCents === 0;
  const isPaidDropIn = isDropIn && dropInPriceCents !== null && dropInPriceCents > 0;
  const dropInPriceFormatted = dropInPriceCents ? `$${(dropInPriceCents / 100).toFixed(2)}` : '';

  // Determine if we should show the "no payment methods" card
  // Don't show it if drop-in is available
  const hasNoPaymentMethods = !loading && paymentMethods.length === 0 && !hasMissingRestrictions && !isDropIn;

  // Can book if: has payment methods selected OR is a free drop-in
  const canBook = eligibility?.canBook && (
    (paymentMethods.length > 0 && selectedPaymentId) || isFreeDropIn
  );
  const selectedPayment = paymentMethods.find((p) => p.id === selectedPaymentId);

  // Handle paid drop-in with Stripe Payment Sheet
  const handlePaidDropInPress = async () => {
    if (!athleteId || !event) {
      Alert.alert('Error', 'Unable to process payment. Please try again.');
      return;
    }

    setPaymentInProgress(true);

    try {
      // Get auth token
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error('Please log in to make a purchase');
      }

      // Request PaymentIntent for in-app Payment Sheet
      const requestBody = {
        athlete_id: athleteId,
        event_id: event.id,
        embedded: true, // Use PaymentIntent for mobile Payment Sheet
      };

      const response = await fetch(`${API_URL}/api/stripe/create-drop-in-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      console.log('API Response:', JSON.stringify(data, null, 2));
      console.log('Client secret prefix:', data.client_secret?.substring(0, 10));

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create payment session');
      }

      const { client_secret, customer_id, ephemeral_key, stripe_account, payment_intent_id } = data;

      if (!client_secret) {
        throw new Error('No client secret returned from server');
      }

      // Validate it's a PaymentIntent secret, not Checkout Session
      if (client_secret.startsWith('cs_')) {
        throw new Error('Server returned Checkout Session instead of PaymentIntent. Please contact support.');
      }

      console.log('stripe_account received:', stripe_account);

      // For Stripe Connect, we need to reinitialize the SDK with the connected account
      // This is required because stripeAccountId must be set at the provider level
      if (stripe_account) {
        console.log('Reinitializing Stripe with connected account:', stripe_account);
        await initStripe({
          publishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',
          stripeAccountId: stripe_account,
          merchantIdentifier: 'merchant.com.aspboost',
          urlScheme: 'aspboost',
        });
      }

      // Initialize the Payment Sheet
      const initParams: any = {
        paymentIntentClientSecret: client_secret,
        merchantDisplayName: 'ASP Boost',
        returnURL: 'aspboost://stripe-redirect',
        allowsDelayedPaymentMethods: false,
      };

      // Add customer info if available
      if (customer_id && ephemeral_key) {
        initParams.customerId = customer_id;
        initParams.customerEphemeralKeySecret = ephemeral_key;
      }

      console.log('Full initParams:', JSON.stringify(initParams, null, 2));

      const { error: initError } = await initPaymentSheet(initParams);

      if (initError) {
        throw new Error(initError.message);
      }

      // Present the Payment Sheet
      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        if (presentError.code === 'Canceled') {
          // User cancelled - don't show error
          return;
        }
        throw new Error(presentError.message);
      }

      // Payment successful - now confirm and create the booking
      // This is necessary because Stripe webhooks are unreliable for connected account PaymentIntents
      console.log('Payment Sheet completed, confirming booking...');

      const confirmResponse = await fetch(`${API_URL}/api/stripe/confirm-drop-in`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          payment_intent_id: payment_intent_id,
          athlete_id: athleteId,
          event_id: event.id,
        }),
      });

      const confirmData = await confirmResponse.json();
      console.log('Confirm response:', confirmData);

      if (!confirmResponse.ok) {
        // Payment succeeded but booking creation failed
        // This is a critical error - payment taken but no booking
        console.error('Failed to confirm booking after payment:', confirmData.error);
        Alert.alert(
          'Booking Issue',
          'Your payment was successful, but we encountered an issue creating your booking. Please contact support with your payment confirmation.',
          [{ text: 'OK' }]
        );
        onPaymentSuccess?.();
        onClose();
        return;
      }

      // All successful
      onClose();
      Alert.alert(
        'Payment Successful',
        'Your drop-in session has been booked!',
        [{ text: 'OK' }]
      );
      onPaymentSuccess?.();

    } catch (error: any) {
      console.error('Payment error:', error);
      Alert.alert(
        'Payment Failed',
        error.message || 'Something went wrong. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setPaymentInProgress(false);
    }
  };

  // Handle reserve button press
  const handleReservePress = () => {
    if (isFreeDropIn) {
      // Free drop-in - create a drop-in payment method object
      const freeDropInMethod: PaymentMethod = {
        id: 'drop_in_free',
        type: 'drop_in',
        name: 'Free Session',
        subtitle: 'No charge',
        expiryDate: null,
        remainingSessions: null,
        priceCents: 0,
        isFree: true,
      };
      onReserve(freeDropInMethod);
    } else if (selectedPayment) {
      onReserve(selectedPayment);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        {/* Tap to close backdrop */}
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />

        {/* Bottom Sheet */}
        <View style={styles.sheet}>
          {/* Handle bar */}
          <View style={styles.handleBar} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path d="M18 6L6 18M6 6l12 12" stroke="#666" strokeWidth={2} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
          </View>

          {/* Scrollable Content */}
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentInner}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Date/Time */}
            <Text style={styles.dateTime}>
              {formatFullDate(event.startTime)} at {formatEventTime(event.startTime)}
            </Text>

            {/* Coach */}
            <View style={styles.row}>
              <LinearGradient colors={['#9BDDFF', '#7BC5F0']} style={styles.avatar}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="#000" strokeWidth={2} />
                  <Circle cx={12} cy={7} r={4} stroke="#000" strokeWidth={2} />
                </Svg>
              </LinearGradient>
              <View>
                <Text style={styles.label}>Instructor</Text>
                <Text style={styles.value}>{event.coachName}</Text>
              </View>
            </View>

            {/* Location */}
            <View style={styles.detailRow}>
              <Text style={styles.label}>Location</Text>
              <Text style={styles.value}>
                {event.location}
                {event.resource ? ` • ${event.resource}` : ''}
              </Text>
            </View>

            {/* Duration */}
            <View style={styles.detailRow}>
              <Text style={styles.label}>Duration</Text>
              <Text style={styles.value}>{event.durationMinutes} min</Text>
            </View>

            {/* Spots */}
            <Text style={styles.spots}>{spotsRemaining} spots remaining</Text>

            {/* Loading */}
            {loading && (
              <ActivityIndicator size="small" color="#9BDDFF" style={{ marginVertical: 20 }} />
            )}

            {/* Restrictions Warning */}
            {hasMissingRestrictions && (
              <View style={styles.warning}>
                <Text style={styles.warningTitle}>Requirements Not Met</Text>
                {eligibility!.missingRestrictions!.map((r, i) => (
                  <Text key={i} style={styles.warningText}>• {r.name}</Text>
                ))}
              </View>
            )}

            {/* No Payment - Membership Required Card */}
            {hasNoPaymentMethods && (
              <View style={styles.membershipCard}>
                <LinearGradient colors={['#9BDDFF', '#7BC5F0']} style={styles.lockIcon}>
                  <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
                    <Path d="M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z" stroke="#000" strokeWidth={2} />
                    <Path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#000" strokeWidth={2} strokeLinecap="round" />
                  </Svg>
                </LinearGradient>
                <Text style={styles.membershipTitle}>Membership or Package Required</Text>
                <Text style={styles.membershipDesc}>
                  You need an active membership or package that includes access to this type of class.
                </Text>
                <TouchableOpacity onPress={onViewMemberships} style={styles.viewMembershipsBtn}>
                  <LinearGradient colors={['#9BDDFF', '#B0E5FF', '#7BC5F0']} style={styles.viewMembershipsGradient}>
                    <Text style={styles.viewMembershipsBtnText}>View Memberships & Packages</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}

            {/* Payment Options - Show if user has memberships/packages */}
            {!loading && paymentMethods.length > 0 && !hasMissingRestrictions && (
              <View style={styles.paymentSection}>
                <Text style={styles.sectionLabel}>Pay With</Text>
                {paymentMethods.map((method) => (
                  <TouchableOpacity
                    key={method.id}
                    style={[styles.paymentRow, selectedPaymentId === method.id && styles.paymentRowActive]}
                    onPress={() => setSelectedPaymentId(method.id)}
                  >
                    <View style={[styles.radio, selectedPaymentId === method.id && styles.radioActive]}>
                      {selectedPaymentId === method.id && <View style={styles.radioInner} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.paymentName}>{method.name}</Text>
                      <Text style={styles.paymentSub}>{method.subtitle}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Free Drop-in Card */}
            {!loading && isFreeDropIn && !hasMissingRestrictions && (
              <View style={styles.dropInCard}>
                <LinearGradient colors={['#34D399', '#10B981']} style={styles.dropInIcon}>
                  <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
                    <Path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                    <Circle cx={12} cy={12} r={9} stroke="#fff" strokeWidth={2} />
                  </Svg>
                </LinearGradient>
                <Text style={styles.dropInTitle}>Free Session</Text>
                <Text style={styles.dropInDesc}>
                  This class is available at no cost. Tap below to reserve your spot!
                </Text>
              </View>
            )}

            {/* Paid Drop-in Card */}
            {!loading && isPaidDropIn && !hasMissingRestrictions && (
              <View style={styles.dropInCard}>
                <LinearGradient colors={['#9BDDFF', '#7BC5F0']} style={styles.dropInIcon}>
                  <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="#000" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </LinearGradient>
                <Text style={styles.dropInTitle}>Drop-in Session</Text>
                <Text style={styles.dropInPrice}>{dropInPriceFormatted}</Text>
                <Text style={styles.dropInDesc}>
                  One-time payment via secure checkout.
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Reserve Button - For memberships/packages and FREE drop-ins */}
          {!loading && (paymentMethods.length > 0 || isFreeDropIn) && !hasMissingRestrictions && !isPaidDropIn && (
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.reserveBtn, !canBook && styles.reserveBtnDisabled]}
                onPress={handleReservePress}
                disabled={!canBook || bookingInProgress}
              >
                <LinearGradient
                  colors={canBook ? ['#9BDDFF', '#7BC5F0'] : ['#ccc', '#aaa']}
                  style={styles.reserveGradient}
                >
                  {bookingInProgress ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={styles.reserveText}>
                      {isFreeDropIn ? 'Reserve Free Session' : 'Reserve Class'}
                    </Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}

          {/* Continue to Payment Button - For PAID drop-ins only */}
          {!loading && isPaidDropIn && !hasMissingRestrictions && (
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.reserveBtn, paymentInProgress && styles.reserveBtnDisabled]}
                onPress={handlePaidDropInPress}
                disabled={paymentInProgress}
              >
                <LinearGradient
                  colors={['#9BDDFF', '#7BC5F0']}
                  style={styles.reserveGradient}
                >
                  {paymentInProgress ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={styles.reserveText}>Pay {dropInPriceFormatted}</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    minHeight: 300,
    maxHeight: SCREEN_HEIGHT * 0.85,
    paddingBottom: 34,
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
    flex: 1,
    marginRight: 12,
  },
  closeBtn: {
    padding: 4,
  },
  content: {
    flexGrow: 0,
    flexShrink: 1,
  },
  contentInner: {
    padding: 20,
  },
  dateTime: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  label: {
    fontSize: 12,
    color: '#888',
  },
  value: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
  },
  detailRow: {
    marginBottom: 12,
  },
  spots: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    marginTop: 4,
  },
  warning: {
    backgroundColor: '#FEF3C7',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  warningTitle: {
    fontWeight: '600',
    color: '#92400E',
    marginBottom: 4,
  },
  warningText: {
    color: '#92400E',
    fontSize: 13,
  },
  membershipCard: {
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.3)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginTop: 8,
  },
  lockIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  membershipTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
    marginBottom: 8,
    textAlign: 'center',
  },
  membershipDesc: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  viewMembershipsBtn: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  viewMembershipsGradient: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  viewMembershipsBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  paymentSection: {
    marginTop: 8,
  },
  sectionLabel: {
    fontWeight: '600',
    marginBottom: 8,
    color: '#000',
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginBottom: 8,
  },
  paymentRowActive: {
    borderColor: '#9BDDFF',
    backgroundColor: 'rgba(155,221,255,0.1)',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#ccc',
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioActive: {
    borderColor: '#9BDDFF',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#9BDDFF',
  },
  paymentName: {
    fontWeight: '500',
    color: '#000',
  },
  paymentSub: {
    fontSize: 12,
    color: '#666',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  reserveBtn: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  reserveBtnDisabled: {
    opacity: 0.5,
  },
  reserveGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  reserveText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  dropInCard: {
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.3)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginTop: 8,
  },
  dropInIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  dropInTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  dropInPrice: {
    fontSize: 24,
    fontWeight: '800',
    color: '#000',
    marginBottom: 8,
  },
  dropInDesc: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
});
