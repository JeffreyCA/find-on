// Line icons drawn with currentColor (style: .icon in base.css). All are decorative: the control
// that holds one carries the accessible name.

import type { ComponentChildren } from 'preact';

function Svg({ size, children }: { size: number; children: ComponentChildren }) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function RecheckIcon() {
  return (
    <Svg size={16}>
      <path d="M13.2 8.6A5.25 5.25 0 1 1 11.9 4.3" />
      <path d="M12.6 1.9v2.9H9.7" />
    </Svg>
  );
}

export function SettingsIcon() {
  return (
    <Svg size={16}>
      <path d="M2 4.75h7.5M12.5 4.75H14M2 11.25h1.5M6.5 11.25H14" />
      <circle cx="11" cy="4.75" r="1.6" />
      <circle cx="5" cy="11.25" r="1.6" />
    </Svg>
  );
}

/** Largest first: a down arrow beside bars getting shorter. */
export function SortIcon() {
  return (
    <Svg size={14}>
      <path d="M3.5 2.25v9.5M1.5 9.75l2 2 2-2" />
      <path d="M7.5 3.25h5M7.5 7h3.5M7.5 10.75h2" />
    </Svg>
  );
}

/** Points right when closed and down when open. */
export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <Svg size={12}>
      {open ? <path d="M2.75 4.5 6 7.75 9.25 4.5" /> : <path d="M4.5 2.75 7.75 6 4.5 9.25" />}
    </Svg>
  );
}

export function CheckIcon() {
  return (
    <Svg size={12}>
      <path d="M2.5 6.25 5 8.75l4.5-5.5" />
    </Svg>
  );
}

export function WarningIcon() {
  return (
    <Svg size={12}>
      <path d="M6 1.6 10.9 10.1H1.1Z" />
      <path d="M6 5v2.2M6 8.55v.05" />
    </Svg>
  );
}
