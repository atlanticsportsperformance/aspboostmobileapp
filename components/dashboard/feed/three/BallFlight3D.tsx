/**
 * BallFlight3D — the athlete's recent HitTrax batted balls drawn as
 * flight arcs over a field (foul lines, fence, infield diamond).
 *
 * Each arc uses the swing's real exit velo, launch angle, spray
 * (horizontal_angle) and distance. Apex height is approximated from
 * launch angle and distance (HitTrax doesn't store apex), so the shape
 * is representative while the landing spot is exact.
 *
 * Harder contact (95+ mph) is bright orange, 90–95 lighter, below 90 grey.
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import { BallField3D, type BattedBall } from '../../../hitting/BallField3D';

type Swing = BattedBall;

function useArcs(athleteId: string | null | undefined) {
  const [arcs, setArcs] = useState<Swing[] | null>(null);
  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    (async () => {
      const { data: sessions } = await supabase
        .from('hittrax_sessions')
        .select('id')
        .eq('athlete_id', athleteId)
        .order('session_date', { ascending: false })
        .limit(5);
      const ids = (sessions ?? []).map((s: { id: string }) => s.id);
      if (!ids.length) {
        if (!cancelled) setArcs([]);
        return;
      }
      const { data } = await supabase
        .from('hittrax_swings')
        .select('exit_velocity, launch_angle, horizontal_angle, distance')
        .in('session_id', ids)
        .gt('distance', 0)
        .not('launch_angle', 'is', null)
        .order('swing_timestamp', { ascending: false })
        .limit(8);
      if (cancelled) return;
      setArcs(((data ?? []) as Swing[]).reverse());
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);
  return arcs;
}

export function BallFlight3D({ athleteId }: { athleteId?: string | null }) {
  const balls = useArcs(athleteId);
  if (!balls || balls.length === 0) return null;
  return <BallField3D balls={balls} secondsPerBall={1.6} caption={`LAST ${balls.length} BALLS IN PLAY`} />;
}
