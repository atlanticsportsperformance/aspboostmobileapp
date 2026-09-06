/**
 * Discipline derivation for the Memberships tab.
 *
 * Everything here is pure: the screen hands us the membership types it already
 * fetched (with `metadata.service_groupings` and `membership_pricing_options`)
 * and gets back the rail, the featured plan, the term boxes and the "includes"
 * lines. No plan name, price, discipline list or coach name is hardcoded in the
 * screen — a new membership type slots in by virtue of its coverage.
 */

export type Discipline = 'Pitching' | 'Remote' | 'Hitting' | 'Catching' | 'Softball';

/** Rail order. A discipline with no plans is dropped by buildDisciplineRail. */
export const DISCIPLINE_ORDER: Discipline[] = [
  'Pitching',
  'Remote',
  'Hitting',
  'Catching',
  'Softball',
];

/** Used when the coverage grouping carries no color of its own (templates don't). */
export const DISCIPLINE_FALLBACK_COLOR: Record<Discipline, string> = {
  Pitching: '#ef4444',
  Remote: '#F5A96B',
  Hitting: '#3b82f6',
  Catching: '#8b5cf6',
  Softball: '#84cc16',
};

export interface PlanGrouping {
  type?: string;
  id?: string;
  name: string;
  color?: string;
  visits_allocated?: string | number;
  is_unlimited?: boolean;
}

export interface PlanPricingOption {
  id: string;
  label?: string;
  price_amount: number;
  commitment_months: number;
  is_active?: boolean;
  is_default?: boolean;
  sort_order?: number;
}

export interface PlanLike {
  id: string;
  name: string;
  price_amount?: number | null;
  metadata?: { service_groupings?: PlanGrouping[] } | any;
  pricing_options?: PlanPricingOption[];
}

/** Coverage groupings of a membership type, defensively. */
export function planGroupings(plan: PlanLike): PlanGrouping[] {
  const g = plan?.metadata?.service_groupings;
  return Array.isArray(g) ? (g as PlanGrouping[]) : [];
}

/** True for the "Strength + Conditioning" / gym grouping, which is never a discipline. */
export function isStrengthGrouping(name: string): boolean {
  return /strength|conditioning/i.test(name || '');
}

/**
 * Map one coverage category/template name onto a discipline.
 *
 * Ordered — "Remote Pitching" is Remote, not Pitching, and "SB Pitching
 * Performance" is Softball, not Pitching. Strength is never a discipline.
 */
export function disciplineForCategoryName(name: string): Discipline | null {
  const n = (name || '').trim();
  if (!n) return null;
  if (isStrengthGrouping(n)) return null;
  if (/remote/i.test(n)) return 'Remote';
  if (/\bSB\b/.test(n) || /softball/i.test(n)) return 'Softball';
  if (/pitching/i.test(n)) return 'Pitching';
  if (/hitting/i.test(n)) return 'Hitting';
  // "Catcing" is a real typo in production category names.
  if (/catch?ing/i.test(n)) return 'Catching';
  return null;
}

/**
 * Disciplines a plan belongs to. Limited (`is_unlimited === false`) groupings
 * are ignored for tab assignment — the Remote plan's 1/mo in-building gym and
 * pitching visits must not file it under Pitching.
 */
export function disciplinesForPlan(plan: PlanLike): Discipline[] {
  const out: Discipline[] = [];
  for (const g of planGroupings(plan)) {
    if (g.is_unlimited === false) continue;
    const d = disciplineForCategoryName(g.name);
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/** Color for a discipline pill, taken from the first grouping that supplies one. */
export function disciplineColor(discipline: Discipline, plans: PlanLike[]): string {
  for (const plan of plans) {
    for (const g of planGroupings(plan)) {
      if (g.is_unlimited === false) continue;
      if (disciplineForCategoryName(g.name) === discipline && g.color) return g.color;
    }
  }
  return DISCIPLINE_FALLBACK_COLOR[discipline];
}

export interface RailEntry {
  discipline: Discipline;
  color: string;
  plans: PlanLike[];
}

/** The discipline rail: fixed order, empty disciplines dropped. */
export function buildDisciplineRail(plans: PlanLike[]): RailEntry[] {
  const rail: RailEntry[] = [];
  for (const discipline of DISCIPLINE_ORDER) {
    const matching = (plans || []).filter((p) => disciplinesForPlan(p).includes(discipline));
    if (matching.length === 0) continue;
    rail.push({ discipline, color: disciplineColor(discipline, matching), plans: matching });
  }
  return rail;
}

function unlimitedCount(plan: PlanLike): number {
  return planGroupings(plan).filter((g) => g.is_unlimited !== false).length;
}

/**
 * The most tab-specific plan wins (fewest disciplines — Pitching Performance
 * beats Two Way on the Pitching tab); ties go to more unlimited coverage,
 * then the higher base price.
 */
export function pickFeaturedPlan(plans: PlanLike[]): PlanLike | null {
  if (!plans || plans.length === 0) return null;
  return plans.reduce((best, p) => {
    const bd = disciplinesForPlan(best).length;
    const pd = disciplinesForPlan(p).length;
    if (pd !== bd) return pd < bd ? p : best;
    const bu = unlimitedCount(best);
    const pu = unlimitedCount(p);
    if (pu !== bu) return pu > bu ? p : best;
    return (p.price_amount ?? 0) > (best.price_amount ?? 0) ? p : best;
  });
}

export interface TermOption {
  /** null for the month-to-month base price. */
  optionId: string | null;
  label: string;
  priceCents: number;
  /** base − this price, 0 for the base row. */
  saveCents: number;
  commitmentMonths: number | null;
}

export interface TermPicker {
  terms: TermOption[];
  cheapest: TermOption | null;
}

/**
 * MONTHLY box + one box per active commitment option, cheapest flagged. The
 * commitment price is the per-month price the buyer pays under that term, so
 * SAVE is simply base − option price.
 */
export function buildTermOptions(plan: PlanLike): TermPicker {
  const base = plan?.price_amount ?? 0;
  const terms: TermOption[] = [
    { optionId: null, label: 'MONTHLY', priceCents: base, saveCents: 0, commitmentMonths: null },
  ];
  const options = (plan?.pricing_options || [])
    .filter((o) => o.is_active !== false && (o.commitment_months ?? 0) >= 2)
    .sort((a, b) => (a.commitment_months ?? 0) - (b.commitment_months ?? 0));
  for (const o of options) {
    terms.push({
      optionId: o.id,
      label: `${o.commitment_months} MONTHS`,
      priceCents: o.price_amount,
      saveCents: Math.max(0, base - o.price_amount),
      commitmentMonths: o.commitment_months,
    });
  }
  const cheapest = terms.reduce<TermOption | null>(
    (best, t) => (best === null || t.priceCents < best.priceCents ? t : best),
    null
  );
  return { terms, cheapest };
}

export interface IncludeLine {
  text: string;
  /** Right-aligned hint for limited groupings. */
  hint?: string;
}

/** One ✓ line per coverage grouping, plus the remote video-link line. */
export function buildIncludeLines(plan: PlanLike): IncludeLine[] {
  const lines: IncludeLine[] = [];
  for (const g of planGroupings(plan)) {
    const strength = isStrengthGrouping(g.name);
    if (g.is_unlimited === false) {
      const nRaw = g.visits_allocated;
      const n = typeof nRaw === 'number' ? nRaw : parseInt(String(nRaw ?? '1'), 10) || 1;
      const what = strength ? 'strength & conditioning' : g.name;
      lines.push({ text: `${n} ${what} visit${n === 1 ? '' : 's'}`, hint: 'per month' });
    } else {
      lines.push({
        text: strength ? 'Unlimited strength & conditioning' : `Unlimited ${g.name} sessions`,
      });
    }
  }
  if (disciplinesForPlan(plan).includes('Remote')) {
    lines.push({ text: 'Video call link on every booking' });
  }
  return lines;
}

/** One scannable line for a compact (non-featured) plan row. */
export function planSummaryLine(plan: PlanLike): string {
  const groupings = planGroupings(plan);
  const unlimited = groupings.filter((g) => g.is_unlimited !== false).map((g) => g.name);
  const names = unlimited.length > 0 ? unlimited : groupings.map((g) => g.name);
  return names.join(' · ');
}

/** Category ids a plan covers remotely — used to resolve the remote coach. */
export function remoteCategoryIds(plan: PlanLike): string[] {
  return planGroupings(plan)
    .filter((g) => g.type !== 'template' && !!g.id && disciplineForCategoryName(g.name) === 'Remote')
    .map((g) => g.id as string);
}

/** "Justin Willis" → "JW" for the coach avatar. */
export function initialsFor(name: string): string {
  return (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}
