import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface NumericKeypadProps {
  onKeyPress: (key: string) => void;
  onBackspace: () => void;
  onDone: () => void;
  showDecimal?: boolean;
  hasNextField?: boolean;
}

export default function NumericKeypad({
  onKeyPress,
  onBackspace,
  onDone,
  showDecimal = true,
  hasNextField = false,
}: NumericKeypadProps) {
  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [showDecimal ? '.' : '', '0', 'backspace'],
  ];

  const renderKey = (key: string) => {
    if (key === '') {
      return <View key="empty" style={styles.key} />;
    }

    if (key === 'backspace') {
      return (
        <TouchableOpacity
          key={key}
          style={styles.key}
          onPress={onBackspace}
          activeOpacity={0.6}
        >
          <Text style={styles.backspaceText}>⌫</Text>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        key={key}
        style={styles.key}
        onPress={() => onKeyPress(key)}
        activeOpacity={0.6}
      >
        <Text style={styles.keyText}>{key}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.keypadContainer}>
        {keys.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map(renderKey)}
          </View>
        ))}
      </View>
      <TouchableOpacity style={styles.doneButton} onPress={onDone} activeOpacity={0.7}>
        <Text style={styles.doneText}>{hasNextField ? 'Next →' : 'Done'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1A1A1A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingBottom: 8,
  },
  keypadContainer: {
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  key: {
    flex: 1,
    height: 44,
    margin: 3,
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyText: {
    fontSize: 22,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  backspaceText: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  doneButton: {
    marginHorizontal: 8,
    marginTop: 6,
    marginBottom: 4,
    height: 40,
    backgroundColor: '#10B981',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
