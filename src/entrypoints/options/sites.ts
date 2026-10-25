// Conversions between the site list text area and the stored pattern list, and the per-line
// validation shown under it.

import { parsePatterns } from '@/core/site-filter';

export function listToText(list: readonly string[]): string {
  return list.join('\n');
}

/**
 * The list to store for the text area's content: one entry per line, trailing spaces and trailing
 * blank lines removed. Comments, blank lines in between and invalid lines are kept as written.
 */
export function textToList(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  while (lines.at(-1) === '') lines.pop();
  return lines;
}

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

export interface InvalidLine {
  /** 1-based line number in the text area. */
  line: number;
  /** The line as written, without surrounding spaces. */
  text: string;
}

/** Lines that are not a site pattern (and not blank or a comment), so the filter ignores them. */
export function invalidLines(text: string): InvalidLine[] {
  return text
    .split(/\r?\n/)
    .flatMap((raw, i) =>
      parsePatterns([raw]).invalid.length > 0 ? [{ line: i + 1, text: raw.trim() }] : [],
    );
}

/** Whether the list names at least one valid site. */
export function hasPatterns(list: readonly string[]): boolean {
  return parsePatterns(list).patterns.length > 0;
}
