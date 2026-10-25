// The small mark that tells Hacker News and Reddit apart at a glance: a square for HN and a circle
// for Reddit, each in its own colour, so neither shape nor colour has to carry it alone. Always
// shown next to the source's name ("HN", "r/sub", "Reddit"), never instead of it.

import type { SourceId } from '@/core/types';

export function SourceMark({ source }: { source: SourceId }) {
  return (
    <svg
      class={`mark mark-${source}`}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      {source === 'hn' ? (
        <rect x="1" y="1" width="8" height="8" rx="1.5" />
      ) : (
        <circle cx="5" cy="5" r="4.5" />
      )}
    </svg>
  );
}
