import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildDisciplineRail,
  buildIncludeLines,
  buildTermOptions,
  disciplineColor,
  disciplineForCategoryName,
  disciplinesForPlan,
  initialsFor,
  pickFeaturedPlan,
  planSummaryLine,
  remoteCategoryIds,
  PlanLike,
} from '../lib/membershipDisciplines';

// Fixtures mirror the shape of real membership_types rows (metadata.service_groupings
// + membership_pricing_options) as of 2026-09.
const STRENGTH = {
  id: 'cd13e1b5',
  name: 'Strength + Conditioning',
  type: 'category',
  color: '#10b981',
  is_unlimited: true,
  visits_allocated: '1',
};

const pitching: PlanLike = {
  id: 'p1',
  name: 'Pitching Performance',
  price_amount: 45000,
  metadata: {
    service_groupings: [
      STRENGTH,
      { id: '9aacdc2b', name: 'Pitching Performance', type: 'category', color: '#ef4444', is_unlimited: true, visits_allocated: '1' },
    ],
  },
  pricing_options: [
    { id: 'o6', label: '6-month commitment', price_amount: 37500, commitment_months: 6, is_active: true, sort_order: 1 },
    { id: 'o3', label: '3-month commitment', price_amount: 40000, commitment_months: 3, is_active: true, sort_order: 0 },
  ],
};

const collegePitching: PlanLike = {
  id: 'p2',
  name: 'College Pitching Performance',
  price_amount: 25000,
  metadata: {
    service_groupings: [
      { id: '9aacdc2b', name: 'Pitching Performance', type: 'category', color: '#ef4444', is_unlimited: true, visits_allocated: '1' },
      STRENGTH,
    ],
  },
};

const remote: PlanLike = {
  id: 'p3',
  name: 'Remote Pitching',
  price_amount: 35000,
  metadata: {
    service_groupings: [
      { id: '4be01c44', name: 'Remote Pitching', type: 'category', color: '#f97316', is_unlimited: true, visits_allocated: '1' },
      { ...STRENGTH, is_unlimited: false },
      { id: '9aacdc2b', name: 'Pitching Performance', type: 'category', color: '#ef4444', is_unlimited: false, visits_allocated: '1' },
    ],
  },
  pricing_options: [
    { id: 'r3', label: '3-month commitment', price_amount: 30000, commitment_months: 3, is_active: true, sort_order: 0 },
  ],
};

const twoWay: PlanLike = {
  id: 'p4',
  name: 'Two Way Membership (Hitter/Pitcher 13+)',
  price_amount: 55000,
  metadata: {
    service_groupings: [
      { id: '9aacdc2b', name: 'Pitching Performance', type: 'category', color: '#ef4444', is_unlimited: true, visits_allocated: '1' },
      STRENGTH,
      { id: 'bac4678b', name: 'Hitting Performance (13+)', type: 'template', is_unlimited: true, visits_allocated: '1' },
    ],
  },
};

const catching: PlanLike = {
  id: 'p5',
  name: 'Catching Performance Membership',
  price_amount: 40000,
  metadata: {
    service_groupings: [
      { id: '76ddeffb', name: 'Catching Performance', type: 'category', color: '#8b5cf6', is_unlimited: true, visits_allocated: '1' },
    ],
  },
};

const softball: PlanLike = {
  id: 'p6',
  name: 'Softball Pitching Performance',
  price_amount: 40000,
  metadata: {
    service_groupings: [
      { id: '6399fae5', name: 'SB Pitching Performance', type: 'category', color: '#84cc16', is_unlimited: true, visits_allocated: '1' },
      { id: '2ff7d610', name: 'Strength and Conditioning (13+)', type: 'template', is_unlimited: true, visits_allocated: '1' },
    ],
  },
};

const ALL = [pitching, collegePitching, remote, twoWay, catching, softball];

describe('a coverage category resolves to one discipline', () => {
  it('reads the discipline out of the category name', () => {
    expect(disciplineForCategoryName('Pitching Performance')).toBe('Pitching');
    expect(disciplineForCategoryName('Hitting Performance (13+)')).toBe('Hitting');
    expect(disciplineForCategoryName('Catching Performance')).toBe('Catching');
  });

  it('files remote pitching under Remote, not Pitching', () => {
    expect(disciplineForCategoryName('Remote Pitching')).toBe('Remote');
  });

  it('files softball pitching under Softball, not Pitching', () => {
    expect(disciplineForCategoryName('SB Pitching Performance')).toBe('Softball');
    expect(disciplineForCategoryName('Softball Hitting')).toBe('Softball');
  });

  it('tolerates the "Catcing" typo that exists in production category names', () => {
    expect(disciplineForCategoryName('Catcing Performance')).toBe('Catching');
  });

  it('never treats strength work as a discipline — it is in every plan', () => {
    expect(disciplineForCategoryName('Strength + Conditioning')).toBeNull();
    expect(disciplineForCategoryName('Strength and Conditioning (13+)')).toBeNull();
  });
});

describe('a plan belongs to the disciplines it covers without limit', () => {
  it('puts a two-way plan under both of its unlimited disciplines', () => {
    expect(disciplinesForPlan(twoWay).sort()).toEqual(['Hitting', 'Pitching']);
  });

  it('ignores limited groupings, so the remote plan is not a pitching plan', () => {
    expect(disciplinesForPlan(remote)).toEqual(['Remote']);
  });
});

describe('the discipline rail', () => {
  const rail = buildDisciplineRail(ALL);

  it('is ordered Pitching, Remote, Hitting, Catching, Softball', () => {
    expect(rail.map((r) => r.discipline)).toEqual([
      'Pitching',
      'Remote',
      'Hitting',
      'Catching',
      'Softball',
    ]);
  });

  it('hides a discipline no plan covers', () => {
    const only = buildDisciplineRail([catching]);
    expect(only.map((r) => r.discipline)).toEqual(['Catching']);
  });

  it('groups every matching plan under its pill', () => {
    const pitchingRail = rail.find((r) => r.discipline === 'Pitching')!;
    expect(pitchingRail.plans.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p4']);
  });

  it('takes the pill dot color from the coverage grouping', () => {
    expect(rail.find((r) => r.discipline === 'Pitching')!.color).toBe('#ef4444');
    expect(rail.find((r) => r.discipline === 'Remote')!.color).toBe('#f97316');
  });

  it('falls back to a discipline color when the grouping is a colorless template', () => {
    // Hitting only ever arrives as a template grouping, which carries no color.
    expect(disciplineColor('Hitting', [twoWay])).toBe('#3b82f6');
  });
});

describe('the featured plan', () => {
  it('prefers the most tab-specific plan — Pitching Performance beats Two Way', () => {
    expect(pickFeaturedPlan([pitching, collegePitching, twoWay])!.id).toBe(pitching.id);
  });

  it('a single-discipline plan beats a broader one even with less coverage', () => {
    expect(pickFeaturedPlan([collegePitching, twoWay])!.id).toBe(collegePitching.id);
  });

  it('breaks a tie on the higher price', () => {
    expect(pickFeaturedPlan([collegePitching, pitching])!.id).toBe(pitching.id);
  });

  it('is null when the discipline has no plans', () => {
    expect(pickFeaturedPlan([])).toBeNull();
  });
});

describe('the term picker', () => {
  it('offers monthly plus every active commitment, cheapest last-sorted by term', () => {
    const { terms } = buildTermOptions(pitching);
    expect(terms.map((t) => t.label)).toEqual(['MONTHLY', '3 MONTHS', '6 MONTHS']);
    expect(terms.map((t) => t.priceCents)).toEqual([45000, 40000, 37500]);
  });

  it('computes SAVE as base minus the committed price', () => {
    const { terms } = buildTermOptions(pitching);
    expect(terms.map((t) => t.saveCents)).toEqual([0, 5000, 7500]);
  });

  it('pre-selects the cheapest per-month price', () => {
    expect(buildTermOptions(pitching).cheapest!.optionId).toBe('o6');
    expect(buildTermOptions(remote).cheapest!.commitmentMonths).toBe(3);
  });

  it('is just the monthly box when the plan has no commitment options', () => {
    const { terms, cheapest } = buildTermOptions(catching);
    expect(terms).toHaveLength(1);
    expect(cheapest!.optionId).toBeNull();
    expect(cheapest!.priceCents).toBe(40000);
  });
});

describe('the includes list', () => {
  it('reads unlimited coverage as unlimited sessions, gym as strength & conditioning', () => {
    expect(buildIncludeLines(pitching)).toEqual([
      { text: 'Unlimited strength & conditioning' },
      { text: 'Unlimited Pitching Performance sessions' },
    ]);
  });

  it('shows limited coverage as a per-month visit count, and adds the remote link line', () => {
    expect(buildIncludeLines(remote)).toEqual([
      { text: 'Unlimited Remote Pitching sessions' },
      { text: '1 strength & conditioning visit', hint: 'per month' },
      { text: '1 Pitching Performance visit', hint: 'per month' },
      { text: 'Video call link on every booking' },
    ]);
  });

  it('does not claim a video link on an in-person plan', () => {
    expect(buildIncludeLines(catching).some((l) => /video call/i.test(l.text))).toBe(false);
  });
});

describe('supporting details', () => {
  it('summarises a compact row from its unlimited coverage', () => {
    expect(planSummaryLine(twoWay)).toBe(
      'Pitching Performance · Strength + Conditioning · Hitting Performance (13+)'
    );
  });

  it('gives the remote coach lookup the plan’s remote category ids only', () => {
    expect(remoteCategoryIds(remote)).toEqual(['4be01c44']);
    expect(remoteCategoryIds(pitching)).toEqual([]);
  });

  it('makes avatar initials from a coach name', () => {
    expect(initialsFor('Justin Willis')).toBe('JW');
    expect(initialsFor('Cher')).toBe('C');
    expect(initialsFor('')).toBe('');
  });
});

// ---- Screen wiring -----------------------------------------------------
const SOURCE = readFileSync(
  join(__dirname, '..', 'screens', 'MembershipsPackagesScreen.tsx'),
  'utf8'
);

describe('the memberships tab is wired to the helper, not to hardcoded plans', () => {
  it('imports the derivation helper', () => {
    expect(SOURCE).toContain("from '../lib/membershipDisciplines'");
    expect(SOURCE).toContain('buildDisciplineRail');
    expect(SOURCE).toContain('pickFeaturedPlan');
    expect(SOURCE).toContain('buildTermOptions');
    expect(SOURCE).toContain('buildIncludeLines');
  });

  it('renders the rail, the featured panel, compact rows and the caption', () => {
    expect(SOURCE).toContain('renderPlanFinder');
    expect(SOURCE).toContain('styles.discPill');
    expect(SOURCE).toContain('styles.featuredPlan');
    expect(SOURCE).toContain('styles.miniRow');
    expect(SOURCE).toContain('styles.finderCaption');
  });

  it('names no plan, price, discipline or coach in the JSX', () => {
    const jsx = SOURCE.slice(SOURCE.indexOf('function renderPlanFinder'));
    expect(jsx).not.toMatch(/Pitching Performance|Remote Pitching|Two Way/);
    expect(jsx).not.toMatch(/\$\d{3}/);
  });

  it('keeps the header title and subtitle from the approved design', () => {
    expect(SOURCE).toContain('Find your plan');
    expect(SOURCE).toContain('Pick what you train');
  });

  it('captions the remote tab differently from the in-building tabs', () => {
    expect(SOURCE).toContain('Sessions happen over Google Meet');
    expect(SOURCE).toContain('Cancel or manage anytime in Settings');
  });

  it('resolves the remote coach from scheduling templates, not a constant', () => {
    expect(SOURCE).toContain('scheduling_templates');
    expect(SOURCE).toContain('is_remote');
    expect(SOURCE).toContain('default_staff_id');
    expect(SOURCE).toContain('remoteCoach');
  });

  it('purchases go through the expanded panel; tapping a compact row expands it (accordion)', () => {
    expect(SOURCE.split('openMembershipPurchase(').length).toBeGreaterThanOrEqual(2); // definition + panel CTA
    expect(SOURCE).toContain('expandedPlanByDiscipline');
    expect(SOURCE).toContain('const rowsBefore = orderedPlans.slice(0, panelIndex);');
    expect(SOURCE).toContain('rowsAfter.map((type) => renderCollapsedRow(type))');
    expect(SOURCE).toContain('LayoutAnimation.configureNext');
    expect(SOURCE).toContain('onPress={() => expandPlan(type.id)}');
  });

  it('still shows an eligibility block on a gated plan', () => {
    expect(SOURCE).toContain('ineligible_message');
  });
});
