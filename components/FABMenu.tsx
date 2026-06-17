import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAcdlMembership } from '../hooks/useAcdlMembership';
import { ACDL_BLUE, acdlBlueAlpha } from './league/acdlTheme';

export interface FABMenuItem {
  id: string;
  label: string;
  icon: string;
  iconFamily?: 'ionicons' | 'material-community';
  onPress: () => void;
  isActive?: boolean;
  badge?: number;
  isBookButton?: boolean;
  /** League item gets the ACDL sky-blue accent + crest icon. */
  isLeague?: boolean;
}

interface FABMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  items: FABMenuItem[];
  totalBadgeCount?: number;
  /**
   * The athlete whose FAB this is. Passed to the auto-injected "ACDL League"
   * item so it gates on (and navigates for) the right athlete — defaults to the
   * resolved athlete (athlete account or selected child) when omitted.
   */
  athleteId?: string | null;
}

export default function FABMenu({
  isOpen,
  onToggle,
  items,
  totalBadgeCount = 0,
  athleteId = null,
}: FABMenuProps) {
  const navigation = useNavigation<any>();

  // Auto-inject an "ACDL League" item, gated cheaply on league membership
  // (useAcdlMembership reuses the resolved athlete id; only rostered athletes
  // ever see it). Inserted after "Performance" when present, else at the top.
  const { inLeague } = useAcdlMembership(athleteId);

  const leagueItem: FABMenuItem = {
    id: 'acdl-league',
    label: 'ACDL League',
    icon: 'trophy',
    isLeague: true,
    onPress: () => navigation.navigate('LeagueHub', athleteId ? { athleteId } : {}),
  };

  const resolvedItems: FABMenuItem[] = React.useMemo(() => {
    if (!inLeague) return items;
    if (items.some((i) => i.id === 'acdl-league')) return items;
    const perfIdx = items.findIndex((i) => i.id === 'performance');
    const next = [...items];
    next.splice(perfIdx >= 0 ? perfIdx + 1 : 0, 0, leagueItem);
    return next;
  }, [items, inLeague]); // eslint-disable-line react-hooks/exhaustive-deps
  const renderIcon = (item: FABMenuItem) => {
    // ACDL League item shows the real crest (white circle reads on dark).
    if (item.isLeague) {
      return (
        <Image
          source={require('../assets/acdl-crest.png')}
          style={styles.leagueCrest}
          resizeMode="contain"
        />
      );
    }

    const iconColor = item.isActive
      ? '#9BDDFF'
      : item.isBookButton
      ? '#000000'
      : '#FFFFFF';
    const iconSize = 20;

    if (item.iconFamily === 'material-community') {
      return (
        <MaterialCommunityIcons
          name={item.icon as keyof typeof MaterialCommunityIcons.glyphMap}
          size={iconSize}
          color={iconColor}
        />
      );
    }

    return (
      <Ionicons
        name={item.icon as keyof typeof Ionicons.glyphMap}
        size={iconSize}
        color={iconColor}
      />
    );
  };

  return (
    <View style={styles.fabContainer}>
      {/* Notification Badge on FAB */}
      {totalBadgeCount > 0 && !isOpen && (
        <View style={styles.fabNotificationBadge}>
          <Text style={styles.fabNotificationBadgeText}>
            {totalBadgeCount > 99 ? '99+' : totalBadgeCount}
          </Text>
        </View>
      )}

      <TouchableOpacity onPress={onToggle} style={styles.fab}>
        <LinearGradient
          colors={['#9BDDFF', '#B0E5FF', '#7BC5F0']}
          style={styles.fabGradient}
        >
          <Text style={styles.fabIcon}>{isOpen ? '✕' : '☰'}</Text>
        </LinearGradient>
      </TouchableOpacity>

      {/* FAB Menu */}
      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={onToggle}
      >
        <TouchableOpacity
          style={styles.fabOverlay}
          activeOpacity={1}
          onPress={onToggle}
        >
          <View style={styles.fabMenu} onStartShouldSetResponder={() => true}>
            {resolvedItems.map((item) => {
              if (item.isBookButton) {
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.fabMenuItemBook}
                    onPress={() => {
                      onToggle();
                      item.onPress();
                    }}
                  >
                    {renderIcon(item)}
                    <Text style={styles.fabMenuLabelBook}>{item.label}</Text>
                  </TouchableOpacity>
                );
              }

              return (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.fabMenuItem,
                    item.isActive && styles.fabMenuItemActive,
                    item.isLeague && styles.fabMenuItemLeague,
                  ]}
                  onPress={() => {
                    onToggle();
                    item.onPress();
                  }}
                >
                  <View style={styles.fabMenuIconContainer}>
                    {renderIcon(item)}
                    {item.badge !== undefined && item.badge > 0 && (
                      <View style={styles.fabMenuItemBadge}>
                        <Text style={styles.fabMenuItemBadgeText}>
                          {item.badge > 99 ? '99+' : item.badge}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.fabMenuLabel,
                      item.isActive && styles.fabMenuLabelActive,
                      item.isLeague && styles.fabMenuLabelLeague,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 24,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowColor: '#9BDDFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fabIcon: {
    fontSize: 24,
    color: '#000000',
    fontWeight: 'bold',
  },
  fabOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    padding: 24,
    paddingBottom: 100,
  },
  fabMenu: {
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    minWidth: 220,
    padding: 8,
  },
  fabMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  fabMenuItemActive: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.3)',
  },
  fabMenuItemLeague: {
    backgroundColor: acdlBlueAlpha(0.18),
    borderWidth: 1,
    borderColor: acdlBlueAlpha(0.35),
  },
  leagueCrest: {
    width: 22,
    height: 22,
  },
  fabMenuLabel: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  fabMenuLabelActive: {
    color: '#9BDDFF',
  },
  fabMenuLabelLeague: {
    color: ACDL_BLUE,
  },
  fabMenuIconContainer: {
    position: 'relative',
  },
  fabMenuItemBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    backgroundColor: '#EF4444',
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000000',
  },
  fabMenuItemBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFFFFF',
    paddingHorizontal: 3,
  },
  fabMenuItemBook: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#9BDDFF',
    marginTop: 8,
  },
  fabMenuLabelBook: {
    fontSize: 16,
    color: '#000000',
    fontWeight: '600',
  },
  fabNotificationBadge: {
    position: 'absolute',
    top: -4,
    left: -4,
    minWidth: 24,
    height: 24,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#000000',
    zIndex: 20,
  },
  fabNotificationBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFFFFF',
    paddingHorizontal: 4,
  },
});
