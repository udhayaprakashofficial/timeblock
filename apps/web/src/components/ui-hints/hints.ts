/**
 * Cupkey contextual tips — product language only (plan, queue, backlog, coach, sync).
 * Demo video URL comes from NEXT_PUBLIC_DEMO_VIDEO_URL when a recording is ready.
 */

export type HintId =
  | 'nav.schedule'
  | 'nav.today'
  | 'nav.report'
  | 'nav.badges'
  | 'nav.timesheet'
  | 'nav.settings'
  | 'dash.plan'
  | 'dash.queue'
  | 'dash.backlog'
  | 'dash.pin'
  | 'side.focus'
  | 'side.load'
  | 'side.coach'
  | 'settings.connect'
  | 'settings.sync'
  | 'settings.hours'
  | 'timesheet.hours'
  | 'report.delta'
  | 'route.schedule'
  | 'route.today'
  | 'route.report'
  | 'route.timesheet'
  | 'route.settings'
  | 'route.badges'
  | 'demo.video';

export type HintCopy = {
  id: HintId;
  title: string;
  body: string;
};

export const HINTS: Record<HintId, HintCopy> = {
  'nav.schedule': {
    id: 'nav.schedule',
    title: 'Schedule',
    body: 'Day timeline — The plan packs tasks into your work hours.',
  },
  'nav.today': {
    id: 'nav.today',
    title: 'Today',
    body: 'Focus cockpit — start, pause, and finish the live block.',
  },
  'nav.report': {
    id: 'nav.report',
    title: 'Weekly report',
    body: 'Estimate vs actual, drift, and completion for the week.',
  },
  'nav.badges': {
    id: 'nav.badges',
    title: 'Badges',
    body: 'Effort badges earned from deep work and consistent days.',
  },
  'nav.timesheet': {
    id: 'nav.timesheet',
    title: 'Timesheet',
    body: 'Logged sessions for a day — export CSV or print.',
  },
  'nav.settings': {
    id: 'nav.settings',
    title: 'Settings',
    body: 'Profile, calendars, and the work hours Cupkey schedules into.',
  },
  'dash.plan': {
    id: 'dash.plan',
    title: 'The plan',
    body: 'Your packed day: tasks, meetings, and breaks inside work hours. Drag the day with ‹ ›.',
  },
  'dash.queue': {
    id: 'dash.queue',
    title: 'Queue',
    body: 'Today’s open tasks in order. Add one here — Cupkey places it in The plan.',
  },
  'dash.backlog': {
    id: 'dash.backlog',
    title: 'Backlog',
    body: 'Unscheduled or leftover work. Pull a task into today when you have room.',
  },
  'dash.pin': {
    id: 'dash.pin',
    title: 'Pin time',
    body: 'Lock a start–end so Cupkey places the task at that wall-clock slot.',
  },
  'side.focus': {
    id: 'side.focus',
    title: 'Focus score',
    body: 'From how full today is — not from deep-work minutes. It peaks when about 55% of your work hours are booked. An empty day and a packed day both score lower.',
  },
  'side.load': {
    id: 'side.load',
    title: 'Load',
    body: 'How full your work-hour window is. Leave slack for ad-hoc work.',
  },
  'side.coach': {
    id: 'side.coach',
    title: 'Coach',
    body: 'Dynamic right-rail slot — live nudges today; insights, challenges, and demos plug in later.',
  },
  'settings.connect': {
    id: 'settings.connect',
    title: 'Connect',
    body: 'Link Google (Outlook soon) once. Cupkey reads meetings into The plan.',
  },
  'settings.sync': {
    id: 'settings.sync',
    title: 'Sync',
    body: 'Pull the latest calendar events after Connect. Doesn’t re-authorize.',
  },
  'settings.hours': {
    id: 'settings.hours',
    title: 'Work schedule',
    body: 'Hours and breaks per weekday. New tasks only land inside this window.',
  },
  'timesheet.hours': {
    id: 'timesheet.hours',
    title: 'Logged hours',
    body: 'Actual minutes come from Start/Done sessions — not from estimates alone.',
  },
  'report.delta': {
    id: 'report.delta',
    title: 'Delta',
    body: 'Actual minus estimated. Positive means you spent longer than planned.',
  },
  'route.schedule': {
    id: 'route.schedule',
    title: 'Build the day on The plan',
    body: 'Add tasks in Queue — Cupkey packs them into work hours beside meetings and breaks.',
  },
  'route.today': {
    id: 'route.today',
    title: 'Run one block at a time',
    body: 'Start the live timer so hours show on your timesheet. Pause or Done when you switch.',
  },
  'route.report': {
    id: 'route.report',
    title: 'See estimate vs actual',
    body: 'Weekly drift and completion — share or export when you wrap the week.',
  },
  'route.timesheet': {
    id: 'route.timesheet',
    title: 'Proof of hours',
    body: 'Pick a day for logged sessions. Download CSV or print for clients.',
  },
  'route.settings': {
    id: 'route.settings',
    title: 'Shape your work day',
    body: 'Connect calendars, Sync meetings, then set work hours so The plan has a window.',
  },
  'route.badges': {
    id: 'route.badges',
    title: 'Effort badges',
    body: 'Earn badges from deep-work streaks and intentional blocks — not vanity counters.',
  },
  'demo.video': {
    id: 'demo.video',
    title: 'Cupkey demo',
    body: 'Short walkthrough of Schedule, Queue, Coach, and timesheet. Recording landing soon.',
  },
};

/** First-visit banner tip for each authenticated route. */
export const ROUTE_HINTS: Array<{ match: (path: string) => boolean; id: HintId }> =
  [
    { match: (p) => p === '/' || p.startsWith('/schedule'), id: 'route.schedule' },
    { match: (p) => p.startsWith('/today'), id: 'route.today' },
    { match: (p) => p.startsWith('/report'), id: 'route.report' },
    { match: (p) => p.startsWith('/timesheet'), id: 'route.timesheet' },
    { match: (p) => p.startsWith('/settings'), id: 'route.settings' },
    { match: (p) => p.startsWith('/badges'), id: 'route.badges' },
  ];

export function hintForRoute(pathname: string): HintCopy | null {
  const found = ROUTE_HINTS.find((r) => r.match(pathname));
  return found ? HINTS[found.id] : null;
}

export function demoVideoUrl(): string | null {
  const raw =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_DEMO_VIDEO_URL?.trim()
      : '';
  return raw || null;
}

const DISMISS_KEY = 'tb.hints.dismissed';

export function readDismissedHints(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function dismissHint(id: HintId) {
  if (typeof window === 'undefined') return;
  const next = readDismissedHints();
  next.add(id);
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
  } catch {
    /* ignore */
  }
}

export function resetDismissedHints() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}
