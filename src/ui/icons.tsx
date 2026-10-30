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

/** A post submitted with the page's URL: two links of a chain. */
export function LinkPostIcon() {
  return (
    <Svg size={12}>
      <path d="M5.25 3.75 6.5 2.5a2 2 0 0 1 2.83 2.83L8.08 6.58M6.75 8.25 5.5 9.5a2 2 0 0 1-2.83-2.83l1.25-1.25M4.75 7.25l2.5-2.5" />
    </Svg>
  );
}

/** A text post: a page with lines of text. */
export function TextPostIcon() {
  return (
    <Svg size={12}>
      <path d="M3 1.75h6v8.5H3zM4.75 4.25h2.5M4.75 6h2.5M4.75 7.75h1.5" />
    </Svg>
  );
}

/** Comments: a speech bubble. */
export function CommentIcon() {
  return (
    <Svg size={12}>
      <path d="M2.25 2.5h7.5v5.25H5.5L3 9.75v-2h-.75z" />
    </Svg>
  );
}

/** Points and upvotes: an arrow pointing up. */
export function PointsIcon() {
  return (
    <Svg size={12}>
      <path d="M6 10V2.25M2.75 5.5 6 2.25 9.25 5.5" />
    </Svg>
  );
}

/** Close: a cross. */
export function CloseIcon() {
  return (
    <Svg size={12}>
      <path d="M3 3l6 6M9 3 3 9" />
    </Svg>
  );
}

/** An arrow pointing up and out: the link opens another site. */
export function ExternalIcon() {
  return (
    <Svg size={12}>
      <path d="M4.25 2.75h5v5M9.25 2.75l-6.5 6.5" />
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

/** GitHub's mark (Octicons `mark-github`), filled rather than stroked. */
export function GitHubIcon() {
  return (
    <Svg size={16}>
      <path
        fill="currentColor"
        stroke="none"
        d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"
      />
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
