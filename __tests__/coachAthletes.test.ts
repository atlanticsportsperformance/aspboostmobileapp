// aspboost-mobile/__tests__/coachAthletes.test.ts
import { normalizeLinkedAthletes, normalizeOrgAthletes, filterAthletes, type LinkedAthlete } from '../lib/coachAthletes';

describe('normalizeOrgAthletes', () => {
  it('maps athlete rows to LinkedAthlete', () => {
    const rows = [{ id: 'a1', first_name: 'Jake', last_name: 'Doering' }];
    expect(normalizeOrgAthletes(rows as any)).toEqual([{ id: 'a1', firstName: 'Jake', lastName: 'Doering' }]);
  });
});

describe('normalizeLinkedAthletes', () => {
  it('flattens coach_athletes rows into athlete records', () => {
    const rows = [
      { athlete_id: 'a1', athlete: { id: 'a1', first_name: 'Jake', last_name: 'Doering' } },
      { athlete_id: 'a2', athlete: { id: 'a2', first_name: 'Sam', last_name: 'Mitchell' } },
    ];
    const out = normalizeLinkedAthletes(rows as any);
    expect(out).toEqual([
      { id: 'a1', firstName: 'Jake', lastName: 'Doering' },
      { id: 'a2', firstName: 'Sam', lastName: 'Mitchell' },
    ]);
  });
  it('drops rows with a missing athlete join', () => {
    const rows = [{ athlete_id: 'a1', athlete: null }];
    expect(normalizeLinkedAthletes(rows as any)).toEqual([]);
  });
});

describe('filterAthletes', () => {
  const list: LinkedAthlete[] = [
    { id: 'a1', firstName: 'Jake', lastName: 'Doering' },
    { id: 'a2', firstName: 'Sam', lastName: 'Mitchell' },
  ];
  it('matches case-insensitive on first or last name', () => {
    expect(filterAthletes(list, 'jake').map(a => a.id)).toEqual(['a1']);
    expect(filterAthletes(list, 'MITCH').map(a => a.id)).toEqual(['a2']);
  });
  it('returns all when query is empty', () => {
    expect(filterAthletes(list, '   ')).toHaveLength(2);
  });
});
