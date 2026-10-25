// Small helpers shared by the providers. Pure TS.

import type { Discussion, SourceState } from '../types';

export type OkState = Extract<SourceState, { status: 'ok' }>;

/** Whether anything matched the page itself (SAME or EXACT), as opposed to other versions. */
export function hasStrongMatch(items: readonly Discussion[]): boolean {
  return items.some((d) => d.tier !== 'similar');
}

export function numberOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
