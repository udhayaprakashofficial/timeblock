export type CalendarProvider = 'google' | 'microsoft';

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ThemePreference = 'light' | 'dark';

/** Billing plan — Pro is sold via Dodo Payments */
export type PlanId = 'free' | 'pro';

export interface UserDto {
  id: string;
  name: string;
  email: string;
  theme: ThemePreference;
  /** IANA timezone from the user's geography (e.g. Asia/Kolkata) */
  timezone: string;
  /** Default duration (minutes) when adding tasks without an explicit time range */
  defaultTaskMinutes: number;
  /** False until first-time onboarding finishes (signup → onboard → dashboard) */
  onboardingCompleted: boolean;
  connectedProviders: CalendarProvider[];
  /** free | pro — paid lock-in; features unlock after admin activation */
  plan: PlanId;
  /**
   * pending_activation — paid, waiting for AI go-live / admin activate
   * active — Pro live; countdown from proActivatedAt
   * on_hold | cancelled | failed
   */
  planStatus?: string | null;
  /** ISO timestamp when plan last changed */
  planUpdatedAt?: string | null;
  /** ISO — when user paid / locked Pro */
  proPaidAt?: string | null;
  /** ISO — when admin activated Pro (billing period starts) */
  proActivatedAt?: string | null;
  /** Last Dodo payment id for invoice download */
  dodoPaymentId?: string | null;
}

export interface AuthConfigDto {
  /** Google sign-in via Clerk (no end-user Client ID/Secret) */
  googleSignIn: boolean;
  allowDevLogin: boolean;
  /** Direct Google OAuth for calendar linking (optional) */
  googleCalendarOAuth: boolean;
  /** Public OAuth client id for browser Google Identity Services */
  googleClientId: string | null;
  microsoftConfigured: boolean;
  clerkPublishableKey: string | null;
}

export interface BreakDto {
  id: string;
  name: string;
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface DailyScheduleTemplateDto {
  id: string;
  weekday: Weekday;
  workStart: string; // HH:mm
  workEnd: string; // HH:mm
  breaks: BreakDto[];
}

export interface TaskDto {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  estimatedMinutes: number;
  status: TaskStatus;
  order: number;
  scheduledStart: string | null; // ISO
  scheduledEnd: string | null; // ISO
  actualMinutes: number;
  activeEntryId: string | null;
  /** ISO start of the open time entry — used to resume the live clock after refresh */
  timerStartedAt?: string | null;
  /** Free-form comments / notes for later review */
  notes?: string | null;
  /** Present when task was created from a calendar/Meet event */
  meetLink?: string | null;
  scheduleLocked?: boolean;
  sourceProvider?: string | null;
  /** Stable id for calendar/recurring materialization */
  sourceExternalId?: string | null;
  /** Unscheduled unfinished work waiting for a future day */
  inBacklog?: boolean;
}

export interface CreateTaskDto {
  date: string;
  name: string;
  /** Defaults to the user's defaultTaskMinutes (usually 30) when omitted */
  estimatedMinutes?: number;
  /** HH:MM wall clock in the user's timezone — locks the task to this slot */
  startTime?: string;
  /** HH:MM wall clock in the user's timezone — locks the task to this slot */
  endTime?: string;
}

/** Recurring task that materializes onto matching weekdays */
export interface RecurringTaskDto {
  id: string;
  name: string;
  estimatedMinutes: number;
  /** 0=Sun … 6=Sat */
  weekdays: Weekday[];
  active: boolean;
}

export interface CreateRecurringTaskDto {
  name: string;
  estimatedMinutes?: number;
  weekdays: Weekday[];
  active?: boolean;
}

export interface UpdateTaskDto {
  name?: string;
  notes?: string | null;
  estimatedMinutes?: number;
  /** HH:MM — when both start and end are set, locks the task to that slot */
  startTime?: string | null;
  endTime?: string | null;
  /** Clear lock and let the packer place the task */
  unlockSchedule?: boolean;
  /** Move into or out of backlog */
  inBacklog?: boolean;
  /** Target day when scheduling from backlog (YYYY-MM-DD) */
  date?: string;
  order?: number;
}

export interface ScheduleBacklogTaskDto {
  /** YYYY-MM-DD — defaults to today in the user timezone */
  date?: string;
}

export interface ReorderTasksDto {
  date: string;
  taskIds: string[];
}

export interface TimeEntryDto {
  id: string;
  taskId: string;
  startedAt: string;
  endedAt: string | null;
  actualMinutes: number | null;
}

export interface CalendarEventDto {
  id: string;
  provider: CalendarProvider;
  externalId: string;
  title: string;
  start: string;
  end: string;
  /** Google Meet / Teams join URL when present */
  meetLink: string | null;
}

export interface DayUtilizationDto {
  date: string;
  availableMinutes: number;
  scheduledMinutes: number;
  utilizationPercent: number;
  tip: string | null;
}

export interface TaskCountersDto {
  total: number;
  completed: number;
  pending: number;
}

export interface StatsOverviewDto {
  today: TaskCountersDto;
  week: TaskCountersDto;
  utilization: DayUtilizationDto;
  /** Motivational effort badges from today’s + this week’s work */
  effort: EffortSummaryDto;
}

export type EffortBadgeTone = 'blue' | 'teal' | 'coral' | 'gold';

export type EffortBadgeCategory =
  | 'daily'
  | 'consistency'
  | 'focus'
  | 'insight';

export type EffortBadgeId =
  | 'planner'
  | 'on_track'
  | 'day_closer'
  | 'focus_zone'
  | 'week_warrior'
  | 'steady_streak'
  | 'timekeeper'
  | 'record_keeper'
  | 'daily_learner'
  | 'consistency'
  | 'ai_spark';

export interface EffortBadgeDto {
  id: EffortBadgeId;
  title: string;
  description: string;
  /** Explicit unlock challenge shown on the card */
  challenge: string;
  category: EffortBadgeCategory;
  earned: boolean;
  tone: EffortBadgeTone;
  /** Optional progress toward earning (for locked badges) */
  progress?: { current: number; target: number };
}

export interface EffortSummaryDto {
  /** Short appreciation line for the user */
  message: string;
  streakDays: number;
  earnedCount: number;
  badges: EffortBadgeDto[];
}

export interface WeeklyReportDayDto {
  date: string;
  estimatedMinutes: number;
  actualMinutes: number;
  total: number;
  completed: number;
  pending: number;
  completionPercent: number;
}

export interface WeeklyReportTaskDto {
  taskId: string;
  name: string;
  date: string;
  estimatedMinutes: number;
  actualMinutes: number;
  status: TaskStatus;
  varianceMinutes: number;
  scheduleLocked?: boolean;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}

export interface WeeklyReportDto {
  weekStart: string;
  weekEnd: string;
  byDay: WeeklyReportDayDto[];
  byTask: WeeklyReportTaskDto[];
  totals: {
    estimatedMinutes: number;
    actualMinutes: number;
    total: number;
    completed: number;
    pending: number;
    completionPercent: number;
  };
}

export interface EodTaskRowDto {
  id: string;
  name: string;
  status: TaskStatus;
  estimatedMinutes: number;
  actualMinutes: number;
  varianceMinutes: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  scheduleLocked: boolean;
  meetLink: string | null;
  notes?: string | null;
}

export interface EodSheetDto {
  date: string;
  generatedAt: string;
  summary: {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
    estimatedMinutes: number;
    actualMinutes: number;
    completionPercent: number;
  };
  tasks: EodTaskRowDto[];
  shipped: string[];
  remaining: string[];
}

export interface UpsertScheduleTemplateDto {
  weekday: Weekday;
  workStart: string;
  workEnd: string;
  breaks: Array<{ name: string; start: string; end: string }>;
}

export interface TimelineBlockDto {
  id: string;
  kind: 'task' | 'calendar' | 'break';
  title: string;
  start: string;
  end: string;
  task?: TaskDto;
  calendarEvent?: CalendarEventDto;
}
