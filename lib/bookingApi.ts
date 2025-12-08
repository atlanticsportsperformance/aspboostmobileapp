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
 */
export async function getLinkedAthletes(guardianId: string): Promise<LinkedAthlete[]> {
  const { data: links, error } = await supabase
    .from('athlete_guardians')
    .select(`
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
    const athlete = link.athlete as any;

    if (!athlete) continue;

    // Get the athletes table ID
    const { data: athleteRecord } = await supabase
      .from('athletes')
      .select('id')
      .eq('user_id', athlete.id)
      .single();

    if (athleteRecord) {
      athletes.push({
        id: athlete.id,
        athleteId: athleteRecord.id,
        firstName: athlete.first_name || '',
        lastName: athlete.last_name || '',
        email: athlete.email || '',
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

  // Get athlete's org_id first
  const { data: athlete } = await supabase
    .from('athletes')
    .select('org_id')
    .eq('id', athleteId)
    .single();

  if (!athlete?.org_id) {
    console.error('Could not find athlete org');
    return [];
  }

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

    console.log('Staff query:', { staffIds, staffRecords, staffError });

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

  const { data: bookings } = await supabase
    .from('scheduling_bookings')
    .select('event_id, athlete_id')
    .in('event_id', eventIds)
    .eq('status', 'confirmed');

  const bookingCounts: Record<string, number> = {};
  const athleteBookings: Set<string> = new Set();

  (bookings || []).forEach((b: any) => {
    bookingCounts[b.event_id] = (bookingCounts[b.event_id] || 0) + 1;
    if (b.athlete_id === athleteId) {
      athleteBookings.add(b.event_id);
    }
  });

  return (events || []).map((event: any) => {
    const startTime = new Date(event.start_time);
    const endTime = new Date(event.end_time);
    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

    const staff = event.staff_id ? staffMap[event.staff_id] : null;
    const template = event.template as any;
    const location = event.location_id ? locationMap[event.location_id] : null;
    const resource = event.resource_id ? resourceMap[event.resource_id] : null;

    return {
      id: event.id,
      title: event.title || template?.name || 'Class',
      startTime,
      endTime,
      coachName: staff ? `${staff.first_name || ''} ${staff.last_name || ''}`.trim() : 'Staff',
      coachAvatar: staff?.avatar_url || null,
      location: location?.name || 'Main Facility',
      resource: resource?.name || null,
      category: template?.category?.name || null,
      durationMinutes,
      capacity: event.capacity || 10,
      bookedCount: bookingCounts[event.id] || 0,
      isBooked: athleteBookings.has(event.id),
      isEligible: true, // Will be checked separately
      eventTemplateId: event.event_template_id,
      categoryId: template?.category_id || null,
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

  const template = event?.template as any;
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
 */
export async function getPaymentMethods(
  athleteId: string,
  eventId: string
): Promise<PaymentMethod[]> {
  const methods: PaymentMethod[] = [];

  // Get active memberships
  const { data: memberships } = await supabase
    .from('memberships')
    .select(`
      id,
      status,
      current_period_end,
      membership_type:membership_types(
        id,
        name
      )
    `)
    .eq('athlete_id', athleteId)
    .eq('status', 'active');

  (memberships || []).forEach((m: any) => {
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

  // Get active packages with remaining uses
  const { data: packages } = await supabase
    .from('packages')
    .select(`
      id,
      status,
      uses_remaining,
      expiry_date,
      package_type:package_types(
        id,
        name
      )
    `)
    .eq('athlete_id', athleteId)
    .eq('status', 'active')
    .gt('uses_remaining', 0);

  (packages || []).forEach((p: any) => {
    const type = p.package_type as any;
    const remaining = p.uses_remaining || 0;

    methods.push({
      id: p.id,
      type: 'package',
      name: type?.name || 'Package',
      subtitle: `${remaining} session${remaining === 1 ? '' : 's'} remaining`,
      expiryDate: p.expiry_date ? new Date(p.expiry_date) : null,
      remainingSessions: remaining,
    });
  });

  return methods;
}

/**
 * Create a booking
 * Supports membership, package, and FREE drop-in bookings
 * NOTE: Paid drop-ins are handled via web redirect, not through this function
 */
export async function createBooking(
  athleteId: string,
  eventId: string,
  paymentType: 'membership' | 'package' | 'drop_in',
  paymentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get athlete's org_id
    const { data: athlete } = await supabase
      .from('athletes')
      .select('org_id')
      .eq('id', athleteId)
      .single();

    if (!athlete?.org_id) {
      return { success: false, error: 'Could not find athlete organization' };
    }

    // Check capacity
    const { data: event } = await supabase
      .from('scheduling_events')
      .select('capacity')
      .eq('id', eventId)
      .single();

    const { count: bookedCount } = await supabase
      .from('scheduling_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('status', 'confirmed');

    if ((bookedCount || 0) >= (event?.capacity || 0)) {
      return { success: false, error: 'This class is full' };
    }

    // Check not already booked
    const { data: existingBooking } = await supabase
      .from('scheduling_bookings')
      .select('id')
      .eq('event_id', eventId)
      .eq('athlete_id', athleteId)
      .eq('status', 'confirmed')
      .single();

    if (existingBooking) {
      return { success: false, error: 'You are already booked for this class' };
    }

    // If package, deduct a use
    if (paymentType === 'package') {
      const { data: pkg } = await supabase
        .from('packages')
        .select('uses_remaining')
        .eq('id', paymentId)
        .single();

      if (!pkg || pkg.uses_remaining <= 0) {
        return { success: false, error: 'No remaining sessions on this package' };
      }

      const newRemaining = pkg.uses_remaining - 1;
      await supabase
        .from('packages')
        .update({
          uses_remaining: newRemaining,
          status: newRemaining === 0 ? 'depleted' : 'active',
        })
        .eq('id', paymentId);
    }

    // Create booking
    // For drop_in (free), we set source_type to 'drop_in' with null source_id
    const { error: bookingError } = await supabase
      .from('scheduling_bookings')
      .insert({
        org_id: athlete.org_id,
        athlete_id: athleteId,
        event_id: eventId,
        status: 'confirmed',
        source_type: paymentType,
        source_id: paymentType === 'drop_in' ? null : paymentId,
        package_id: paymentType === 'package' ? paymentId : null,
      });

    if (bookingError) {
      console.error('Error creating booking:', bookingError);
      return { success: false, error: 'Failed to create booking' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in createBooking:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Cancel a booking
 */
export async function cancelBooking(
  athleteId: string,
  eventId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('scheduling_bookings')
      .delete()
      .eq('athlete_id', athleteId)
      .eq('event_id', eventId);

    if (error) {
      console.error('Error cancelling booking:', error);
      return { success: false, error: 'Failed to cancel booking' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in cancelBooking:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}
