# Stripe Drop-in Payment Implementation Plan

## Overview

Paid drop-in sessions will use Stripe's React Native SDK for native in-app payments. Since fitness classes are physical services (not digital goods), Apple allows third-party payment processing without their 30% fee.

## Flow

1. User taps "Pay $XX.XX" in the iOS app
2. App calls API to create a Stripe Payment Intent
3. Stripe Payment Sheet opens natively (with Apple Pay support)
4. User pays with Apple Pay or card
5. On success, app calls API to create the booking
6. Modal closes, event shows as "Reserved"

## Required Setup

### 1. Install Stripe React Native SDK

```bash
# In the mobile app
npx expo install @stripe/stripe-react-native
```

### 2. Stripe Account & Keys

Add to `.env`:
```
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxx
```

Add to web app `.env`:
```
STRIPE_SECRET_KEY=sk_live_xxx
```

### 3. Configure Stripe Provider in App

**File:** `App.tsx` or root layout

```typescript
import { StripeProvider } from '@stripe/stripe-react-native';

export default function App() {
  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
      merchantIdentifier="merchant.com.aspboost" // For Apple Pay
    >
      {/* Your app */}
    </StripeProvider>
  );
}
```

### 4. API Endpoint: Create Payment Intent

**File:** `/app/api/booking/create-payment-intent/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: NextRequest) {
  const { event_id, athlete_id } = await request.json();

  const supabase = await createClient();

  // Fetch event with drop-in price
  const { data: event } = await supabase
    .from('scheduling_events')
    .select(`
      id, title, start_time,
      template:scheduling_templates!event_template_id(drop_in_price_cents)
    `)
    .eq('id', event_id)
    .single();

  if (!event?.template?.drop_in_price_cents) {
    return NextResponse.json({ error: 'No drop-in price' }, { status: 400 });
  }

  // Fetch athlete email for receipt
  const { data: athlete } = await supabase
    .from('athletes')
    .select('profiles!user_id(email)')
    .eq('id', athlete_id)
    .single();

  // Create Payment Intent
  const paymentIntent = await stripe.paymentIntents.create({
    amount: event.template.drop_in_price_cents,
    currency: 'usd',
    metadata: {
      event_id,
      athlete_id,
      type: 'drop_in_booking',
    },
    receipt_email: athlete?.profiles?.email,
  });

  return NextResponse.json({
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  });
}
```

### 5. Update Mobile App Payment Handler

**File:** `components/booking/ClassDetailsSheet.tsx`

```typescript
import { useStripe } from '@stripe/stripe-react-native';

// Inside component:
const { initPaymentSheet, presentPaymentSheet } = useStripe();

const handlePaidDropInPress = async () => {
  try {
    // 1. Create Payment Intent on server
    const response = await fetch(`${API_URL}/api/booking/create-payment-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: event.id,
        athlete_id: athleteId,
      }),
    });

    const { clientSecret, paymentIntentId } = await response.json();

    // 2. Initialize Payment Sheet
    const { error: initError } = await initPaymentSheet({
      paymentIntentClientSecret: clientSecret,
      merchantDisplayName: 'ASPBoost',
      applePay: {
        merchantCountryCode: 'US',
      },
      googlePay: {
        merchantCountryCode: 'US',
        testEnv: __DEV__,
      },
    });

    if (initError) {
      Alert.alert('Error', initError.message);
      return;
    }

    // 3. Present Payment Sheet
    const { error: paymentError } = await presentPaymentSheet();

    if (paymentError) {
      if (paymentError.code !== 'Canceled') {
        Alert.alert('Payment Failed', paymentError.message);
      }
      return;
    }

    // 4. Payment successful - create the booking
    const bookingResponse = await fetch(`${API_URL}/api/athletes/${athleteId}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: event.id,
        payment_type: 'drop_in',
        payment_id: paymentIntentId,
      }),
    });

    if (bookingResponse.ok) {
      Alert.alert('Success', 'Your class has been booked!');
      onClose();
      // Trigger refresh of events
    }
  } catch (error) {
    Alert.alert('Error', 'Something went wrong');
  }
};
```

### 6. Update Booking API to Handle Drop-in

**File:** `/app/api/athletes/[id]/bookings/route.ts`

Add handling for `payment_type: 'drop_in'`:

```typescript
if (body.payment_type === 'drop_in') {
  // Verify payment was successful with Stripe
  const paymentIntent = await stripe.paymentIntents.retrieve(body.payment_id);

  if (paymentIntent.status !== 'succeeded') {
    return NextResponse.json({ error: 'Payment not completed' }, { status: 400 });
  }

  // Create booking with drop-in info
  await supabase.from('scheduling_bookings').insert({
    event_id: body.event_id,
    athlete_id: athleteId,
    status: 'booked',
    payment_type: 'drop_in',
    payment_id: body.payment_id,
    amount_paid_cents: paymentIntent.amount,
  });
}
```

## Apple Pay Setup (Optional but Recommended)

1. Create Apple Merchant ID in Apple Developer Portal
2. Add to Stripe Dashboard > Settings > Payment Methods > Apple Pay
3. Configure in `app.json`:

```json
{
  "expo": {
    "ios": {
      "entitlements": {
        "com.apple.developer.in-app-payments": ["merchant.com.aspboost"]
      }
    }
  }
}
```

## Database Schema Addition

```sql
ALTER TABLE scheduling_bookings
ADD COLUMN payment_type TEXT, -- 'membership', 'package', 'drop_in'
ADD COLUMN payment_id TEXT,   -- Stripe payment intent ID
ADD COLUMN amount_paid_cents INTEGER;
```

## Why This is Allowed by Apple

Apple's App Store Review Guidelines (Section 3.1.3):

> "Apps may use in-app purchase to sell... services used or delivered outside of the app... (e.g. gym memberships, etc.)"

Fitness classes are physical services delivered in-person, not digital content consumed in the app. This exempts them from the 30% Apple commission.

## Testing Checklist

- [ ] Install `@stripe/stripe-react-native`
- [ ] Add Stripe publishable key to env
- [ ] Wrap app in StripeProvider
- [ ] Create payment intent endpoint
- [ ] Implement payment sheet in ClassDetailsSheet
- [ ] Update booking API to handle drop-in payments
- [ ] Test payment flow end-to-end
- [ ] Test Apple Pay (requires device, not simulator)
- [ ] Add proper error handling
