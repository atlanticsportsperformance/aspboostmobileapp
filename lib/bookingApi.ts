import { supabase } from './supabase';
import {
  BookableEvent,
  LinkedAthlete,
  PaymentMethod,
  EligibilityData,
  Membership,
  Package,
  SchedulingCategory,
  getAthleteColor,
} from '../types/booking';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app';

/**
 * The ONE source of truth for what an athlete can book on a given day.
 *
 * This replaces two hand-rolled `scheduling_events` queries that between them
 * hardcoded eligibility to always-true, never filtered `is_public`, duplicated
 * the booking-window math the server already does, and labelled every session
 * "Main Facility" — including P3's remote video calls.
 */
const toDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function fetchBookableEventsForDate(
  athleteId: string,
  date: Date,
  endDate?: Date
): Promise<BookableEvent[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return [];

  const dateStr = toDateStr(date);
  const endParam = endDate ? `&end=${toDateStr(endDate)}` : '';

  const response = await fetch(
    `${API_URL}/api/athletes/${athleteId}/bookable-events?date=${dateStr}${endParam}`,
    { headers: { Authorization: `Bearer ${session.access_token}` } }
  );

  if (!response.ok) {
    console.error('[bookingApi] bookable-events failed:', response.status);
    return [];
  }

  const data = await response.json();

  return (data.events || []).map((e: any) => {
    const startTime = new Date(e.start_time);
    const endTime = new Date(e.end_time);
    return {
      id: e.id,
      title: e.title,
      startTime,
      endTime,
      coachName: e.coach_name || 'Staff',
      coachAvatar: e.coach_avatar || null,
      // No building-name fallback: the server already decides, and it returns
      // null for a remote session rather than naming a building it never uses.
      location: e.location,
      resource: null,
      category: e.category || null,
      durationMinutes: e.duration_minutes,
      capacity: e.capacity,
      bookedCount: e.booked_count || 0,
      isBooked: e.is_booked === true,
      isEligible: e.eligible !== false,
      ineligibleReason: e.ineligible_reason || null,
      ineligibleMessage: e.ineligible_message || null,
      paymentRequiredCents: e.payment_required_cents ?? null,
      paymentSource: e.payment_source || null,
      requiredMembershipTypeNames: e.required_membership_type_names || [],
      isRemote: e.is_remote === true,
      meetingUrl: e.meeting_url || null,
      eventTemplateId: e.event_template_id,
      categoryId: e.category_id || null,
      bookingWindowBlocked: e.booking_window_blocked === true,
      bookingWindowReason: e.booking_window_reason || null,
    };
  });
}

/**
 * Get linked athletes for a parent account
 * Note: athlete_guardians.athlete_id can reference either:
 * - profiles.id (if athlete has a user account)
 * - athletes.id directly (if athlete doesn't have a user account)
 * We check both to ensure all linked athletes are found.
 */
export async function getLinkedAthletes(guardianId: string): Promise<LinkedAthlete[]> {
  const { data: links, error } = await supabase
    .from('athlete_guardians')
    .select(`
      athlete_id,
      athlete:profiles!athlete_guardians_athlete_id_fkey(
        id,
        first_name,
        last_name,
        email
      )
    `)
    .eq('guardian_id', guardianId);

  if (error) {
    console.error('Error fetching linked athletes:', error);
    return [];
  }

  const athletes: LinkedAthlete[] = [];

  for (let i = 0; i < (links || []).length; i++) {
    const link = links[i];
    const profileData = link.athlete as any;

    // Try to find athlete record by user_id first (if athlete_guardians.athlete_id is profile id)
    let athleteTableId: string | null = null;
    let firstName = '';
    let lastName = '';
    let email = '';
    let profileId = '';

    if (profileData) {
      // Profile exists - athlete has a user account
      profileId = profileData.id;
      firstName = profileData.first_name || '';
      lastName = profileData.last_name || '';
      email = profileData.email || '';

      const { data: athleteByUserId } = await supabase
        .from('athletes')
        .select('id')
        .eq('user_id', profileData.id)
        .maybeSingle();

      if (athleteByUserId) {
        athleteTableId = athleteByUserId.id;
      }
    }

    // If we didn't find athlete by user_id, try direct lookup
    if (!athleteTableId && link.athlete_id) {
      const { data: athleteDirectLookup } = await supabase
        .from('athletes')
        .select('id, first_name, last_name, email, user_id')
        .eq('id', link.athlete_id)
        .maybeSingle();

      if (athleteDirectLookup) {
        athleteTableId = athleteDirectLookup.id;
        // If we didn't get profile data, use athlete table data
        if (!profileData) {
          firstName = athleteDirectLookup.first_name || '';
          lastName = athleteDirectLookup.last_name || '';
          email = athleteDirectLookup.email || '';
          profileId = athleteDirectLookup.user_id || athleteDirectLookup.id;
        }
      }
    }

    if (athleteTableId) {
      athletes.push({
        id: profileId,
        athleteId: athleteTableId,
        firstName,
        lastName,
        email,
        color: getAthleteColor(i),
      });
    }
  }

  return athletes;
}

/**
 * Get athlete ID for a user
 */
export async function getAthleteId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('athletes')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    console.error('Error fetching athlete ID:', error);
    return null;
  }

  return data.id;
}

/**
 * Get bookable events for a specific date
 */
export async function getBookableEvents(athleteId: string, date: Date): Promise<BookableEvent[]> {
  try {
    return await fetchBookableEventsForDate(athleteId, date);
  } catch (error) {
    console.error('[bookingApi] getBookableEvents failed:', error);
    return [];
  }
}

/**
 * Get bookable events for an entire week
 */
export async function getBookableEventsForWeek(
  athleteId: string,
  weekDates: Date[]
): Promise<BookableEvent[]> {
  try {
    if (weekDates.length === 0) return [];
    // One request for the whole range — the route accepts an inclusive `end`.
    const sorted = [...weekDates].sort((a, b) => a.getTime() - b.getTime());
    const events = await fetchBookableEventsForDate(
      athleteId,
      sorted[0],
      sorted[sorted.length - 1]
    );
    return events.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  } catch (error) {
    console.error('[bookingApi] getBookableEventsForWeek failed:', error);
    return [];
  }
}

/**
 * Get categories for filter pills
 */
export async function getCategories(orgId: string): Promise<SchedulingCategory[]> {
  const { data, error } = await supabase
    .from('scheduling_categories')
    .select('id, name, color, is_public')
    .eq('org_id', orgId)
    .eq('is_public', true)
    .order('name');

  if (error) {
    console.error('Error fetching categories:', error);
    return [];
  }

  return (data || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    color: c.color || '#9BDDFF',
    isPublic: c.is_public,
  }));
}

/**
 * Check eligibility for booking an event
 */
export async function checkEligibility(
  athleteId: string,
  eventId: string
): Promise<EligibilityData> {
  // Get athlete data including restriction tags
  const { data: athlete } = await supabase
    .from('athletes')
    .select('restriction_tag_ids, org_id')
    .eq('id', athleteId)
    .single();

  // Get event template to check required restrictions AND drop-in price
  const { data: event } = await supabase
    .from('scheduling_events')
    .select(`
      event_template_id,
      template:scheduling_templates(
        required_restriction_tag_ids,
        drop_in_price_cents
      )
    `)
    .eq('id', eventId)
    .single();

  // Handle template - could be object or array depending on Supabase response
  const rawTemplate = event?.template;
  const template = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;
  const requiredTags = template?.required_restriction_tag_ids || [];
  const athleteTags = athlete?.restriction_tag_ids || [];
  const dropInPriceCents = template?.drop_in_price_cents ?? null;

  // Check for missing restriction tags
  const missingTagIds = requiredTags.filter((t: string) => !athleteTags.includes(t));

  if (missingTagIds.length > 0) {
    // Fetch tag names
    const { data: tags } = await supabase
      .from('restriction_tags')
      .select('name, description')
      .in('id', missingTagIds);

    return {
      canBook: false,
      sourceType: 'blocked',
      sourceId: null,
      reason: 'Missing required restrictions',
      remainingVisits: null,
      missingRestrictions: (tags || []).map((t: any) => ({
        name: t.name,
        description: t.description || '',
      })),
      dropInPriceCents: null,
    };
  }

  // Check for active memberships or packages first
  const paymentMethods = await getPaymentMethods(athleteId, eventId);

  // If user has membership/package, use that
  if (paymentMethods.length > 0) {
    return {
      canBook: true,
      sourceType: paymentMethods[0].type,
      sourceId: paymentMethods[0].id,
      reason: null,
      remainingVisits: paymentMethods[0].remainingSessions,
      missingRestrictions: null,
      dropInPriceCents: null,
    };
  }

  // No membership/package - check if drop-in is available
  if (dropInPriceCents !== null && dropInPriceCents !== undefined) {
    const isFree = dropInPriceCents === 0;
    return {
      canBook: true,
      sourceType: 'drop_in',
      sourceId: null,
      reason: isFree ? 'Free session' : `Drop-in: $${(dropInPriceCents / 100).toFixed(2)}`,
      remainingVisits: null,
      missingRestrictions: null,
      dropInPriceCents,
    };
  }

  // No eligibility at all
  return {
    canBook: false,
    sourceType: null,
    sourceId: null,
    reason: 'No active membership or package',
    remainingVisits: null,
    missingRestrictions: null,
    dropInPriceCents: null,
  };
}

/**
 * Get available payment methods (memberships and packages)
 * Only returns packages/memberships that are entitled to book the specific event
 */
export async function getPaymentMethods(
  athleteId: string,
  eventId: string
): Promise<PaymentMethod[]> {
  try {
    // Get auth token
    const { data: { session } } = await supabase.auth.getSession();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(
      `${API_URL}/api/schedule/athlete-payment-options?event_id=${eventId}&athlete_id=${athleteId}`,
      { headers }
    );

    if (!response.ok) {
      console.error('[getPaymentMethods] API error:', response.status);
      return [];
    }

    const data = await response.json();

    // API may return an array directly or an object with an options/data property
    const options = Array.isArray(data) ? data : (Array.isArray(data?.options) ? data.options : []);

    // Filter to only membership/package types — drop-in pricing is handled
    // separately via checkEligibility() from the event template
    return options
    .filter((opt: any) => opt.type === 'membership' || opt.type === 'package')
    .map((opt: any) => ({
      id: opt.id,
      type: opt.type as 'membership' | 'package' | 'drop_in',
      name: opt.label || opt.name || 'Unknown',
      subtitle: opt.description || '',  // "7 of 8 visits remaining" or "Unlimited visits"
      expiryDate: null,
      remainingSessions: opt.remaining_visits ?? null,  // -1 = unlimited, null = unknown
    }));
  } catch (error) {
    console.error('[getPaymentMethods] Error:', error);
    return [];
  }
}


/**
 * Create a booking via server API
 * Supports membership, package, and FREE drop-in bookings
 * The API handles:
 * - Eligibility validation
 * - Capacity checks
 * - Per-service usage tracking via counter_id for packages
 * - Credit consumption
 * NOTE: Paid drop-ins are handled via Stripe Payment Sheet, not through this function
 */
export async function createBooking(
  athleteId: string,
  eventId: string,
  paymentType: 'membership' | 'package' | 'drop_in',
  paymentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get auth token
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { success: false, error: 'Please log in to book a class' };
    }

    const url = `${API_URL}/api/athletes/${athleteId}/bookings`;
    const body = {
      event_id: eventId,
      payment_type: paymentType,
      payment_id: paymentType === 'drop_in' ? null : paymentId,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to create booking' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error creating booking:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Cancel a booking via server API
 * The API handles:
 * - Package session refunds (if within refund window)
 * - Paid drop-in Stripe refunds (if within refund window)
 * - Booking deletion
 */
export async function cancelBooking(
  athleteId: string,
  eventId: string,
  reason?: string
): Promise<{ success: boolean; error?: string; refunded?: boolean; refundAmount?: number }> {
  try {
    // Get auth token
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { success: false, error: 'Please log in to cancel booking' };
    }

    const response = await fetch(`${API_URL}/api/athletes/${athleteId}/bookings`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        event_id: eventId,
        reason,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to cancel booking' };
    }

    return {
      success: true,
      refunded: data.refunded,
      refundAmount: data.refund_amount,
    };
  } catch (error) {
    console.error('Error in cancelBooking:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}
