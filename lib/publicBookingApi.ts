import { supabase } from './supabase';

const API_BASE_URL = 'https://aspboostapp.vercel.app';

export interface PublicEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  coachName: string;
  coachAvatar: string | null;
  location: string;
  resource: string | null;
  category: string | null;
  categoryColor: string | null;
  durationMinutes: number;
  capacity: number;
  bookedCount: number;
  spotsAvailable: number;
  dropInPriceCents: number | null;
  eventTemplateId: string | null;
}

export interface PublicCategory {
  id: string;
  name: string;
  color: string;
}

export interface Organization {
  id: string;
  name: string;
  logo_url: string | null;
}

export interface NewAccountData {
  accountType: 'athlete' | 'parent';
  eventId: string; // Required for /api/public/book
  // Parent fields (if parent account)
  parentEmail?: string;
  parentFirstName?: string;
  parentLastName?: string;
  parentPhone?: string;
  // Athlete fields
  athleteEmail: string;
  athleteFirstName: string;
  athleteLastName: string;
  athletePhone?: string;
  athleteDob: string;
  athleteSex?: 'M' | 'F';
  athletePlayLevel: string;
  // Password (same for both if parent)
  password: string;
}

export interface BookingResult {
  success: boolean;
  error?: string;
  athleteId?: string;
  bookingId?: string;
  userId?: string;
}

/**
 * Get list of organizations that have public booking enabled
 * For now, we use a hardcoded "asp" slug since that's the only org with public booking
 */
export async function getPublicOrganizations(): Promise<Organization[]> {
  // Return ASP org with slug as ID - we'll use org_slug in the events API
  return [{
    id: 'asp', // Using slug as ID, getPublicEvents will handle it
    name: 'Atlantic Sports Performance',
    logo_url: null,
  }];
}

/**
 * Get public booking categories for an organization
 * Since we're using org_slug, we get categories from the events themselves
 */
export async function getPublicCategories(orgIdOrSlug: string): Promise<PublicCategory[]> {
  // Get categories from events API response since we don't have a dedicated endpoint
  try {
    const url = new URL(`${API_BASE_URL}/api/public/events`);
    if (orgIdOrSlug.includes('-') && orgIdOrSlug.length > 30) {
      url.searchParams.set('org_id', orgIdOrSlug);
    } else {
      url.searchParams.set('org_slug', orgIdOrSlug);
    }
    url.searchParams.set('start_date', new Date().toISOString());

    const response = await fetch(url.toString());
    if (!response.ok) return [];

    const result = await response.json();

    // Extract unique categories from events
    const categoriesMap = new Map<string, PublicCategory>();
    (result.events || []).forEach((event: any) => {
      // Handle template - could be object or array depending on Supabase response
      const template = Array.isArray(event.scheduling_templates)
        ? event.scheduling_templates[0]
        : event.scheduling_templates;

      // Handle category within template
      const cat = template?.scheduling_categories
        ? (Array.isArray(template.scheduling_categories)
          ? template.scheduling_categories[0]
          : template.scheduling_categories)
        : null;

      if (cat && !categoriesMap.has(cat.id)) {
        categoriesMap.set(cat.id, {
          id: cat.id,
          name: cat.name,
          color: cat.color || '#9BDDFF',
        });
      }
    });

    return Array.from(categoriesMap.values());
  } catch (error) {
    console.error('Error fetching public categories:', error);
    return [];
  }
}

/**
 * Get public events for a date range (no auth required)
 * Uses the web app's API endpoint to bypass RLS restrictions
 */
export async function getPublicEvents(
  orgIdOrSlug: string,
  startDate: Date,
  endDate: Date
): Promise<PublicEvent[]> {
  try {
    // Format dates
    const startStr = startDate.toISOString();
    const endStr = endDate.toISOString();

    // Call the web app's public events API
    const url = new URL(`${API_BASE_URL}/api/public/events`);

    // Use org_slug if it looks like a slug, otherwise use org_id
    if (orgIdOrSlug.includes('-') && orgIdOrSlug.length > 30) {
      url.searchParams.set('org_id', orgIdOrSlug);
    } else {
      url.searchParams.set('org_slug', orgIdOrSlug);
    }

    url.searchParams.set('start_date', startStr);
    url.searchParams.set('end_date', endStr);

    console.log('Fetching public events from:', url.toString());

    const response = await fetch(url.toString());
    const result = await response.json();

    if (!response.ok) {
      console.error('Error fetching public events:', result.error);
      return [];
    }

    console.log('Public events fetched:', result.count || 0);
    console.log('Raw events data:', JSON.stringify(result.events?.slice(0, 2), null, 2));

    // Map the API response to our PublicEvent interface
    // Filter out events where drop-in is not allowed (dropInPriceCents === null)
    return (result.events || []).filter((event: any) => {
      const template = Array.isArray(event.scheduling_templates)
        ? event.scheduling_templates[0]
        : event.scheduling_templates;
      // Only include events that allow drop-in (drop_in_price_cents is not null)
      return template?.drop_in_price_cents !== null && template?.drop_in_price_cents !== undefined;
    }).map((event: any) => {
      const startTime = new Date(event.start_time);
      const endTime = new Date(event.end_time);
      const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

      // Handle template - could be object or array depending on Supabase response
      const template = Array.isArray(event.scheduling_templates)
        ? event.scheduling_templates[0]
        : event.scheduling_templates;

      // Handle location - could be object or array depending on Supabase response
      const location = Array.isArray(event.scheduling_locations)
        ? event.scheduling_locations[0]
        : event.scheduling_locations;

      // Handle category within template
      const category = template?.scheduling_categories
        ? (Array.isArray(template.scheduling_categories)
          ? template.scheduling_categories[0]
          : template.scheduling_categories)
        : null;

      // Handle resource - could be object or array depending on Supabase response
      const resource = event.scheduling_resources
        ? (Array.isArray(event.scheduling_resources)
          ? event.scheduling_resources[0]
          : event.scheduling_resources)
        : null;

      // Handle staff - could be object or array depending on Supabase response
      const staff = event.staff
        ? (Array.isArray(event.staff)
          ? event.staff[0]
          : event.staff)
        : null;

      // Get coach name from staff profile
      const staffProfile = staff?.profile
        ? (Array.isArray(staff.profile)
          ? staff.profile[0]
          : staff.profile)
        : null;
      const coachName = staffProfile
        ? `${staffProfile.first_name || ''} ${staffProfile.last_name || ''}`.trim()
        : 'Staff';

      const bookedCount = event.current_bookings || 0;
      const capacity = event.capacity || 10;

      const mappedEvent = {
        id: event.id,
        title: event.title || template?.name || 'Class',
        startTime,
        endTime,
        coachName: coachName || 'Staff',
        coachAvatar: null,
        location: location?.name || 'Main Facility',
        resource: resource?.name || null,
        category: category?.name || null,
        categoryColor: category?.color || null,
        durationMinutes,
        capacity,
        bookedCount,
        spotsAvailable: Math.max(0, capacity - bookedCount),
        dropInPriceCents: template?.drop_in_price_cents ?? null,
        eventTemplateId: event.event_template_id,
      };

      console.log('Mapped event:', mappedEvent.title, 'at', mappedEvent.location,
        'resource:', mappedEvent.resource, 'coach:', mappedEvent.coachName,
        'price:', mappedEvent.dropInPriceCents, 'category:', mappedEvent.category);

      return mappedEvent;
    });
  } catch (error) {
    console.error('Error fetching public events:', error);
    return [];
  }
}

/**
 * Create a new account, athlete record, and booking via the backend API
 * Uses /api/public/book which handles account creation + booking in one call
 */
export async function createAccount(data: NewAccountData): Promise<BookingResult> {
  try {
    // Call the web app's public book API
    // This creates the account AND books the event in one call
    const requestBody: any = {
      eventId: data.eventId,
      accountType: data.accountType,
      // Athlete fields (always required)
      athleteFirstName: data.athleteFirstName,
      athleteLastName: data.athleteLastName,
      athleteEmail: data.athleteEmail,
      athleteDob: data.athleteDob,
      athletePlayLevel: data.athletePlayLevel,
      athletePhone: data.athletePhone || undefined,
      // Password
      password: data.password,
      prospectSource: 'public_booking',
    };

    // Add parent fields if parent account
    if (data.accountType === 'parent') {
      requestBody.parentFirstName = data.parentFirstName;
      requestBody.parentLastName = data.parentLastName;
      requestBody.parentEmail = data.parentEmail;
      requestBody.parentPhone = data.parentPhone || undefined;
    }

    console.log('Creating account via /api/public/book:', requestBody);

    const response = await fetch(`${API_BASE_URL}/api/public/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const result = await response.json();
    console.log('Book API response:', result);

    if (!response.ok) {
      // Handle specific error codes
      if (response.status === 409) {
        return {
          success: false,
          error: 'An account with this email already exists. Please sign in instead.',
        };
      }
      return {
        success: false,
        error: result.error || 'Failed to create account and booking',
      };
    }

    // Now sign in the user (parent email if parent account, athlete email if athlete account)
    const loginEmail = data.accountType === 'parent' ? data.parentEmail : data.athleteEmail;

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: loginEmail!,
      password: data.password,
    });

    if (signInError) {
      console.error('Sign in error:', signInError);
      return {
        success: false,
        error: 'Account created but failed to sign in. Please try logging in.',
      };
    }

    return {
      success: true,
      athleteId: result.athlete_id,
      bookingId: result.booking_id,
      userId: result.parent_id || result.athlete_id,
    };
  } catch (error) {
    console.error('Error creating account:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Format price in cents to display string
 * NULL = No drop-in allowed (membership required)
 * 0 = Free drop-in
 * > 0 = Paid drop-in
 */
export function formatPrice(cents: number | null): string {
  if (cents === null || cents === undefined) return 'Membership Required';
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Check if an email is already registered
 */
export async function checkEmailExists(email: string): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  return !!data;
}
