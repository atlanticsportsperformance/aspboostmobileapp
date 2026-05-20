/**
 * Test-only stub for lib/supabase.ts.
 *
 * The real lib/supabase.ts imports `react-native-url-polyfill/auto` and
 * @react-native-async-storage/async-storage, which are untransformed RN/ESM
 * modules that the ts-jest/node test runner cannot parse. Mapping the import
 * to this stub (via jest.config.js moduleNameMapper) lets us unit-test pure
 * helpers (e.g. buildSessionsUrl) that live alongside supabase-using code,
 * without pulling the native client into the Node test environment.
 */
export const supabase: any = {
  auth: {
    getSession: async () => ({ data: { session: null } }),
  },
};

export function recreateSupabaseClient(): any {
  return supabase;
}
