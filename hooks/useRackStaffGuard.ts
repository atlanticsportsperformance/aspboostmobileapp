/**
 * Defence in depth for the Rack routes: if the signed-in user is resolved as
 * not staff, leave Rack mode for normal routing (Loading decides where).
 */
import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';

export function useRackStaffGuard(): void {
  const navigation = useNavigation<any>();
  const { session, rolesResolved, isStaff } = useAuth();
  useEffect(() => {
    if (session && rolesResolved && !isStaff) {
      navigation.reset({ index: 0, routes: [{ name: 'Loading' }] });
    }
  }, [session, rolesResolved, isStaff, navigation]);
}
