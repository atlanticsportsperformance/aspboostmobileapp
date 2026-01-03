import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import {
  getPublicEvents,
  getPublicCategories,
  getPublicOrganizations,
  createAccount,
  checkEmailExists,
  formatPrice,
  PublicEvent,
  PublicCategory,
  Organization,
  NewAccountData,
} from '../lib/publicBookingApi';

type FlowStep = 'events' | 'event_details' | 'account_type' | 'account_form' | 'success';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PublicBookingScreen({ navigation }: any) {
  // Flow state
  const [step, setStep] = useState<FlowStep>('events');
  const [loading, setLoading] = useState(true);

  // Organization state
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);

  // Events state
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [weekDates, setWeekDates] = useState<Date[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Selected event
  const [selectedEvent, setSelectedEvent] = useState<PublicEvent | null>(null);

  // Account creation state
  const [accountType, setAccountType] = useState<'athlete' | 'parent'>('athlete');

  // Parent fields (if parent account)
  const [parentFirstName, setParentFirstName] = useState('');
  const [parentLastName, setParentLastName] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [parentPhone, setParentPhone] = useState('');

  // Athlete fields
  const [athleteFirstName, setAthleteFirstName] = useState('');
  const [athleteLastName, setAthleteLastName] = useState('');
  const [athleteEmail, setAthleteEmail] = useState('');
  const [athletePhone, setAthletePhone] = useState('');
  const [athleteDob, setAthleteDob] = useState('');
  const [athleteSex, setAthleteSex] = useState<'M' | 'F'>('M');
  const [athletePlayLevel, setAthletePlayLevel] = useState('');

  // Password
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    initializePublicBooking();
    generateWeekDates(selectedDate);
  }, []);

  useEffect(() => {
    generateWeekDates(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (selectedOrg) {
      fetchEvents();
      fetchCategories();
    }
  }, [selectedOrg, selectedDate]);

  const initializePublicBooking = async () => {
    try {
      const orgs = await getPublicOrganizations();
      setOrganizations(orgs);

      // Auto-select if only one org
      if (orgs.length === 1) {
        setSelectedOrg(orgs[0]);
      } else if (orgs.length > 0) {
        // For now, just select the first one
        setSelectedOrg(orgs[0]);
      }
    } catch (error) {
      console.error('Error initializing:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateWeekDates = (centerDate: Date) => {
    const dates: Date[] = [];
    const startOfWeek = new Date(centerDate);
    startOfWeek.setDate(centerDate.getDate() - centerDate.getDay());

    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      dates.push(date);
    }

    setWeekDates(dates);
  };

  const fetchEvents = async () => {
    if (!selectedOrg) return;

    setLoadingEvents(true);
    try {
      // Fetch events for the selected date
      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);

      const eventsData = await getPublicEvents(selectedOrg.id, startOfDay, endOfDay);
      setEvents(eventsData);
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setLoadingEvents(false);
    }
  };

  const fetchCategories = async () => {
    if (!selectedOrg) return;

    try {
      const cats = await getPublicCategories(selectedOrg.id);
      setCategories(cats);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate);
    newDate.setDate(selectedDate.getDate() + (direction === 'next' ? 7 : -7));
    setSelectedDate(newDate);
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const isSameDay = (date1: Date, date2: Date) => {
    return (
      date1.getDate() === date2.getDate() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getFullYear() === date2.getFullYear()
    );
  };

  const getMonthYearDisplay = () => {
    return selectedDate.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  };

  const handleEventSelect = (event: PublicEvent) => {
    if (event.spotsAvailable <= 0) {
      Alert.alert('Class Full', 'This class is currently full. Please select another time.');
      return;
    }
    setSelectedEvent(event);
    setStep('event_details');
  };

  const handleBookNow = () => {
    setStep('account_type');
  };

  const handleAccountTypeSelect = (type: 'athlete' | 'parent') => {
    setAccountType(type);
    setStep('account_form');
  };

  const validateAccountForm = (): string | null => {
    // Validate parent fields if parent account
    if (accountType === 'parent') {
      if (!parentFirstName.trim() || !parentLastName.trim() || !parentEmail.trim()) {
        return 'Please enter your full name and email';
      }
      if (!parentEmail.includes('@')) {
        return 'Please enter a valid parent email address';
      }
    }

    // Validate athlete fields
    if (!athleteFirstName.trim() || !athleteLastName.trim() || !athleteEmail.trim()) {
      return 'Please enter athlete full name and email';
    }
    if (!athleteEmail.includes('@')) {
      return 'Please enter a valid athlete email address';
    }
    if (!athleteDob) {
      return 'Please enter athlete birth date';
    }
    if (!athletePlayLevel) {
      return 'Please select athlete play level';
    }

    // Validate password
    if (!password || password.length < 8) {
      return 'Password must be at least 8 characters';
    }
    if (password !== confirmPassword) {
      return 'Passwords do not match';
    }

    return null;
  };

  const handleAccountFormSubmit = async () => {
    const validationError = validateAccountForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    // Check if email exists
    const emailToCheck = accountType === 'parent' ? parentEmail : athleteEmail;
    const emailExists = await checkEmailExists(emailToCheck);
    if (emailExists) {
      setError('An account with this email already exists. Please sign in instead.');
      return;
    }

    await processAccountAndBooking();
  };

  const processAccountAndBooking = async () => {
    if (!selectedEvent) return;

    setProcessing(true);
    setError('');

    try {
      // Check if drop-in is allowed (dropInPriceCents should not be null for public booking)
      const priceInCents = selectedEvent.dropInPriceCents;

      // Safety check: if dropInPriceCents is null, this event requires membership (shouldn't happen in public booking)
      if (priceInCents === null || priceInCents === undefined) {
        Alert.alert(
          'Membership Required',
          'This class requires an active membership. Please contact the facility for more information.'
        );
        setProcessing(false);
        return;
      }

      const requiresPayment = priceInCents > 0;

      if (requiresPayment) {
        // TODO: Implement Stripe payment
        // For now, show coming soon message and don't create the account
        Alert.alert(
          'Payment Required',
          `This class costs ${formatPrice(priceInCents)}. Online payment is coming soon! Please contact the facility to complete your booking.`
        );
        setProcessing(false);
        return;
      }

      // Prepare account data matching the /api/public/book API structure
      const accountData: NewAccountData = {
        accountType,
        eventId: selectedEvent.id, // Required for booking
        // Parent fields (if parent account)
        parentEmail: accountType === 'parent' ? parentEmail.trim().toLowerCase() : undefined,
        parentFirstName: accountType === 'parent' ? parentFirstName.trim() : undefined,
        parentLastName: accountType === 'parent' ? parentLastName.trim() : undefined,
        parentPhone: accountType === 'parent' ? parentPhone.trim() || undefined : undefined,
        // Athlete fields
        athleteEmail: athleteEmail.trim().toLowerCase(),
        athleteFirstName: athleteFirstName.trim(),
        athleteLastName: athleteLastName.trim(),
        athletePhone: athletePhone.trim() || undefined,
        athleteDob: athleteDob.trim(),
        athletePlayLevel,
        // Password
        password,
      };

      // Create account AND book the event in one API call
      const result = await createAccount(accountData);

      if (!result.success) {
        setError(result.error || 'Failed to create account and booking');
        setProcessing(false);
        return;
      }

      // Success! Account created and booking confirmed
      setStep('success');
    } catch (error) {
      console.error('Error processing:', error);
      setError('An unexpected error occurred');
    } finally {
      setProcessing(false);
    }
  };

  const handleSuccessContinue = () => {
    // Navigate to dashboard (user should already be signed in from createAccount)
    const dashboard = accountType === 'parent' ? 'ParentDashboard' : 'Dashboard';
    navigation.replace(dashboard);
  };

  // Filter events by category
  const filteredEvents =
    selectedCategory === 'all'
      ? events
      : events.filter((e) => e.category === selectedCategory);

  // Available categories (only those with events)
  const availableCategories = categories.filter((cat) =>
    events.some((e) => e.category === cat.name)
  );

  // Loading state
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9BDDFF" />
          <Text style={styles.loadingText}>Loading available classes...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Render based on current step
  const renderStep = () => {
    switch (step) {
      case 'events':
        return renderEventsStep();
      case 'event_details':
        return renderEventDetailsStep();
      case 'account_type':
        return renderAccountTypeStep();
      case 'account_form':
        return renderAccountFormStep();
      case 'success':
        return renderSuccessStep();
      default:
        return renderEventsStep();
    }
  };

  const renderEventsStep = () => (
    <>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#9BDDFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Book a Session</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      {/* Month Navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity style={styles.navArrow} onPress={() => navigateWeek('prev')}>
          <Text style={styles.navArrowText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthText}>{getMonthYearDisplay()}</Text>
        <TouchableOpacity style={styles.navArrow} onPress={() => navigateWeek('next')}>
          <Text style={styles.navArrowText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Week Date Picker */}
      <View style={styles.weekPicker}>
        {weekDates.map((date, index) => {
          const isSelected = isSameDay(date, selectedDate);
          const isTodayDate = isToday(date);
          const isPast = date < new Date() && !isToday(date);

          return (
            <TouchableOpacity
              key={index}
              style={[styles.dateButton, isPast && styles.dateButtonPast]}
              onPress={() => !isPast && setSelectedDate(date)}
              activeOpacity={isPast ? 1 : 0.7}
              disabled={isPast}
            >
              {isSelected ? (
                <LinearGradient
                  colors={['#9BDDFF', '#7BC5F0']}
                  style={styles.dateButtonSelected}
                >
                  <Text style={styles.dayNameSelected}>{DAY_NAMES[index]}</Text>
                  <Text style={styles.dayNumberSelected}>{date.getDate()}</Text>
                </LinearGradient>
              ) : (
                <View style={styles.dateButtonInner}>
                  <Text style={[styles.dayName, isPast && styles.dayNamePast]}>
                    {DAY_NAMES[index]}
                  </Text>
                  <Text style={[styles.dayNumber, isPast && styles.dayNumberPast]}>
                    {date.getDate()}
                  </Text>
                  {isTodayDate && <View style={styles.todayDot} />}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Category Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoryScroll}
        contentContainerStyle={styles.categoryContent}
      >
        <TouchableOpacity
          style={[styles.categoryPill, selectedCategory === 'all' && styles.categoryPillSelected]}
          onPress={() => setSelectedCategory('all')}
        >
          {selectedCategory === 'all' ? (
            <LinearGradient colors={['#9BDDFF', '#7BC5F0']} style={styles.categoryPillGradient}>
              <Text style={styles.categoryTextSelected}>All</Text>
            </LinearGradient>
          ) : (
            <Text style={styles.categoryText}>All</Text>
          )}
        </TouchableOpacity>

        {availableCategories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[styles.categoryPill, selectedCategory === cat.name && styles.categoryPillSelected]}
            onPress={() => setSelectedCategory(cat.name)}
          >
            {selectedCategory === cat.name ? (
              <LinearGradient colors={['#9BDDFF', '#7BC5F0']} style={styles.categoryPillGradient}>
                <Text style={styles.categoryTextSelected}>{cat.name}</Text>
              </LinearGradient>
            ) : (
              <Text style={styles.categoryText}>{cat.name}</Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Events List */}
      <ScrollView style={styles.eventsList} contentContainerStyle={styles.eventsContent}>
        {loadingEvents ? (
          <View style={styles.eventsLoading}>
            <ActivityIndicator size="small" color="#9BDDFF" />
          </View>
        ) : filteredEvents.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={48} color="rgba(255,255,255,0.3)" />
            <Text style={styles.emptyText}>No classes available for this date</Text>
            <Text style={styles.emptySubtext}>Try selecting a different day</Text>
          </View>
        ) : (
          filteredEvents.map((event) => (
            <TouchableOpacity
              key={event.id}
              style={[styles.eventCard, event.spotsAvailable <= 0 && styles.eventCardFull]}
              onPress={() => handleEventSelect(event)}
              activeOpacity={0.8}
            >
              <View style={styles.eventTimeColumn}>
                <Text style={styles.eventTime}>
                  {event.startTime.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
                <Text style={styles.eventDuration}>{event.durationMinutes} min</Text>
              </View>

              <View style={styles.eventDetails}>
                <Text style={styles.eventTitle}>{event.title}</Text>
                <Text style={styles.eventCoach}>with {event.coachName}</Text>
                <View style={styles.eventMeta}>
                  <Text style={styles.eventLocation}>{event.location}</Text>
                  {event.category && (
                    <View style={[styles.categoryBadge, { backgroundColor: event.categoryColor || '#9BDDFF' }]}>
                      <Text style={styles.categoryBadgeText}>{event.category}</Text>
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.eventRight}>
                <Text style={[styles.eventPrice, event.dropInPriceCents === 0 && styles.eventPriceFree]}>
                  {formatPrice(event.dropInPriceCents)}
                </Text>
                <Text style={[styles.eventSpots, event.spotsAvailable <= 3 && styles.eventSpotsLow]}>
                  {event.spotsAvailable <= 0
                    ? 'Full'
                    : `${event.spotsAvailable} spot${event.spotsAvailable === 1 ? '' : 's'}`}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Already have account link */}
      <View style={styles.bottomLink}>
        <Text style={styles.bottomLinkText}>Already have an account? </Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.bottomLinkAction}>Sign In</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const renderEventDetailsStep = () => {
    if (!selectedEvent) return null;

    return (
      <>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => setStep('events')}>
            <Ionicons name="arrow-back" size={24} color="#9BDDFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Class Details</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <ScrollView style={styles.detailsScroll} contentContainerStyle={styles.detailsContent}>
          {/* Event Card */}
          <View style={styles.detailsCard}>
            <Text style={styles.detailsTitle}>{selectedEvent.title}</Text>
            <Text style={styles.detailsCoach}>with {selectedEvent.coachName}</Text>

            <View style={styles.detailsRow}>
              <Ionicons name="calendar-outline" size={20} color="#9CA3AF" />
              <Text style={styles.detailsText}>
                {selectedEvent.startTime.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </Text>
            </View>

            <View style={styles.detailsRow}>
              <Ionicons name="time-outline" size={20} color="#9CA3AF" />
              <Text style={styles.detailsText}>
                {selectedEvent.startTime.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {' - '}
                {selectedEvent.endTime.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {' '}({selectedEvent.durationMinutes} min)
              </Text>
            </View>

            <View style={styles.detailsRow}>
              <Ionicons name="location-outline" size={20} color="#9CA3AF" />
              <Text style={styles.detailsText}>
                {selectedEvent.location}
                {selectedEvent.resource && ` - ${selectedEvent.resource}`}
              </Text>
            </View>

            <View style={styles.detailsRow}>
              <Ionicons name="people-outline" size={20} color="#9CA3AF" />
              <Text style={styles.detailsText}>
                {selectedEvent.spotsAvailable} of {selectedEvent.capacity} spots available
              </Text>
            </View>
          </View>

          {/* Price Card */}
          <View style={styles.priceCard}>
            <Text style={styles.priceLabel}>Session Price</Text>
            <Text style={styles.priceValue}>{formatPrice(selectedEvent.dropInPriceCents)}</Text>
            {selectedEvent.dropInPriceCents === 0 && (
              <Text style={styles.priceNote}>No payment required</Text>
            )}
          </View>
        </ScrollView>

        {/* Book Button */}
        <View style={styles.bottomActions}>
          <TouchableOpacity style={styles.bookButton} onPress={handleBookNow} activeOpacity={0.9}>
            <LinearGradient colors={['#9BDDFF', '#7BC5F0']} style={styles.bookButtonGradient}>
              <Text style={styles.bookButtonText}>Book Now</Text>
              <Ionicons name="arrow-forward" size={20} color="#000" />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </>
    );
  };

  const renderAccountTypeStep = () => (
    <>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => setStep('event_details')}>
          <Ionicons name="arrow-back" size={24} color="#9BDDFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Account</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <View style={styles.accountTypeContainer}>
        <Text style={styles.accountTypeTitle}>Who is booking?</Text>
        <Text style={styles.accountTypeSubtitle}>Select the type of account to create</Text>

        <TouchableOpacity
          style={styles.accountTypeCard}
          onPress={() => handleAccountTypeSelect('athlete')}
          activeOpacity={0.8}
        >
          <View style={styles.accountTypeIcon}>
            <Ionicons name="person" size={32} color="#9BDDFF" />
          </View>
          <View style={styles.accountTypeInfo}>
            <Text style={styles.accountTypeCardTitle}>I'm booking for myself</Text>
            <Text style={styles.accountTypeCardDesc}>Create an athlete account</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#9CA3AF" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.accountTypeCard}
          onPress={() => handleAccountTypeSelect('parent')}
          activeOpacity={0.8}
        >
          <View style={styles.accountTypeIcon}>
            <Ionicons name="people" size={32} color="#9BDDFF" />
          </View>
          <View style={styles.accountTypeInfo}>
            <Text style={styles.accountTypeCardTitle}>I'm booking for my child</Text>
            <Text style={styles.accountTypeCardDesc}>Create a parent account</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#9CA3AF" />
        </TouchableOpacity>
      </View>
    </>
  );

  const PLAY_LEVELS = [
    { value: 'Youth', label: 'Youth' },
    { value: 'High School', label: 'High School' },
    { value: 'College', label: 'College' },
    { value: 'Pro', label: 'Pro' },
  ];

  const renderAccountFormStep = () => (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => setStep('account_type')}>
          <Ionicons name="arrow-back" size={24} color="#9BDDFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Account</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView style={styles.formScroll} contentContainerStyle={styles.formContent}>
        {error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={20} color="#EF4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Parent Information Section (only for parent accounts) */}
        {accountType === 'parent' && (
          <>
            <Text style={styles.formSectionTitle}>Parent/Guardian Information</Text>

            <View style={styles.inputRow}>
              <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.inputLabel}>First Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="First"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={parentFirstName}
                  onChangeText={setParentFirstName}
                  textContentType="givenName"
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
                <Text style={styles.inputLabel}>Last Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Last"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={parentLastName}
                  onChangeText={setParentLastName}
                  textContentType="familyName"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email Address *</Text>
              <TextInput
                style={styles.input}
                placeholder="parent@example.com"
                placeholderTextColor="rgba(255,255,255,0.4)"
                value={parentEmail}
                onChangeText={setParentEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType="emailAddress"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Phone (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="(555) 123-4567"
                placeholderTextColor="rgba(255,255,255,0.4)"
                value={parentPhone}
                onChangeText={setParentPhone}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
              />
            </View>

            <View style={styles.sectionDivider} />
          </>
        )}

        {/* Athlete Information Section */}
        <Text style={styles.formSectionTitle}>
          {accountType === 'parent' ? 'Athlete Information' : 'Your Information'}
        </Text>

        <View style={styles.inputRow}>
          <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
            <Text style={styles.inputLabel}>First Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="First"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={athleteFirstName}
              onChangeText={setAthleteFirstName}
              textContentType="givenName"
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
            <Text style={styles.inputLabel}>Last Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Last"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={athleteLastName}
              onChangeText={setAthleteLastName}
              textContentType="familyName"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Email Address *</Text>
          <TextInput
            style={styles.input}
            placeholder="athlete@example.com"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={athleteEmail}
            onChangeText={setAthleteEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
          />
        </View>

        {accountType === 'athlete' && (
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Phone (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="(555) 123-4567"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={athletePhone}
              onChangeText={setAthletePhone}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
            />
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Date of Birth *</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={athleteDob}
            onChangeText={setAthleteDob}
            keyboardType="numbers-and-punctuation"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Sex *</Text>
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[
                styles.segmentButton,
                athleteSex === 'M' && styles.segmentButtonActive,
              ]}
              onPress={() => setAthleteSex('M')}
            >
              <Text
                style={[
                  styles.segmentButtonText,
                  athleteSex === 'M' && styles.segmentButtonTextActive,
                ]}
              >
                Male
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.segmentButton,
                athleteSex === 'F' && styles.segmentButtonActive,
              ]}
              onPress={() => setAthleteSex('F')}
            >
              <Text
                style={[
                  styles.segmentButtonText,
                  athleteSex === 'F' && styles.segmentButtonTextActive,
                ]}
              >
                Female
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Play Level *</Text>
          <View style={styles.playLevelContainer}>
            {PLAY_LEVELS.map((level) => (
              <TouchableOpacity
                key={level.value}
                style={[
                  styles.playLevelPill,
                  athletePlayLevel === level.value && styles.playLevelPillActive,
                ]}
                onPress={() => setAthletePlayLevel(level.value)}
              >
                <Text
                  style={[
                    styles.playLevelText,
                    athletePlayLevel === level.value && styles.playLevelTextActive,
                  ]}
                >
                  {level.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.sectionDivider} />

        {/* Password Section */}
        <Text style={styles.formSectionTitle}>Set Password</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Password *</Text>
          <TextInput
            style={styles.input}
            placeholder="At least 8 characters"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="newPassword"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Confirm Password *</Text>
          <TextInput
            style={styles.input}
            placeholder="Re-enter password"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            textContentType="newPassword"
          />
        </View>

        {/* Extra padding at bottom for keyboard */}
        <View style={{ height: 40 }} />
      </ScrollView>

      <View style={styles.bottomActions}>
        <TouchableOpacity
          style={[styles.bookButton, processing && styles.buttonDisabled]}
          onPress={handleAccountFormSubmit}
          disabled={processing}
          activeOpacity={0.9}
        >
          <LinearGradient colors={['#9BDDFF', '#7BC5F0']} style={styles.bookButtonGradient}>
            {processing ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <>
                <Text style={styles.bookButtonText}>Create Account & Book</Text>
                <Ionicons name="arrow-forward" size={20} color="#000" />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );

  const renderSuccessStep = () => (
    <View style={styles.successContainer}>
      <View style={styles.successIcon}>
        <LinearGradient colors={['#9BDDFF', '#7BC5F0']} style={styles.successIconGradient}>
          <Ionicons name="checkmark" size={64} color="#000" />
        </LinearGradient>
      </View>

      <Text style={styles.successTitle}>Booking Confirmed!</Text>
      <Text style={styles.successSubtitle}>
        Your account has been created and you're all set for your session.
      </Text>

      {selectedEvent && (
        <View style={styles.successEventCard}>
          <Text style={styles.successEventTitle}>{selectedEvent.title}</Text>
          <Text style={styles.successEventTime}>
            {selectedEvent.startTime.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
            {' at '}
            {selectedEvent.startTime.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
          <Text style={styles.successEventLocation}>{selectedEvent.location}</Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.successButton}
        onPress={handleSuccessContinue}
        activeOpacity={0.9}
      >
        <LinearGradient colors={['#9BDDFF', '#7BC5F0']} style={styles.successButtonGradient}>
          <Text style={styles.successButtonText}>Continue to App</Text>
          <Ionicons name="arrow-forward" size={20} color="#000" />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {renderStep()}
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
    marginTop: 12,
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
    color: '#FFFFFF',
  },
  headerPlaceholder: {
    width: 40,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 24,
  },
  navArrow: {
    width: 32,
    height: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navArrowText: {
    fontSize: 20,
    color: '#FFFFFF',
    fontWeight: '300',
  },
  monthText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  weekPicker: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  dateButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  dateButtonPast: {
    opacity: 0.4,
  },
  dateButtonInner: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    minWidth: 44,
  },
  dateButtonSelected: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    minWidth: 44,
  },
  dayName: {
    fontSize: 10,
    fontWeight: '500',
    color: '#9CA3AF',
    marginBottom: 4,
  },
  dayNameSelected: {
    fontSize: 10,
    fontWeight: '500',
    color: '#0A0A0A',
    marginBottom: 4,
  },
  dayNamePast: {
    color: '#4B5563',
  },
  dayNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dayNumberSelected: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0A0A0A',
  },
  dayNumberPast: {
    color: '#4B5563',
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#9BDDFF',
    marginTop: 4,
  },
  categoryScroll: {
    flexGrow: 0,
    marginBottom: 16,
  },
  categoryContent: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 8,
    alignItems: 'center',
  },
  categoryPill: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  categoryPillSelected: {
    borderWidth: 0,
  },
  categoryPillGradient: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  categoryText: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 13,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  categoryTextSelected: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0A0A0A',
  },
  eventsList: {
    flex: 1,
  },
  eventsContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  eventsLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyState: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500',
  },
  emptySubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  eventCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  eventCardFull: {
    opacity: 0.5,
  },
  eventTimeColumn: {
    width: 70,
    marginRight: 16,
  },
  eventTime: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  eventDuration: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  eventDetails: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  eventCoach: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 8,
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  eventLocation: {
    fontSize: 12,
    color: '#6B7280',
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#000',
  },
  eventRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 12,
  },
  eventPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  eventPriceFree: {
    color: '#10B981',
  },
  eventSpots: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  eventSpotsLow: {
    color: '#F59E0B',
  },
  bottomLink: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  bottomLinkText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  bottomLinkAction: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9BDDFF',
  },
  // Event Details Step
  detailsScroll: {
    flex: 1,
  },
  detailsContent: {
    padding: 16,
  },
  detailsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  detailsTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  detailsCoach: {
    fontSize: 16,
    color: '#9BDDFF',
    marginBottom: 20,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  detailsText: {
    fontSize: 15,
    color: '#FFFFFF',
    flex: 1,
  },
  priceCard: {
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.2)',
  },
  priceLabel: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  priceValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#9BDDFF',
  },
  priceNote: {
    fontSize: 13,
    color: '#10B981',
    marginTop: 4,
  },
  bottomActions: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  bookButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  bookButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  bookButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  // Account Type Step
  accountTypeContainer: {
    flex: 1,
    padding: 24,
  },
  accountTypeTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  accountTypeSubtitle: {
    fontSize: 15,
    color: '#9CA3AF',
    marginBottom: 32,
  },
  accountTypeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  accountTypeIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  accountTypeInfo: {
    flex: 1,
  },
  accountTypeCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  accountTypeCardDesc: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  // Form Steps
  formScroll: {
    flex: 1,
  },
  formContent: {
    padding: 16,
  },
  formSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: '#EF4444',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFFFFF',
  },
  inputRow: {
    flexDirection: 'row',
  },
  // Success Step
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  successIcon: {
    marginBottom: 24,
  },
  successIconGradient: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 16,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  successEventCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  successEventTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  successEventTime: {
    fontSize: 15,
    color: '#9BDDFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  successEventLocation: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  successButton: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  successButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  successButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  // Section Divider
  sectionDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 24,
  },
  // Segmented Control for Sex selection
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentButtonActive: {
    backgroundColor: '#9BDDFF',
  },
  segmentButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  segmentButtonTextActive: {
    color: '#000',
    fontWeight: '600',
  },
  // Play Level Pills
  playLevelContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  playLevelPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  playLevelPillActive: {
    backgroundColor: '#9BDDFF',
    borderColor: '#9BDDFF',
  },
  playLevelText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  playLevelTextActive: {
    color: '#000',
    fontWeight: '600',
  },
});
