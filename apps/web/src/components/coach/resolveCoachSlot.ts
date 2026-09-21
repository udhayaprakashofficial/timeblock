import type { CoachSlotContent, CoachSlotContext } from './types';

/**
 * v1 provider — contextual nudges from plan / timer / load.
 * Never invent app-switch claims we can't measure.
 */
export function buildNudgeContent(
  ctx: CoachSlotContext,
): CoachSlotContent | null {
  const { current, liveRemainingMins, loadPct, focusScore } = ctx;
  const { deepLogged, meetLogged, openTasks, doneTasks, muteMins } = ctx;

  if (current.mode === 'live' && current.taskName) {
    return {
      id: 'nudge.live',
      kind: 'nudge',
      priority: 80,
      muteable: true,
      title: `Protect “${current.taskName}”.`,
      body: liveRemainingMins
        ? `Timer is live — about ${liveRemainingMins}m left in this block. Stay with it.`
        : 'Timer is live. Finish this block before you context-switch.',
      action: {
        type: 'mute',
        minutes: muteMins,
        label: `Mute for ${muteMins} minutes →`,
      },
    };
  }

  if (current.mode === 'now' && current.taskName) {
    return {
      id: 'nudge.now',
      kind: 'nudge',
      priority: 70,
      muteable: true,
      title: 'This slot is open.',
      body: `“${current.taskName}” is on the calendar now. Hit Start to turn it into proof of hours.`,
      action: {
        type: 'mute',
        minutes: muteMins,
        label: `Mute for ${muteMins} minutes →`,
      },
    };
  }

  if (loadPct > 85) {
    return {
      id: 'nudge.load-high',
      kind: 'nudge',
      priority: 60,
      muteable: true,
      title: `Day is ${loadPct}% booked.`,
      body: 'Leave a little slack for ad-hoc work — or move a low-priority block to backlog.',
      action: {
        type: 'mute',
        minutes: muteMins,
        label: `Mute for ${muteMins} minutes →`,
      },
    };
  }

  if (deepLogged + meetLogged === 0 && openTasks > 0) {
    return {
      id: 'nudge.no-log',
      kind: 'nudge',
      priority: 55,
      muteable: true,
      title: 'No time logged yet.',
      body: `You have ${openTasks} open task${openTasks === 1 ? '' : 's'}. Start one session so today’s hours show on your timesheet.`,
      action: {
        type: 'mute',
        minutes: muteMins,
        label: `Mute for ${muteMins} minutes →`,
      },
    };
  }

  if (focusScore < 40 && loadPct < 35) {
    return {
      id: 'nudge.open-day',
      kind: 'nudge',
      priority: 50,
      muteable: true,
      title: 'Plenty of open time.',
      body: 'Queue one deep-work block next so the day doesn’t stay empty.',
      action: {
        type: 'mute',
        minutes: muteMins,
        label: `Mute for ${muteMins} minutes →`,
      },
    };
  }

  if (doneTasks > 0 && openTasks === 0) {
    return {
      id: 'nudge.clear',
      kind: 'nudge',
      priority: 45,
      muteable: true,
      title: 'Queue is clear.',
      body: `Nice — ${doneTasks} task${doneTasks === 1 ? '' : 's'} done. Pull from backlog or call it a day.`,
      action: {
        type: 'mute',
        minutes: muteMins,
        label: `Mute for ${muteMins} minutes →`,
      },
    };
  }

  return {
    id: 'nudge.default',
    kind: 'nudge',
    priority: 10,
    muteable: true,
    title: 'Keep one block uninterrupted.',
    body:
      deepLogged > 0
        ? `${deepLogged}m deep work logged. Mute coach nudges if you’re in flow.`
        : 'Strong plan. Start the next block and stay with it.',
    action: {
      type: 'mute',
      minutes: muteMins,
      label: `Mute for ${muteMins} minutes →`,
    },
  };
}

/**
 * Future providers register here. Return null until that release ships.
 * Example: weekly AI insight, badge challenge, demo video card.
 */
export function buildInsightContent(
  _ctx: CoachSlotContext,
): CoachSlotContent | null {
  return null;
}

export function buildChallengeContent(
  _ctx: CoachSlotContext,
): CoachSlotContent | null {
  return null;
}

export function buildPromoContent(
  _ctx: CoachSlotContext,
): CoachSlotContent | null {
  return null;
}

export function buildVideoContent(
  _ctx: CoachSlotContext,
): CoachSlotContent | null {
  // When NEXT_PUBLIC_DEMO_VIDEO_URL is set, a later release can surface it here.
  return null;
}

type Provider = (ctx: CoachSlotContext) => CoachSlotContent | null;

/** Ordered registry — add new providers without touching RightPanel. */
const PROVIDERS: Provider[] = [
  buildVideoContent,
  buildChallengeContent,
  buildInsightContent,
  buildPromoContent,
  buildNudgeContent,
];

export function resolveCoachSlot(
  ctx: CoachSlotContext,
): CoachSlotContent | null {
  if (ctx.mutedUntil != null && ctx.mutedUntil > Date.now()) {
    const left = Math.max(
      1,
      Math.ceil((ctx.mutedUntil - Date.now()) / 60_000),
    );
    return {
      id: 'nudge.muted',
      kind: 'nudge',
      priority: 100,
      muteable: true,
      title: 'Nudges paused',
      body: `Coach tips stay quiet for about ${left} more minute${
        left === 1 ? '' : 's'
      }. Timers and the plan keep running.`,
      action: { type: 'unmute', label: 'Unmute coach' },
    };
  }

  let best: CoachSlotContent | null = null;
  for (const provider of PROVIDERS) {
    const next = provider(ctx);
    if (!next) continue;
    if (!best || next.priority > best.priority) best = next;
  }
  return best;
}
