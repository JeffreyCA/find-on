// The release notes of one version, read from CHANGELOG.md (bundled into the options page as text).

export interface ReleaseNotes {
  version: string;
  /** As written in the changelog, e.g. "2026-10-26". */
  date: string;
  /** "Added", "Changed", "Fixed", ... with their entries, in changelog order. */
  groups: Array<{ title: string; items: string[] }>;
}

/**
 * The notes of `version` in a Keep a Changelog file: the entries under its "## [x.y.z] - date"
 * heading, grouped by their "###" headings. Null when the changelog has no section for it.
 */
export function releaseNotes(changelog: string, version: string): ReleaseNotes | null {
  const lines = changelog.split(/\r?\n/);
  const heading = `## [${version}]`;
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) return null;
  const date = /-\s*(\S+)\s*$/.exec(lines[start] ?? '')?.[1] ?? '';
  const groups: ReleaseNotes['groups'] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    const title = /^###\s+(.+)$/.exec(line)?.[1];
    const group = groups.at(-1);
    if (title !== undefined) groups.push({ title: title.trim(), items: [] });
    else if (line.startsWith('- ') && group) group.items.push(line.slice(2).trim());
  }
  return { version, date, groups: groups.filter((g) => g.items.length > 0) };
}

/** A run of a changelog entry: plain text, `code` or a [link](url), and where it starts. */
export type Inline = { start: number; text: string } & (
  | { kind: 'text' }
  | { kind: 'code' }
  | { kind: 'link'; url: string }
);

/** Splits an entry's inline markdown. Only http(s) links become links; others stay text. */
export function inlineParts(entry: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let end = 0;
  for (const match of entry.matchAll(pattern)) {
    const start = match.index;
    if (start > end) parts.push({ kind: 'text', start: end, text: entry.slice(end, start) });
    const [whole, code, label, url] = match;
    if (code !== undefined) parts.push({ kind: 'code', start, text: code });
    else if (label !== undefined && url !== undefined && /^https?:\/\//.test(url)) {
      parts.push({ kind: 'link', start, text: label, url });
    } else parts.push({ kind: 'text', start, text: label ?? whole });
    end = start + whole.length;
  }
  if (end < entry.length) parts.push({ kind: 'text', start: end, text: entry.slice(end) });
  return parts;
}
