/**
 * DataFeed — orchestrator for the new athlete-dashboard data stack.
 *
 * Replaces the SnapshotCarousel. Decides which sections to render and in
 * what order based on a relevance score; sections with no data are simply
 * not rendered (no empty state, no skeleton).
 *
 * Currently a scaffold — sections wire up one at a time as they're built.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { WorkloadSection } from './WorkloadSection';
import { PitchingSection } from './PitchingSection';
import { HittingSection } from './HittingSection';
import { ForceProfileSection } from './ForceProfileSection';
import { ArmCareSection } from './ArmCareSection';
import type { WorkloadDayEntry } from '../../../lib/pulse/useWorkloadMonth';

interface ForceProfileShape {
  composite_score: number;
  percentile_rank: number;
  best_metric: { name: string; percentile: number; value: number } | null;
  worst_metric: { name: string; percentile: number; value: number } | null;
  metrics: Array<{
    name: string;
    percentile: number;
    value: number;
    test_type: string;
    metric: string;
  }>;
}

interface HittingShape {
  latest: {
    bat_speed?: number;
    exit_velocity?: number;
    distance?: number;
    timestamp?: string;
  };
  prs: {
    bat_speed?: { value: number; date: string };
    exit_velocity?: { value: number; date: string };
    distance?: { value: number; date: string };
  };
}

interface PitchingShape {
  prs: { max_velo: { value: number; date: string } | null };
  latest: {
    max_velo: number | null;
    avg_velo_30d: number | null;
    avg_velo_recent: number | null;
    timestamp: string | null;
  };
  stuffPlus: {
    allTimeBest: { pitchType: string; stuffPlus: number; date: string }[];
    recentSession: { pitchType: string; stuffPlus: number; date: string }[];
    overallBest: number | null;
    overallRecent: number | null;
  } | null;
  arsenal: Array<{
    pitchType: string;
    maxVelo: number;
    avgVelo: number;
    count: number;
    usagePct: number;
    stuffPlus: number | null;
  }>;
}

interface ArmCareShape {
  pr: { arm_score: number; date: string };
  latest: {
    arm_score: number;
    arm_score_avg_30d?: number;
    total_strength: number;
    avg_strength_30d: number;
    tests_30d: number;
  };
  perTestLatest?: {
    examDate: string | null;
    bodyweightLbs: number | null;
    irLbs: number | null;
    erLbs: number | null;
    scaptionLbs: number | null;
    gripLbs: number | null;
    erIrRatio: number | null;
  } | null;
}

interface PredictedVelocityShape {
  predicted_value: number;
  predicted_value_low?: number;
  predicted_value_high?: number;
  model_name?: string;
}

interface BodyweightShape {
  current: number;
  previous: number | null;
  date: string;
}

export interface DataFeedProps {
  athleteId: string | null;
  isMember: boolean;
  navigation: any;
  /** 'Youth' | 'High School' | 'College' | 'Pro' — drives the hitting
   *  bat-speed percentile ring against age-band assessment norms. Null
   *  when unknown; the section just hides the ring in that case. */
  playLevel?: string | null;

  workloadByDate: Map<string, WorkloadDayEntry>;
  forceProfile: ForceProfileShape | null;
  valdProfileId: string | null;
  pitchPrediction: PredictedVelocityShape | null;
  batSpeedPrediction: PredictedVelocityShape | null;
  bodyweight: BodyweightShape | null;
  hittingData: HittingShape | null;
  pitchingData: PitchingShape | null;
  armCareData: ArmCareShape | null;

  // Hook into existing nav targets so we don't hardcode strings here
  onOpenWorkload: () => void;
  onOpenPitching: () => void;
  onOpenHitting: () => void;
  onOpenForceProfile: () => void;
  onOpenArmCare: () => void;
}

type SectionKey = 'workload' | 'pitching' | 'hitting' | 'force' | 'armcare';

interface SectionEntry {
  key: SectionKey;
  score: number;
}

export function DataFeed(props: DataFeedProps) {
  const {
    isMember,
    forceProfile,
    valdProfileId,
    hittingData,
    pitchingData,
    armCareData,
  } = props;

  const sections = useMemo<SectionEntry[]>(() => {
    const list: SectionEntry[] = [];

    // Throwing workload — gated on active membership AND some indication
    // the athlete is throwing. We don't have weekly throw history wired in
    // yet, so use isMember alone for now; WorkloadSection itself will
    // hide if no data when fully wired.
    if (isMember) list.push({ key: 'workload', score: 100 });

    if (pitchingData != null) list.push({ key: 'pitching', score: 90 });
    if (hittingData != null) list.push({ key: 'hitting', score: 85 });
    if (forceProfile != null && valdProfileId != null)
      list.push({ key: 'force', score: 70 });
    if (armCareData != null) list.push({ key: 'armcare', score: 60 });

    list.sort((a, b) => b.score - a.score);
    return list;
  }, [isMember, forceProfile, valdProfileId, hittingData, pitchingData, armCareData]);

  if (sections.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {sections.map((section) => (
        <SectionSlot key={section.key} entry={section} props={props} />
      ))}
    </View>
  );
}

function SectionSlot({
  entry,
  props,
}: {
  entry: SectionEntry;
  props: DataFeedProps;
}) {
  // Sections plug in here as they're built. Until each component is ready
  // we render nothing (so the section is effectively skipped without
  // breaking the feed layout).
  switch (entry.key) {
    case 'workload':
      return (
        <WorkloadSection
          workloadByDate={props.workloadByDate}
          onOpen={props.onOpenWorkload}
        />
      );
    case 'pitching':
      if (!props.pitchingData) return null;
      return (
        <PitchingSection
          data={props.pitchingData}
          onOpen={props.onOpenPitching}
        />
      );
    case 'hitting':
      if (!props.hittingData) return null;
      return (
        <HittingSection
          data={props.hittingData}
          playLevel={props.playLevel ?? null}
          onOpen={props.onOpenHitting}
        />
      );
    case 'force':
      if (!props.forceProfile) return null;
      return (
        <ForceProfileSection
          data={props.forceProfile}
          pitchPrediction={props.pitchPrediction}
          batSpeedPrediction={props.batSpeedPrediction}
          bodyweight={props.bodyweight}
          onOpen={props.onOpenForceProfile}
        />
      );
    case 'armcare':
      if (!props.armCareData) return null;
      return (
        <ArmCareSection
          data={props.armCareData}
          maxVelocity={props.pitchingData?.prs?.max_velo?.value ?? null}
          onOpen={props.onOpenArmCare}
        />
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 0,
    paddingBottom: 24,
  },
});
