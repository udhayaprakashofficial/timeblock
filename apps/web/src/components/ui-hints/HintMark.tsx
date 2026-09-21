'use client';

import { HINTS, type HintId } from './hints';
import { UiTooltip, type TooltipPlacement } from './UiTooltip';

type Props = {
  id: HintId;
  placement?: TooltipPlacement;
  className?: string;
};

/** Compact “?” control that shows a Cupkey contextual tip. */
export function HintMark({ id, placement = 'top', className }: Props) {
  const tip = HINTS[id];
  return (
    <UiTooltip
      label={tip.title}
      body={tip.body}
      placement={placement}
      className={className}
    >
      <button
        type="button"
        className="hint-mark"
        aria-label={`About ${tip.title}`}
      >
        ?
      </button>
    </UiTooltip>
  );
}
