import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

export interface FABMenuItem {
  id: string;
  label: string;
  icon: string;
  iconFamily?: 'ionicons' | 'material-community';
  onPress: () => void;
  isActive?: boolean;
  badge?: number;
  isBookButton?: boolean;
}

interface FABMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  items: FABMenuItem[];
  totalBadgeCount?: number;
}

export default function FABMenu({
  isOpen,
  onToggle,
  items,
  totalBadgeCount = 0,
}: FABMenuProps) {
  const renderIcon = (item: FABMenuItem) => {
    const iconColor = item.isActive ? '#9BDDFF' : item.isBookButton ? '#000000' : '#FFFFFF';
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
            {items.map((item) => {
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
  fabMenuLabel: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  fabMenuLabelActive: {
    color: '#9BDDFF',
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
