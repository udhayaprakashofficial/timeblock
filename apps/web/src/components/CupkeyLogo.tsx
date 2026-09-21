'use client';

/** Official Cupkey mark from cupkey.io/logo.png (lambda stroke). */
export function CupkeyLogo({
  size = 36,
  className,
  title = 'Cupkey',
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
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
