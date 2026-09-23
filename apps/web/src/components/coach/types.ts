/**
 * Right-rail Coach card — reserved dynamic slot for Cupkey.
 *
 * v1 ships contextual nudges. Future releases can register higher-priority
 * providers (insight, challenge, promo, video) without changing the shell.
 */

export type CoachSlotKind =
  /** Live focus / plan tips from timer + load (current). */
  | 'nudge'
  /** Scheduled weekly / streak insight copy. */
  | 'insight'
  /** Effort badge or deep-work challenge. */
  | 'challenge'
  /** Product tip, onboarding tip, or feature highlight. */
  | 'promo'
  /** Demo / walkthrough embed. */
  | 'video';

export type CoachSlotAction =
  | { type: 'mute'; minutes: number; label: string }
  | { type: 'unmute'; label: string }
  | { type: 'link'; href: string; label: string }
  | { type: 'dismiss'; label: string }
  | { type: 'share'; label: string };

export type CoachSlotContent = {
  /** Stable id for dismiss / analytics. */
  id: string;
  kind: CoachSlotKind;
  title: string;
  body: string;
  /** Higher wins when several providers return content. */
  priority: number;
  muteable?: boolean;
  action?: CoachSlotAction;
  /** Optional media for video / promo kinds. */
  mediaUrl?: string | null;
  /** Weekly recap banner extras (insight kind). */
  recap?: {
    weekLabel: string;
    hoursLabel: string;
    tagline: string;
  } | null;
};

export type CoachSlotContext = {
  date: string;
  loadPct: number;
  focusScore: number;
  deepLogged: number;
  meetLogged: number;
  openTasks: number;
  doneTasks: number;
  liveRemainingMins: number | null;
  current: {
    mode: 'live' | 'now' | 'next' | 'idle';
    taskName: string | null;
  };
  mutedUntil: number | null;
  muteMins: number;
  /** Logged minutes this ISO week (for recap banner). */
  weekActualMinutes?: number;
  weekNumber?: number;
};

export const COACH_KIND_LABEL: Record<CoachSlotKind, string> = {
  nudge: 'Nudge',
  insight: 'Insight',
  challenge: 'Challenge',
  promo: 'Tip',
  video: 'Demo',
};

/** Human label for the slot chrome — stays “Coach” across kinds. */
export const COACH_SLOT_LABEL = 'Coach';
export const COACH_SLOT_SUB =
  'Dynamic space — live nudges now; insights & demos later';
