/**
 * PitchingHubScreen — the FAB's "Pitching" entry. It now renders the Steel
 * pitching Performance screen directly (Workload + Arm Care live in its
 * TOOLS list). athleteId is resolved from the signed-in user when the route
 * doesn't pass one, as the old hub did.
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAthleteLifecycle } from '../lib/useAthleteLifecycle';
import { STEEL } from '../components/hitting/steel';
import PitchingScreen from './PitchingScreen';

export default function PitchingHubScreen(props: any) {
  const [athleteId, setAthleteId] = useState<string | null>(props?.route?.params?.athleteId ?? null);
  const [resolved, setResolved] = useState<boolean>(!!athleteId);
  // Warms the lifecycle cache for the athlete being viewed (PitchingScreen gates Workload on it).
  useAthleteLifecycle(athleteId);

  useEffect(() => {
    if (athleteId) return;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase.from('athletes').select('id').eq('user_id', user.id).maybeSingle();
        if (data?.id) setAthleteId(data.id);
      } finally {
        setResolved(true);
      }
    })();
  }, [athleteId]);

  if (!resolved) return <View style={{ flex: 1, backgroundColor: STEEL.bg }} />;

  const route = { ...(props?.route ?? {}), params: { ...(props?.route?.params ?? {}), ...(athleteId ? { athleteId } : {}) } };
  return <PitchingScreen {...props} route={route} />;
}
