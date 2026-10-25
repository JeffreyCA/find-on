// Badge text and colours, and number formatting. Pure TS, no browser APIs.

import { SOURCE_IDS, type LookupResult } from './types';

// One neutral style for every count, on every toolbar. The badge overlaps the green icon (#167c63),
// so it is near-black rather than mid-grey: 3.3:1 against the icon, where a mid-grey would all but
// vanish. White digits on it are 16:1 and read on light and dark toolbars alike; on a dark toolbar
// the badge's outer edge blends in, but its digits and its edge against the icon stay clear.
export const BADGE_BACKGROUND = '#1F2124';
export const BADGE_TEXT = '#FFFFFF';

/**
 * Badge text for the toolbar icon: SAME and EXACT discussions (or their comments), not counting the
 * thread the page itself is, so a discussion page alone lights nothing. '' when nothing counts.
 */
export function badgeText(r: LookupResult, mode: 'discussions' | 'comments'): string {
  const from = r.page.resolvedFrom ?? r.page.noLink;
  let n = 0;
  for (const id of SOURCE_IDS) {
    const state = r.sources[id];
    if (state.status !== 'ok') continue;
    for (const d of state.items) {
      if (d.tier === 'similar' || (d.source === from?.source && d.id === from.id)) continue;
      n += mode === 'comments' ? d.comments : 1;
    }
  }
  return n > 0 ? compactNumber(n) : '';
}

const UNITS = [
  { size: 1e9, suffix: 'B' },
  { size: 1e6, suffix: 'M' },
  { size: 1e3, suffix: 'k' },
] as const;

/**
 * At most 4 characters for non-negative numbers: `7`, `42`, `999`, `1.2k`, `12k`, `999k`, `1.2M`.
 * One decimal only while the integer part is a single digit, and always rounded down, so a count is
 * never overstated and never grows a fifth character ("1000k").
 */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n < 0) return `-${compactNumber(-n)}`;
  const whole = Math.floor(n);
  for (const { size, suffix } of UNITS) {
    if (whole < size) continue;
    const tenths = Math.floor(whole / (size / 10));
    return `${tenths < 100 ? tenths / 10 : Math.floor(tenths / 10)}${suffix}`;
  }
  return String(whole);
}
