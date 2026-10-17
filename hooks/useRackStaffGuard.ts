/**
 * Defence in depth for the Rack routes: leave Rack mode (Loading decides
 * where) ONLY when the signed-in user is CONFIRMED not staff. A failed staff
 * check is 'unknown' and keeps Rack mode (a network blip must not eject a
 * rack mid-set). Before leaving, the live set is ended (ipadDone) and the
 * queues flushed, so the set row is written.
 */
import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { endActiveRackSet } from '../lib/rack/device';

/** Pure decision (tested): leave only on a confirmed non-staff result. */
export function shouldLeaveRack(a: { hasSession: boolean; rolesResolved: boolean; staffStatus: 'unknown' | 'staff' | 'not_staff' }): boolean {
  return a.hasSession && a.rolesResolved && a.staffStatus === 'not_staff';
}

export function useRackStaffGuard(): void {
  const navigation = useNavigation<any>();
  const { session, rolesResolved, staffStatus } = useAuth();
  useEffect(() => {
    if (!shouldLeaveRack({ hasSession: !!session, rolesResolved, staffStatus })) return;
    let cancelled = false;
    (async () => {
      await endActiveRackSet();
      if (!cancelled) navigation.reset({ index: 0, routes: [{ name: 'Loading' }] });
    })();
    return () => {
      cancelled = true;
    };
  }, [session, rolesResolved, staffStatus, navigation]);
}
