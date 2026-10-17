export const LOGGER_COLORS = {
  bg: '#0A0A0A',
  accent: '#9BDDFF',
  accentEnd: '#5BB8E8',
  green: '#10B981',
  // Logged values in the exercise table (lighter than the ✓ fill).
  greenText: '#6EE7B7',
  // RPE + PR markers are faint white (no amber).
  rpe: 'rgba(255,255,255,0.45)', // RPE label / text
  rpeBorder: 'rgba(255,255,255,0.12)', // RPE buttons
  rpeTarget: 'rgba(255,255,255,0.45)', // coach-target RPE button border
  rpeSelected: 'rgba(255,255,255,0.14)', // chosen RPE button fill
  prBorder: 'rgba(255,255,255,0.18)', // 🏆 pill border
  prText: 'rgba(255,255,255,0.7)', // 🏆 pill text
  text: '#FFFFFF',
  muted: '#A3A3A3',
  hairline: 'rgba(255,255,255,0.08)',
} as const;
