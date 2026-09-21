'use client';

import { HintMark } from '../ui-hints';
import {
  COACH_KIND_LABEL,
  COACH_SLOT_LABEL,
  COACH_SLOT_SUB,
  type CoachSlotContent,
} from './types';

type Props = {
  content: CoachSlotContent | null;
  onMute: (minutes: number) => void;
  onUnmute: () => void;
};

/** Right-rail dynamic Coach slot — shell stays stable across releases. */
export function CoachSlot({ content, onMute, onUnmute }: Props) {
  if (!content) return null;

  const kindLabel = COACH_KIND_LABEL[content.kind];
  const action = content.action;

  return (
    <div
      className="side-card coach-card coach-slot"
      data-coach-kind={content.kind}
      data-coach-id={content.id}
    >
      <div className="coach-slot-head">
        <div className="side-card-label accent">
          ✦ {COACH_SLOT_LABEL}{' '}
          <HintMark id="side.coach" placement="left" />
        </div>
        <span className="coach-kind-chip" title={COACH_SLOT_SUB}>
          {kindLabel}
        </span>
      </div>

      {content.kind === 'video' && content.mediaUrl ? (
        <div className="coach-slot-media">
          <iframe
            src={content.mediaUrl}
            title={content.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : null}

      <p className="coach-title">{content.title}</p>
      <p>{content.body}</p>

      {action?.type === 'mute' ? (
        <button
          type="button"
          className="btn btn-primary btn-pill coach-cta"
          onClick={() => onMute(action.minutes)}
        >
          {action.label}
        </button>
      ) : null}

      {action?.type === 'unmute' ? (
        <button
          type="button"
          className="btn btn-outline btn-pill coach-cta"
          onClick={onUnmute}
        >
          {action.label}
        </button>
      ) : null}

      {action?.type === 'link' ? (
        <a
          className="btn btn-primary btn-pill coach-cta"
          href={action.href}
        >
          {action.label}
        </a>
      ) : null}

      {action?.type === 'dismiss' ? (
        <button type="button" className="btn btn-outline btn-pill coach-cta">
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
