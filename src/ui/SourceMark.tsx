// The small mark that tells Hacker News and Reddit apart at a glance: each site's own favicon.
// Always shown next to the source's name ("HN", "r/sub", "Reddit"), never instead of it.

import hnIcon from '@/assets/sources/hn.svg';
import redditIcon from '@/assets/sources/reddit.png';
import type { SourceId } from '@/core/types';

const ICONS: Record<SourceId, string> = { hn: hnIcon, reddit: redditIcon };

export function SourceMark({ source }: { source: SourceId }) {
  return <img class="mark" src={ICONS[source]} alt="" aria-hidden="true" draggable={false} />;
}
