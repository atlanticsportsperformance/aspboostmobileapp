import { supabase } from './supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app';

export interface DirectDepositStatus {
  configured?: boolean;
  w9_done: boolean;
  w9_tin_last4: string | null;
  bank_started: boolean;
  ready: boolean;
  payout_label: string | null;
}

export interface W9Form {
  legal_name: string; business_name: string; tin_type: 'ssn' | 'ein'; tin: string;
  address_line1: string; city: string; state: string; zip: string; certify: boolean;
}

async function call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in');
  const res = await fetch(`${API_URL}/api/coach/direct-deposit${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Something went wrong (${res.status})`);
  return json as T;
}

export const getDirectDeposit = () => call<DirectDepositStatus>('', 'GET');
export const refreshDirectDeposit = () => call<DirectDepositStatus>('/refresh', 'POST');
export const saveW9 = (f: W9Form) => call<{ ok: true }>('/w9', 'POST', f);
export const bankLink = () => call<{ url: string }>('/link', 'POST');
