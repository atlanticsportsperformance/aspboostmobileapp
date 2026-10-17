/** Chrome-ringed stat bubble (REPS / SET / BAR / SPEED DROP) beside the dial. */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { RACK_COLORS } from '../../lib/rack/viewModel';

export interface StatBubbleProps {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  size?: number;
}

export default function StatBubble({ label, value, sub, valueColor = '#fff', size = 124 }: StatBubbleProps) {
  const k = size / 124;
  // CSS: box-shadow rings 5px #2a2d31, 7px #8b9096, 9px #2a2d31 around a radial face.
  const outer = size + 18 * k;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={outer} height={outer} style={{ position: 'absolute', left: -9 * k, top: -9 * k }} viewBox="0 0 142 142">
        <Defs>
          <RadialGradient id="bf" cx="0.5" cy="0.35" r="0.7">
            <Stop offset="0" stopColor="#24272b" />
            <Stop offset="1" stopColor="#0e0f11" />
          </RadialGradient>
        </Defs>
        <Circle cx={71} cy={71} r={71} fill="#2a2d31" />
        <Circle cx={71} cy={71} r={69} fill="#8b9096" />
        <Circle cx={71} cy={71} r={67} fill="#2a2d31" />
        <Circle cx={71} cy={71} r={62} fill="url(#bf)" />
      </Svg>
      <Text style={[styles.k, { fontSize: 10 * k }]}>{label}</Text>
      <Text style={[styles.x, { fontSize: 34 * k, lineHeight: 38 * k, color: valueColor }]} numberOfLines={1}>
        {value}
      </Text>
      {!!sub && <Text style={[styles.s, { fontSize: 11 * k }]} numberOfLines={1}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  k: { fontWeight: '900', letterSpacing: 1.6, color: 'rgba(255,255,255,0.5)' },
  x: { fontWeight: '800', fontVariant: ['tabular-nums'] },
  s: { color: RACK_COLORS.mut },
});
