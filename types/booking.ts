// Booking System Types

export interface LinkedAthlete {
  id: string;           // profile id
  athleteId: string;    // athletes table id
  firstName: string;
  lastName: string;
  email: string;
  color: string;        // Assigned color for avatar
}

export interface BookableEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  coachName: string;
  coachAvatar: string | null;
  location: string;
  resource: string | null;  // Sub-location like "Hitting Cage" or "Pitching Lane"
  category: string | null;
  durationMinutes: number;
  capacity: number;
  bookedCount: number;
  isBooked: boolean;
  isEligible: boolean;
  eventTemplateId: string | null;
  categoryId: string | null;
}

export interface MissingRestriction {
  name: string;
  description: string;
}

export interface EligibilityData {
  canBook: boolean;
  sourceType: 'membership' | 'package' | 'drop_in' | 'blocked' | null;
  sourceId: string | null;
  reason: string | null;
  remainingVisits: number | null;
  missingRestrictions: MissingRestriction[] | null;
  // Drop-in specific fields
  dropInPriceCents: number | null;
}

export interface PaymentMethod {
  id: string;
  type: 'membership' | 'package' | 'drop_in';
  name: string;
  subtitle: string; // "Expires Dec 15" or "5 sessions remaining" or "$75.00"
  expiryDate: Date | null;
  remainingSessions: number | null;
  // Drop-in specific
  priceCents?: number;
  isFree?: boolean;
}

export interface Membership {
  id: string;
  status: string;
  currentPeriodEnd: Date;
  membershipType: {
    id: string;
    name: string;
    metadata?: {
      service_groupings?: string[];
    };
  };
}

export interface Package {
  id: string;
  status: string;
  usesRemaining: number;
  expiryDate: Date | null;
  packageType: {
    id: string;
    name: string;
  };
}

export interface SchedulingCategory {
  id: string;
  name: string;
  color: string;
  isPublic: boolean;
}

export interface CreateBookingRequest {
  eventId: string;
  paymentType: 'membership' | 'package';
  paymentId: string;
}

export interface BookingResponse {
  success: boolean;
  booking?: {
    id: string;
    eventId: string;
    athleteId: string;
    status: string;
  };
  error?: string;
}

// Avatar colors for parent view athlete selector
export const ATHLETE_COLORS = [
  '#9BDDFF',
  '#FFB84D',
  '#A78BFA',
  '#FB923C',
  '#34D399',
  '#F472B6',
];

export function getAthleteColor(index: number): string {
  return ATHLETE_COLORS[index % ATHLETE_COLORS.length];
}

export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function formatEventTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatFullDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
