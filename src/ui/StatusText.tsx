// Short status facts ("Saved", "Signed in", "Line 4 ignored ...").

import type { ComponentChildren } from 'preact';
import { cx } from './cx';
import { CheckIcon, WarningIcon } from './icons';

export type StatusTone = 'muted' | 'ok' | 'attention';

interface StatusTextProps {
  tone?: StatusTone;
  children: ComponentChildren;
  /** Fade out (keeps its space, so nothing around it moves). */
  fading?: boolean;
  /** Announce changes to screen readers. */
  live?: boolean;
}

export function StatusText({
  tone = 'muted',
  children,
  fading = false,
  live = false,
}: StatusTextProps) {
  return (
    <span
      class={cx('status-text', tone !== 'muted' && `is-${tone}`, fading && 'is-fading')}
      {...(live && { role: 'status', 'aria-live': 'polite' })}
    >
      {tone === 'ok' && <CheckIcon />}
      {tone === 'attention' && <WarningIcon />}
      {children}
    </span>
  );
}
