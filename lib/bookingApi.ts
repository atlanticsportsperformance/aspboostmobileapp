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
export async function getBookableEvents(
  athleteId: string,
  date: Date
): Promise<BookableEvent[]> {
  // Create date strings for the selected date (YYYY-MM-DD format)
  // This avoids timezone conversion issues
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  // Query using date cast to compare just the date portion
  const startOfDay = `${dateStr}T00:00:00`;
  const endOfDay = `${dateStr}T23:59:59`;

  // Get athlete's org_id and restriction tags
  const { data: athlete } = await supabase
    .from('athletes')
    .select('org_id, restriction_tag_ids')
    .eq('id', athleteId)
    .single();

  if (!athlete?.org_id) {
    console.error('Could not find athlete org');
    return [];
  }

  const athleteRestrictionTags = athlete.restriction_tag_ids || [];

  // Fetch events for the date
  const { data: events, error } = await supabase
    .from('scheduling_events')
    .select(`
      id,
      title,
      start_time,
      end_time,
      capacity,
      location_id,
      resource_id,
      event_template_id,
      staff_id,
      template:scheduling_templates(
        id,
        name,
        category_id,
        required_restriction_tag_ids,
        booking_window_hours,
        max_booking_days_ahead,
        category:scheduling_categories(
          id,
          name
        )
      )
    `)
    .eq('org_id', athlete.org_id)
    .eq('status', 'scheduled')
    .gte('start_time', startOfDay)
    .lte('start_time', endOfDay)
    .order('start_time', { ascending: true });

  if (error) {
    console.error('Error fetching events:', error);
    return [];
  }

  // Fetch staff profiles separately - staff_id references the staff table, not profiles directly
  const staffIds = [...new Set((events || []).map((e: any) => e.staff_id).filter(Boolean))];
  const staffMap: Record<string, any> = {};

  if (staffIds.length > 0) {
    // Query the staff table and join to profiles via user_id
    const { data: staffRecords, error: staffError } = await supabase
      .from('staff')
      .select('id, user_id, profiles:profiles!user_id(first_name, last_name, avatar_url)')
      .in('id', staffIds);

    (staffRecords || []).forEach((s: any) => {
      // The profile data is nested under the 'profiles' key from the join
      const profile = s.profiles;
      staffMap[s.id] = {
        first_name: profile?.first_name || '',
        last_name: profile?.last_name || '',
        avatar_url: profile?.avatar_url || null,
      };
    });
  }

  // Fetch locations separately - try scheduling_locations table
  const locationIds = [...new Set((events || []).map((e: any) => e.location_id).filter(Boolean))];
  const locationMap: Record<string, any> = {};

  if (locationIds.length > 0) {
    const { data: locations, error: locError } = await supabase
      .from('scheduling_locations')
      .select('id, name')
      .in('id', locationIds);

    if (locError) {
      console.log('Locations query error:', locError);
    }

    (locations || []).forEach((l: any) => {
      locationMap[l.id] = l;
    });
  }

  // Fetch resources separately
  const resourceIds = [...new Set((events || []).map((e: any) => e.resource_id).filter(Boolean))];
  const resourceMap: Record<string, any> = {};

  if (resourceIds.length > 0) {
    const { data: resources, error: resError } = await supabase
      .from('scheduling_resources')
      .select('id, name')
      .in('id', resourceIds);

    if (resError) {
      console.log('Resources query error:', resError);
    }

    (resources || []).forEach((r: any) => {
      resourceMap[r.id] = r;
    });
  }

  // Get bookings count and check if athlete is booked
  const eventIds = (events || []).map((e: any) => e.id);

  // Query for 'booked' status (the web app uses 'booked', not 'confirmed')
  // Also include 'waitlisted' to show accurate availability
  const { data: bookings } = await supabase
    .from('scheduling_bookings')
    .select('event_id, athlete_id')
    .in('event_id', eventIds)
    .in('status', ['booked', 'confirmed', 'waitlisted']);

  const bookingCounts: Record<string, number> = {};
  const athleteBookings: Set<string> = new Set();

  (bookings || []).forEach((b: any) => {
    bookingCounts[b.event_id] = (bookingCounts[b.event_id] || 0) + 1;
    if (b.athlete_id === athleteId) {
      athleteBookings.add(b.event_id);
    }
  });

  // Map all events - restriction tags are checked when the user tries to book
  // (via checkEligibility function) rather than filtering events from view
  const now = new Date();

  return (events || []).map((event: any) => {
    const startTime = new Date(event.start_time);
    const endTime = new Date(event.end_time);
    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

    const staff = event.staff_id ? staffMap[event.staff_id] : null;
    // Handle template - could be object or array depending on Supabase response
    const rawTemplate = event.template;
    const template = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;
    const location = event.location_id ? locationMap[event.location_id] : null;
    const resource = event.resource_id ? resourceMap[event.resource_id] : null;

    // Handle nested category - could be object or array
    const rawCategory = template?.category;
    const category = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory;

    // Calculate booking window status
    let bookingWindowBlocked = false;
    let bookingWindowReason: string | null = null;

    const bookingWindowHours = template?.booking_window_hours;
    const maxBookingDaysAhead = template?.max_booking_days_ahead;

    // Check if booking closes X hours before event
    if (bookingWindowHours !== null && bookingWindowHours !== undefined && bookingWindowHours > 0) {
      const cutoffTime = new Date(startTime.getTime() - bookingWindowHours * 60 * 60 * 1000);
      if (now >= cutoffTime) {
        bookingWindowBlocked = true;
        bookingWindowReason = `Bookings close ${bookingWindowHours}h before`;
      }
    }

    // Check if booking opens X days before event (only if not already blocked)
    if (!bookingWindowBlocked && maxBookingDaysAhead !== null && maxBookingDaysAhead !== undefined && maxBookingDaysAhead > 0) {
      const openTime = new Date(startTime.getTime() - maxBookingDaysAhead * 24 * 60 * 60 * 1000);
      if (now < openTime) {
        bookingWindowBlocked = true;
        bookingWindowReason = `Bookings open ${maxBookingDaysAhead} days before`;
      }
    }

    return {
      id: event.id,
      title: event.title || template?.name || 'Class',
      startTime,
      endTime,
      coachName: staff ? `${staff.first_name || ''} ${staff.last_name || ''}`.trim() : 'Staff',
      coachAvatar: staff?.avatar_url || null,
      location: location?.name || 'Main Facility',
      resource: resource?.name || null,
      category: category?.name || null,
      durationMinutes,
      capacity: event.capacity || 10,
      bookedCount: bookingCounts[event.id] || 0,
      isBooked: athleteBookings.has(event.id),
      isEligible: true, // Restriction tags already checked in filter
      eventTemplateId: event.event_template_id,
      categoryId: template?.category_id || null,
      bookingWindowBlocked,
      bookingWindowReason,
    };
  });
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
  const methods: PaymentMethod[] = [];

  // Get event details to determine template and category
  const { data: event } = await supabase
    .from('scheduling_events')
    .select(`
      event_template_id,
      template:scheduling_templates(
        id,
        category_id
      )
    `)
    .eq('id', eventId)
    .single();

  const templateId = event?.event_template_id;
  // Handle template - could be object or array depending on Supabase response
  const rawTemplate = event?.template;
  const templateData = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;
  const categoryId = templateData?.category_id;

  // Get active memberships with service_groupings from metadata
  const { data: memberships, error: membershipsError } = await supabase
    .from('memberships')
    .select(`
      id,
      status,
      current_period_end,
      membership_type:membership_types(
        id,
        name,
        metadata
      )
    `)
    .eq('athlete_id', athleteId)
    .in('status', ['active', 'trialing']);

  if (membershipsError) {
    console.error('[getPaymentMethods] Error fetching memberships:', membershipsError);
  }

  // Filter memberships that cover this event based on service_groupings
  const filteredMemberships = (memberships || []).filter((m: any) => {
    const metadata = m.membership_type?.metadata as any;
    const serviceGroupings = metadata?.service_groupings || [];

    // If no service groupings defined, membership doesn't cover specific events
    if (serviceGroupings.length === 0) {
      return false;
    }

    // Check if any service grouping covers this event
    return serviceGroupings.some((sg: any) => {
      const categoryMatch = sg.type === 'category' && sg.id === categoryId;
      const templateMatch = sg.type === 'template' && sg.id === templateId;
      return categoryMatch || templateMatch;
    });
  });

  filteredMemberships.forEach((m: any) => {
    const type = m.membership_type as any;
    const expiryDate = m.current_period_end ? new Date(m.current_period_end) : null;

    methods.push({
      id: m.id,
      type: 'membership',
      name: type?.name || 'Membership',
      subtitle: expiryDate
        ? `Expires ${expiryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : 'Active',
      expiryDate,
      remainingSessions: null,
    });
  });

  // Get active packages with entitlement_rules
  const { data: packages } = await supabase
    .from('packages')
    .select(`
      id,
      status,
      uses_remaining,
      is_unlimited,
      expiry_date,
      package_type:package_types(
        id,
        name,
        entitlement_rules(
          scope,
          category_id,
          template_id
        )
      )
    `)
    .eq('athlete_id', athleteId)
    .eq('status', 'active');

  // Filter packages that cover this event AND have uses remaining
  (packages || []).filter((p: any) => {
    // Check if package has uses left
    const hasUsesLeft = p.is_unlimited || p.uses_remaining === null || p.uses_remaining > 0;
    if (!hasUsesLeft) return false;

    // Check if package has expired
    if (p.expiry_date && new Date(p.expiry_date) < new Date()) return false;

    // Check entitlement rules - package must be entitled to book this event
    const rules = p.package_type?.entitlement_rules || [];
    if (rules.length === 0) return false;

    return rules.some((rule: any) => {
      if (rule.scope === 'any') return true;
      if (rule.scope === 'category' && rule.category_id === categoryId) return true;
      if (rule.scope === 'template' && rule.template_id === templateId) return true;
      return false;
    });
  }).forEach((p: any) => {
    const type = p.package_type as any;
    const isUnlimited = p.is_unlimited === true;
    const remaining = p.uses_remaining;

    methods.push({
      id: p.id,
      type: 'package',
      name: type?.name || 'Package',
      subtitle: isUnlimited ? 'Unlimited sessions' : `${remaining} session${remaining === 1 ? '' : 's'} remaining`,
      expiryDate: p.expiry_date ? new Date(p.expiry_date) : null,
      remainingSessions: isUnlimited ? null : remaining,
    });
  });

  return methods;
}

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app';

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
