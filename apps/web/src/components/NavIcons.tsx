import type { ReactNode } from 'react';

/** Distinct sidebar glyphs — stroke icons. */

type IconProps = { size?: number; className?: string };

function Svg({
  size = 20,
  className,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function IconSchedule(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="17" rx="2.5" />
      <path d="M8 2.5v3M16 2.5v3M3 9.5h18" />
      <path d="M8 14h2.5M13.5 14H16M8 17.5h2.5" />
    </Svg>
  );
}

export function IconToday(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconReport(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 15l3.5-4.5 3 2.5L18 7" />
    </Svg>
  );
}

/** Homer — career coach */
export function IconCareer(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5c-2.4 0-4.2 1.6-4.2 3.8 0 1.5.8 2.7 2 3.4v1.1h4.4v-1.1c1.2-.7 2-1.9 2-3.4C16.2 5.1 14.4 3.5 12 3.5z" />
      <path d="M8.2 13.8c-1.6.7-2.7 2-2.7 3.5V19h13v-1.7c0-1.5-1.1-2.8-2.7-3.5" />
    </Svg>
  );
}

export function IconPosts(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 3.5 20.5 10 9 21.5H3.5V16z" />
      <path d="M12 5.5 18.5 12" />
    </Svg>
  );
}

export function IconTimesheet(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 6h12M8 12h12M8 18h8" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth="2.4" />
    </Svg>
  );
}

export function IconBadges(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5 14.8 9l5.7.6-4.3 3.8 1.3 5.6L12 16.4l-5.5 2.6 1.3-5.6-4.3-3.8 5.7-.6z" />
    </Svg>
  );
}

export function IconSettings(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.8 7.2l1.9 1.1M17.3 15.7l1.9 1.1M3.5 12h2.2M18.3 12h2.2M4.8 16.8l1.9-1.1M17.3 8.3l1.9-1.1" />
    </Svg>
  );
}

export function IconAdmin(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5 13.6 9.2 19.5 9.5 15 13.4 16.6 19.5 12 16.2 7.4 19.5 9 13.4 4.5 9.5 10.4 9.2z" />
    </Svg>
  );
}

export function IconLogout(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 12H21" />
      <path d="M16.5 7.5 21 12l-4.5 4.5" />
      <path d="M10 19.5H5.5A2.5 2.5 0 0 1 3 17V7a2.5 2.5 0 0 1 2.5-2.5H10" />
    </Svg>
  );
}
