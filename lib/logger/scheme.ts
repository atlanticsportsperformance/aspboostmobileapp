export type NormalizedScheme = 'straight' | 'grouped' | 'text';

// The DB stores 'straight'; older client code used 'straight_sets'.
export function normalizeScheme(s: string | null | undefined): NormalizedScheme {
  switch (s) {
    case 'superset':
    case 'circuit':
    case 'emom':
    case 'amrap':
    case 'giant_set':
      return 'grouped';
    case 'warm_up':
    case 'notes':
      return 'text';
    default:
      return 'straight';
  }
}
