// A problem report: a new GitHub issue with the Find On version and browser filled in. Nothing
// about the user's pages goes in unless they add it.

import { REPO_URL } from '@/ui/RepoLink';

/** "Microsoft Edge 141" or "Chrome 141"; any other user agent is returned whole. */
export function browserName(userAgent: string): string {
  const edge = /\bEdg\/(\d+)/.exec(userAgent);
  if (edge) return `Microsoft Edge ${edge[1]}`;
  const chrome = /\bChrome\/(\d+)/.exec(userAgent);
  return chrome ? `Chrome ${chrome[1]}` : userAgent;
}

export function reportUrl(version: string, userAgent: string): string {
  const body = [
    '### What happened',
    '',
    '',
    '### Page URL (optional)',
    '',
    '',
    '---',
    `Find On ${version} · ${browserName(userAgent)}`,
  ].join('\n');
  return `${REPO_URL}/issues/new?body=${encodeURIComponent(body)}`;
}
