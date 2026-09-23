'use client';

/** Cupkey brand mark (lambda) or horizontal wordmark. */
export function CupkeyLogo({
  size = 36,
  className,
  title = 'Cupkey',
  variant = 'mark',
}: {
  size?: number;
  className?: string;
  title?: string;
  /** `mark` = icon only; `wordmark` = mark + cupkey.io */
  variant?: 'mark' | 'wordmark';
}) {
  if (variant === 'wordmark') {
    const height = size;
    const width = Math.round(size * (1009 / 177));
    return (
      <span
        className={`cupkey-logo cupkey-logo-wordmark${className ? ` ${className}` : ''}`}
        style={{ width, height }}
        title={title}
        aria-label={title}
      >
        <img
          src="/cupkey-logo.png"
          alt=""
          width={width}
          height={height}
        />
      </span>
    );
  }

  return (
    <span
      className={`cupkey-logo${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      title={title}
      aria-label={title}
    >
      <img src="/cupkey-mark.png" alt="" width={size} height={size} />
    </span>
  );
}
