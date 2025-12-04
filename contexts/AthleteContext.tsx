import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

interface LinkedAthlete {
  id: string; // user_id from profiles
  athlete_id: string; // id from athletes table
  first_name: string;
  last_name: string;
  email: string;
  color: string;
}

interface AthleteContextType {
  isParent: boolean;
  parentId: string | null;
  parentName: string;
  linkedAthletes: LinkedAthlete[];
  selectedAthleteId: string | null;
  selectedAthleteName: string | null;
  selectedAthleteColor: string | null;
  loading: boolean;
  setSelectedAthlete: (athleteId: string) => void;
  clearSelectedAthlete: () => void;
  loadParentData: (userId: string, firstName: string, lastName: string) => Promise<void>;
  resetContext: () => void;
}

const ATHLETE_COLORS = [
  '#9BDDFF',
  '#FFB84D',
  '#A78BFA',
  '#FB923C',
  '#34D399',
  '#F472B6',
];

const LAST_SELECTED_ATHLETE_KEY = 'aspboost_last_selected_athlete';

const AthleteContext = createContext<AthleteContextType | undefined>(undefined);

export function AthleteProvider({ children }: { children: ReactNode }) {
  const [isParent, setIsParent] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [parentName, setParentName] = useState('');
  const [linkedAthletes, setLinkedAthletes] = useState<LinkedAthlete[]>([]);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);
  const [selectedAthleteName, setSelectedAthleteName] = useState<string | null>(null);
  const [selectedAthleteColor, setSelectedAthleteColor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Check auth state and load parent data on mount and auth changes
  useEffect(() => {
    checkAuthAndLoadData();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        await checkAuthAndLoadData();
      } else {
        resetContext();
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function checkAuthAndLoadData() {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      // Check if user is a parent
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('account_type, first_name, last_name')
        .eq('id', session.user.id)
        .single();

      if (profile?.account_type === 'parent') {
        await loadParentData(session.user.id, profile.first_name || '', profile.last_name || '');
      } else {
        // Not a parent, reset
        setIsParent(false);
        setParentId(null);
        setParentName('');
        setLinkedAthletes([]);
        setLoading(false);
      }
    } catch (error) {
      console.error('Error checking auth:', error);
      setLoading(false);
    }
  }

  // Load last selected athlete from storage on mount
  useEffect(() => {
    loadLastSelectedAthlete();
  }, []);

  async function loadLastSelectedAthlete() {
    try {
      const lastSelected = await AsyncStorage.getItem(LAST_SELECTED_ATHLETE_KEY);
      if (lastSelected) {
        setSelectedAthleteId(lastSelected);
      }
    } catch (error) {
      console.error('Error loading last selected athlete:', error);
    }
  }

  async function loadParentData(userId: string, firstName: string, lastName: string) {
    setLoading(true);
    try {
      setParentId(userId);
      setParentName(`${firstName} ${lastName}`);
      setIsParent(true);

      // Check if this parent was previously an athlete (athlete-turned-parent case)
      const { data: parentAthleteRecord } = await supabase
        .from('athletes')
        .select('id, first_name, last_name')
        .eq('user_id', userId)
        .maybeSingle();

      // Fetch linked athletes from athlete_guardians
      // Note: athlete_guardians.athlete_id references profiles.id (user_id), not athletes.id
      const { data: guardianships, error: guardianError } = await supabase
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
        .eq('guardian_id', userId);

      // Get athlete table IDs and assign colors
      // The athlete_guardians.athlete_id might directly be the athletes.id
      // OR it might be profiles.id - we need to check both
      const athletesWithDetails = await Promise.all(
        (guardianships || [])
          .filter((g: any) => g.athlete)
          .map(async (g: any, index: number) => {
            // First try to find athlete by user_id (if athlete_guardians.athlete_id is profile id)
            let athleteTableId = '';

            // Try lookup by user_id first
            const { data: athleteByUserId } = await supabase
              .from('athletes')
              .select('id')
              .eq('user_id', g.athlete.id)
              .maybeSingle();

            if (athleteByUserId) {
              athleteTableId = athleteByUserId.id;
            } else {
              // If not found by user_id, check if athlete_guardians.athlete_id IS the athletes.id directly
              const { data: athleteDirectId } = await supabase
                .from('athletes')
                .select('id')
                .eq('id', g.athlete_id)
                .maybeSingle();

              if (athleteDirectId) {
                athleteTableId = athleteDirectId.id;
              }
            }

            return {
              id: g.athlete.id,
              athlete_id: athleteTableId,
              first_name: g.athlete.first_name,
              last_name: g.athlete.last_name,
              email: g.athlete.email,
              color: ATHLETE_COLORS[index % ATHLETE_COLORS.length],
            };
          })
      );

      // Filter out any athletes without valid athlete_id (no athletes table record)
      let validAthletes = athletesWithDetails.filter(a => a.athlete_id !== '');

      // If parent has their own athlete record, include themselves in the list
      // This handles the "athlete-turned-parent" edge case
      if (parentAthleteRecord) {
        const parentAsAthlete = {
          id: userId,
          athlete_id: parentAthleteRecord.id,
          first_name: parentAthleteRecord.first_name || firstName,
          last_name: parentAthleteRecord.last_name || lastName,
          email: '', // Parent's own email not needed
          color: ATHLETE_COLORS[validAthletes.length % ATHLETE_COLORS.length],
        };

        // Add parent as athlete if not already in list
        if (!validAthletes.some(a => a.athlete_id === parentAthleteRecord.id)) {
          validAthletes = [parentAsAthlete, ...validAthletes];
        }
      }

      setLinkedAthletes(validAthletes);

      // If there's a last selected athlete that's still valid, keep it
      // Otherwise, if there's exactly one athlete, auto-select them
      const lastSelected = await AsyncStorage.getItem(LAST_SELECTED_ATHLETE_KEY);
      const isValidSelection = validAthletes.some(a => a.athlete_id === lastSelected);

      if (isValidSelection && lastSelected) {
        const athlete = validAthletes.find(a => a.athlete_id === lastSelected);
        if (athlete) {
          setSelectedAthleteId(athlete.athlete_id);
          setSelectedAthleteName(`${athlete.first_name} ${athlete.last_name}`);
          setSelectedAthleteColor(athlete.color);
        }
      } else if (validAthletes.length === 1) {
        const athlete = validAthletes[0];
        setSelectedAthleteId(athlete.athlete_id);
        setSelectedAthleteName(`${athlete.first_name} ${athlete.last_name}`);
        setSelectedAthleteColor(athlete.color);
        await AsyncStorage.setItem(LAST_SELECTED_ATHLETE_KEY, athlete.athlete_id);
      }
    } catch (error) {
      console.error('Error loading parent data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function setSelectedAthlete(athleteId: string) {
    const athlete = linkedAthletes.find(a => a.athlete_id === athleteId);
    if (athlete) {
      setSelectedAthleteId(athleteId);
      setSelectedAthleteName(`${athlete.first_name} ${athlete.last_name}`);
      setSelectedAthleteColor(athlete.color);
      await AsyncStorage.setItem(LAST_SELECTED_ATHLETE_KEY, athleteId);
    }
  }

  function clearSelectedAthlete() {
    setSelectedAthleteId(null);
    setSelectedAthleteName(null);
    setSelectedAthleteColor(null);
  }

  async function resetContext() {
    setIsParent(false);
    setParentId(null);
    setParentName('');
    setLinkedAthletes([]);
    setSelectedAthleteId(null);
    setSelectedAthleteName(null);
    setSelectedAthleteColor(null);
    await AsyncStorage.removeItem(LAST_SELECTED_ATHLETE_KEY);
  }

  return (
    <AthleteContext.Provider
      value={{
        isParent,
        parentId,
        parentName,
        linkedAthletes,
        selectedAthleteId,
        selectedAthleteName,
        selectedAthleteColor,
        loading,
        setSelectedAthlete,
        clearSelectedAthlete,
        loadParentData,
        resetContext,
      }}
    >
      {children}
    </AthleteContext.Provider>
  );
}

export function useAthlete() {
  const context = useContext(AthleteContext);
  if (context === undefined) {
    throw new Error('useAthlete must be used within an AthleteProvider');
  }
  return context;
}
