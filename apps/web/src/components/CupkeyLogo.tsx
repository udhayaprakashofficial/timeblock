'use client';

import { useId } from 'react';

/** Cupkey wordmark icon — orange tile with a keyed “C”. */
export function CupkeyLogo({
  size = 36,
  className,
  title = 'Cupkey',
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  const gradId = useId().replace(/:/g, '');

  return (
    <span
      className={`cupkey-logo${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      title={title}
      aria-label={title}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="40" height="40" rx="11" fill={`url(#${gradId})`} />
        <path
          d="M13.5 12.5h9.2c4.6 0 7.8 2.9 7.8 7.2 0 4.4-3.2 7.3-7.8 7.3H16.2V28H13.5V12.5zm2.7 2.5v9.5h6.2c3 0 5-1.8 5-4.75s-2-4.75-5-4.75H16.2z"
          fill="#fff"
        />
        <circle cx="30.2" cy="12.8" r="2.2" fill="#fff" fillOpacity="0.92" />
        <defs>
          <linearGradient
            id={gradId}
            x1="6"
            y1="4"
            x2="36"
            y2="38"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#ff8a50" />
            <stop offset="0.55" stopColor="#ff4d00" />
            <stop offset="1" stopColor="#e64500" />
          </linearGradient>
        </defs>
      </svg>
    </span>
  );
}
