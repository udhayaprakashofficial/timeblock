import type {
  EffortBadgeDto,
  EffortSummaryDto,
} from '@timeblock/shared-types';
import { addDays, dateOnly, formatDateOnly } from '../common/time.util';

type TaskLike = {
  date: string;
  name?: string;
  status: string;
  estimatedMinutes?: number;
  actualMinutes?: number;
  scheduleLocked?: boolean;
};

const LEARNING_RE =
  /\b(learn|learning|study|studying|course|lesson|read|reading|practice|tutorial|skill|book)\b/i;
const AI_RE =
  /\b(ai|a\.i\.|gpt|llm|prompt|ml|machine learning|chatgpt|claude|copilot)\b/i;

function prevDateStr(dateStr: string): string {
  return formatDateOnly(addDays(dateOnly(dateStr), -1));
}

function daysWithCompleted(tasks: TaskLike[]): Set<string> {
  const set = new Set<string>();
  for (const t of tasks) {
    if (t.status === 'completed') set.add(String(t.date).slice(0, 10));
  }
  return set;
}

function daysWithMatching(
  tasks: TaskLike[],
  re: RegExp,
  completedOnly = true,
): Set<string> {
  const set = new Set<string>();
  for (const t of tasks) {
    if (completedOnly && t.status !== 'completed') continue;
    if (re.test(t.name ?? '')) set.add(String(t.date).slice(0, 10));
  }
  return set;
}

/** Consecutive days (ending today or yesterday) with ≥1 completed task. */
export function computeStreakDays(
  tasks: TaskLike[],
  todayStr: string,
): number {
  const completedByDay = daysWithCompleted(tasks);
  let cursor = todayStr;
  if (!completedByDay.has(todayStr)) {
    cursor = prevDateStr(todayStr);
  }

  let streak = 0;
  for (let i = 0; i < 30; i++) {
    if (!completedByDay.has(cursor)) break;
    streak += 1;
    cursor = prevDateStr(cursor);
  }
  return streak;
}

/** Count how many of the last N calendar days (including today) had a match. */
function countRecentMatchingDays(
  matchingDays: Set<string>,
  todayStr: string,
  window: number,
): number {
  let count = 0;
  let cursor = todayStr;
  for (let i = 0; i < window; i++) {
    if (matchingDays.has(cursor)) count += 1;
    cursor = prevDateStr(cursor);
  }
  return count;
}

function appreciationMessage(
  earnedCount: number,
  streakDays: number,
  todayCompleted: number,
): string {
  if (earnedCount === 0) {
    return 'Pick a challenge below — unlock badges by showing up daily.';
  }
  if (todayCompleted > 0 && streakDays >= 5) {
    return `${streakDays}-day streak. Consistency is compounding.`;
  }
  if (earnedCount >= 7) {
    return 'Elite rhythm — your history is becoming a real performance log.';
  }
  if (earnedCount >= 4) {
    return 'Strong run. Keep daily learning and focus challenges alive.';
  }
  return 'Challenges unlock with action — finish, log, and stay consistent.';
}

/**
 * Derive motivational effort badges from recent task history.
 * Pure — safe for Prisma, Supabase, and local store paths.
 */
export function buildEffortSummary(input: {
  date: string;
  todayTasks: TaskLike[];
  weekTasks: TaskLike[];
  /** Broader window (e.g. 14–30d) for streaks / learning consistency */
  recentTasks?: TaskLike[];
  utilizationPercent: number;
}): EffortSummaryDto {
  const today = input.todayTasks;
  const week = input.weekTasks;
  const recent = input.recentTasks?.length ? input.recentTasks : week;

  const todayTotal = today.length;
  const todayCompleted = today.filter((t) => t.status === 'completed').length;
  const todayPending = todayTotal - todayCompleted;
  const weekCompleted = week.filter((t) => t.status === 'completed').length;
  const weekTotal = week.length;
  const actualLogged = week.reduce(
    (s, t) => s + (Number(t.actualMinutes) || 0),
    0,
  );
  const todayActual = today.reduce(
    (s, t) => s + (Number(t.actualMinutes) || 0),
    0,
  );
  const lockedThisWeek = week.filter((t) => t.scheduleLocked).length;
  const streakDays = computeStreakDays(recent, input.date);
  const util = input.utilizationPercent;

  const learningToday = today.some(
    (t) => t.status === 'completed' && LEARNING_RE.test(t.name ?? ''),
  );
  const learningDays = countRecentMatchingDays(
    daysWithMatching(recent, LEARNING_RE),
    input.date,
    5,
  );
  const aiTaskDone = recent.some(
    (t) => t.status === 'completed' && AI_RE.test(t.name ?? ''),
  );
  const aiSparkEarned =
    aiTaskDone ||
    (todayActual >= 45 && util >= 40 && util <= 85) ||
    (lockedThisWeek >= 2 && todayCompleted >= 1);

  const badges: EffortBadgeDto[] = [
    {
      id: 'planner',
      title: 'Planner',
      category: 'daily',
      description: 'You put work on the calendar — intention beats hope.',
      challenge: 'Add & schedule at least 1 task for today.',
      earned: todayTotal >= 1,
      tone: 'blue',
      progress: { current: Math.min(todayTotal, 1), target: 1 },
    },
    {
      id: 'on_track',
      title: 'On Track',
      category: 'daily',
      description: 'First Done of the day unlocks momentum.',
      challenge: 'Mark 1 task Done today.',
      earned: todayCompleted >= 1,
      tone: 'teal',
      progress: { current: Math.min(todayCompleted, 1), target: 1 },
    },
    {
      id: 'day_closer',
      title: 'Day Closer',
      category: 'daily',
      description: 'Inbox zero for today’s list — clean close.',
      challenge: 'Complete every task scheduled for today.',
      earned: todayTotal >= 1 && todayPending === 0,
      tone: 'gold',
      progress: {
        current: todayCompleted,
        target: Math.max(todayTotal, 1),
      },
    },
    {
      id: 'daily_learner',
      title: 'Daily Learner',
      category: 'consistency',
      description: 'Protect a daily learning slot — skills compound.',
      challenge:
        'Complete a task named with learn / study / read / practice (today).',
      earned: learningToday,
      tone: 'teal',
      progress: { current: learningToday ? 1 : 0, target: 1 },
    },
    {
      id: 'focus_zone',
      title: 'Focus Zone',
      category: 'focus',
      description: 'Healthy load leaves room for deep work.',
      challenge: 'Keep day utilization between 40% and 80%.',
      earned: util >= 40 && util <= 80,
      tone: 'teal',
      progress: {
        current: Math.min(Math.max(util, 0), 80),
        target: 40,
      },
    },
    {
      id: 'timekeeper',
      title: 'Timekeeper',
      category: 'focus',
      description: 'Real minutes beat estimates alone.',
      challenge: 'Use Start / Stop so actual time is logged this week.',
      earned: actualLogged > 0,
      tone: 'blue',
      progress: { current: actualLogged > 0 ? 1 : 0, target: 1 },
    },
    {
      id: 'steady_streak',
      title: 'Steady Streak',
      category: 'consistency',
      description: 'Three days of finished work in a row.',
      challenge: 'Complete ≥1 task on 3 consecutive days.',
      earned: streakDays >= 3,
      tone: 'gold',
      progress: { current: Math.min(streakDays, 3), target: 3 },
    },
    {
      id: 'consistency',
      title: 'Consistency',
      category: 'consistency',
      description: 'The habit badge — five days of showing up.',
      challenge: 'Maintain a 5-day completion streak.',
      earned: streakDays >= 5,
      tone: 'gold',
      progress: { current: Math.min(streakDays, 5), target: 5 },
    },
    {
      id: 'week_warrior',
      title: 'Week Warrior',
      category: 'focus',
      description: 'Volume with follow-through this week.',
      challenge: 'Finish 5+ tasks this week.',
      earned: weekCompleted >= 5,
      tone: 'coral',
      progress: { current: Math.min(weekCompleted, 5), target: 5 },
    },
    {
      id: 'record_keeper',
      title: 'Record Keeper',
      category: 'insight',
      description: 'Enough history for a useful weekly report.',
      challenge: 'Create 3+ tasks this week (for report depth).',
      earned: weekTotal >= 3,
      tone: 'coral',
      progress: { current: Math.min(weekTotal, 3), target: 3 },
    },
    {
      id: 'ai_spark',
      title: 'AI Spark',
      category: 'insight',
      description:
        'Work like a coach: intentional blocks, deep focus, or AI practice.',
      challenge:
        'Complete an AI-named task, log 45m+ today in Focus Zone, or lock 2+ timed slots this week.',
      earned: aiSparkEarned,
      tone: 'blue',
      progress: {
        current: aiSparkEarned
          ? 1
          : Math.min(
              1,
              (aiTaskDone ? 1 : 0) +
                (todayActual >= 45 ? 1 : 0) +
                (lockedThisWeek >= 2 ? 1 : 0),
            ),
        target: 1,
      },
    },
  ];

  // Soft progress for learning consistency hint on Daily Learner when not earned today
  // (already handled). Expose learningDays via consistency badge description when useful.
  void learningDays;

  const earnedCount = badges.filter((b) => b.earned).length;

  return {
    message: appreciationMessage(earnedCount, streakDays, todayCompleted),
    streakDays,
    earnedCount,
    badges,
  };
}
