'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

type Props = {
  label: string;
  body?: string;
  placement?: TooltipPlacement;
  children: ReactNode;
  className?: string;
};

type Coords = { top: number; left: number };

const GAP = 10;
const PAD = 10;

function place(
  trigger: DOMRect,
  tipW: number,
  tipH: number,
  preferred: TooltipPlacement,
): Coords {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const order: TooltipPlacement[] = [
    preferred,
    ...(['top', 'bottom', 'left', 'right'] as TooltipPlacement[]).filter(
      (p) => p !== preferred,
    ),
  ];

  const fits = (top: number, left: number) =>
    left >= PAD &&
    top >= PAD &&
    left + tipW <= vw - PAD &&
    top + tipH <= vh - PAD;

  for (const placement of order) {
    let top = 0;
    let left = 0;
    if (placement === 'top') {
      top = trigger.top - tipH - GAP;
      left = trigger.left + trigger.width / 2 - tipW / 2;
    } else if (placement === 'bottom') {
      top = trigger.bottom + GAP;
      left = trigger.left + trigger.width / 2 - tipW / 2;
    } else if (placement === 'left') {
      top = trigger.top + trigger.height / 2 - tipH / 2;
      left = trigger.left - tipW - GAP;
    } else {
      top = trigger.top + trigger.height / 2 - tipH / 2;
      left = trigger.right + GAP;
    }

    if (fits(top, left)) return { top, left };
  }

  // Clamp preferred placement into the viewport
  let top = 0;
  let left = 0;
  if (preferred === 'top') {
    top = trigger.top - tipH - GAP;
    left = trigger.left + trigger.width / 2 - tipW / 2;
  } else if (preferred === 'bottom') {
    top = trigger.bottom + GAP;
    left = trigger.left + trigger.width / 2 - tipW / 2;
  } else if (preferred === 'left') {
    top = trigger.top + trigger.height / 2 - tipH / 2;
    left = trigger.left - tipW - GAP;
  } else {
    top = trigger.top + trigger.height / 2 - tipH / 2;
    left = trigger.right + GAP;
  }

  return {
    top: Math.min(Math.max(PAD, top), Math.max(PAD, vh - tipH - PAD)),
    left: Math.min(Math.max(PAD, left), Math.max(PAD, vw - tipW - PAD)),
  };
}

/** Hover/focus tooltip — portals to body so overflow:hidden parents can't clip it. */
export function UiTooltip({
  label,
  body,
  placement = 'top',
  children,
  className,
}: Props) {
  const tipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const tipRect = bubble.getBoundingClientRect();
    setCoords(
      place(
        trigger.getBoundingClientRect(),
        tipRect.width || 220,
        tipRect.height || 64,
        placement,
      ),
    );
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updatePosition();
    const onMove = () => updatePosition();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, updatePosition, label, body]);

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  return (
    <span
      ref={triggerRef}
      className={`ui-tip${className ? ` ${className}` : ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {mounted && open
        ? createPortal(
            <div
              ref={bubbleRef}
              id={tipId}
              role="tooltip"
              className={`ui-tip-bubble ui-tip-portal${coords ? ' is-open' : ''}`}
              style={
                coords
                  ? { top: coords.top, left: coords.left }
                  : { top: -9999, left: -9999, visibility: 'hidden' }
              }
            >
              <strong className="ui-tip-title">{label}</strong>
              {body ? <span className="ui-tip-body">{body}</span> : null}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
