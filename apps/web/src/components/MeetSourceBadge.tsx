import type { CSSProperties } from 'react';

export type MeetTool =
  | 'google_meet'
  | 'teams'
  | 'zoom'
  | 'webex'
  | 'generic';

/** Prefer the join URL; fall back to calendar provider. */
export function resolveMeetTool(
  sourceProvider?: string | null,
  meetLink?: string | null,
): MeetTool {
  const link = (meetLink ?? '').toLowerCase();
  if (
    link.includes('meet.google.com') ||
    link.includes('hangouts.google.com')
  ) {
    return 'google_meet';
  }
  if (link.includes('zoom.us') || link.includes('zoom.com')) return 'zoom';
  if (
    link.includes('teams.microsoft.com') ||
    link.includes('teams.live.com')
  ) {
    return 'teams';
  }
  if (link.includes('webex.com')) return 'webex';

  const provider = (sourceProvider ?? '').toLowerCase();
  if (provider === 'microsoft') return 'teams';
  if (provider === 'google') return 'google_meet';
  return 'generic';
}

const LABELS: Record<MeetTool, string> = {
  google_meet: 'Google Meet',
  teams: 'Microsoft Teams',
  zoom: 'Zoom',
  webex: 'Webex',
  generic: 'Meeting',
};

function GoogleMeetIcon({ size }: { size: number }) {
  // Simplified Google Meet camera mark (brand colors).
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <path
        fill="#00832D"
        d="M12 7.5v9H4.75A1.75 1.75 0 0 1 3 14.75v-5.5C3 8.28 3.78 7.5 4.75 7.5H12z"
      />
      <path
        fill="#0066DA"
        d="M12 7.5h5.25c.97 0 1.75.78 1.75 1.75v5.5c0 .97-.78 1.75-1.75 1.75H12v-9z"
      />
      <path
        fill="#E37400"
        d="M17.25 9.2 21.1 7.05c.42-.23.9.08.9.56v8.78c0 .48-.48.79-.9.56L17.25 14.8V9.2z"
      />
      <path fill="#C5221F" d="M12 12.75H3v2c0 .97.78 1.75 1.75 1.75H12v-3.75z" />
      <path fill="#188038" d="M12 7.5H4.75C3.78 7.5 3 8.28 3 9.25v2H12V7.5z" />
    </svg>
  );
}

function TeamsIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <path
        fill="#5059C9"
        d="M17.5 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"
      />
      <path
        fill="#7B83EB"
        d="M20.75 9H15.5c-.83 0-1.5.67-1.5 1.5V16c0 1.66 1.34 3 3 3h.5c1.93 0 3.5-1.57 3.5-3.5v-5c0-.83-.67-1.5-1.5-1.5z"
      />
      <path
        fill="#4B53BC"
        d="M13.75 8H5.25C4.01 8 3 9.01 3 10.25v6.5C3 19.1 4.9 21 7.25 21h4.5C14.1 21 16 19.1 16 16.75v-6.5C16 9.01 14.99 8 13.75 8z"
      />
      <path
        fill="#fff"
        d="M10.6 11.2h-1.3v4.9H7.9v-4.9H6.6V10h4z"
      />
      <circle cx="9.25" cy="5.25" r="2.75" fill="#7B83EB" />
    </svg>
  );
}

function ZoomIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <rect width="24" height="24" rx="6" fill="#2D8CFF" />
      <path
        fill="#fff"
        d="M5.5 8.25h7.25c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25H5.5c-.69 0-1.25-.56-1.25-1.25v-5c0-.69.56-1.25 1.25-1.25zm10.1 1.35 3.15-2.1c.45-.3 1.05.02 1.05.55v6.9c0 .53-.6.85-1.05.55l-3.15-2.1v-3.8z"
      />
    </svg>
  );
}

function WebexIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <circle cx="12" cy="12" r="10" fill="#00Bceb" />
      <path
        fill="#fff"
        d="M7.2 15.6 10.4 8.4h2.1l1.55 3.55L15.6 8.4h2.1l-3.2 7.2h-2.15l-1.5-3.5-1.5 3.5z"
      />
    </svg>
  );
}

function GenericMeetIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <rect
        x="2.5"
        y="6"
        width="13"
        height="12"
        rx="2.5"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M17 9.5 21.2 7.2c.4-.22.8.07.8.52v8.56c0 .45-.4.74-.8.52L17 14.5z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}

export function MeetToolIcon({
  tool,
  size = 14,
}: {
  tool: MeetTool;
  size?: number;
}) {
  switch (tool) {
    case 'google_meet':
      return <GoogleMeetIcon size={size} />;
    case 'teams':
      return <TeamsIcon size={size} />;
    case 'zoom':
      return <ZoomIcon size={size} />;
    case 'webex':
      return <WebexIcon size={size} />;
    default:
      return <GenericMeetIcon size={size} />;
  }
}

type MeetSourceBadgeProps = {
  sourceProvider?: string | null;
  meetLink?: string | null;
  className?: string;
  size?: number;
  style?: CSSProperties;
};

/** Icon chip for calendar/meet tasks — no “Meet” text. */
export function MeetSourceBadge({
  sourceProvider,
  meetLink,
  className = '',
  size = 14,
  style,
}: MeetSourceBadgeProps) {
  const tool = resolveMeetTool(sourceProvider, meetLink);
  const label = LABELS[tool];
  return (
    <span
      className={`meet-source-badge ${className}`.trim()}
      title={label}
      aria-label={label}
      style={style}
    >
      <MeetToolIcon tool={tool} size={size} />
    </span>
  );
}
