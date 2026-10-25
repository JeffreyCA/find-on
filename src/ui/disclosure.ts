// The one-line privacy disclosure shown wherever the user decides how pages are checked (popup
// first-use choice, options page). The welcome page states it in full.

import type { Settings } from '@/platform/settings';

/** What is sent where with these sources on; null when both are off and nothing is sent. */
export function disclosure({ hn, reddit }: Settings['sources']): string | null {
  if (hn && reddit) {
    return 'Page URLs are sent to hn.algolia.com and reddit.com. Reddit requests use your reddit.com session.';
  }
  if (hn) return 'Page URLs are sent to hn.algolia.com.';
  if (reddit) return 'Page URLs are sent to reddit.com, using your reddit.com session.';
  return null;
}
