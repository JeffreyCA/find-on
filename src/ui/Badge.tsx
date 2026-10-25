// Small brand pieces: the icon as an image and a preview of the toolbar badge.

import iconUrl from '@/assets/icon.svg';
import { BADGE_BACKGROUND, BADGE_TEXT, compactNumber } from '@/core/format';

/** The extension icon, decorative (the name is always written next to it). */
export function Logo({ size = 20 }: { size?: number }) {
  return <img src={iconUrl} width={size} height={size} alt="" />;
}

/** The toolbar badge as it renders for `value`, using the real colours and number format. */
export function BadgeChip({ value }: { value: number }) {
  return (
    <span class="badge-chip" style={{ background: BADGE_BACKGROUND, color: BADGE_TEXT }}>
      {compactNumber(value)}
    </span>
  );
}
