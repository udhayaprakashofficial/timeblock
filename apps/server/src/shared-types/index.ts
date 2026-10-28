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
  /** Career History — project or area of work */
  careerProject?: string | null;
  /** Career History — responsibility / role */
  careerResponsibility?: string | null;
  /** Career History — achievement */
  careerAchievement?: string | null;
  /** Career History — contribution */
  careerContribution?: string | null;
  /** Career History — outcome / impact */
  careerOutcome?: string | null;
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
  /** Defaults to the user's defaultTaskMinutes (usually 30) when omitted. Any integer ≥ 5. */
  estimatedMinutes?: number;
  /** Optional HH:MM preferred start — auto-scheduler places here if free (no Pin required) */
  startTime?: string;
  /** Optional HH:MM preferred end — must pair with startTime */
  endTime?: string;
  /**
   * When the task cannot fit in work hours:
   * - overtime: pack past workEnd (overtime)
   * - reprioritize: place this task first; lower-priority tasks may move later / backlog
   */
  overflowMode?: 'overtime' | 'reprioritize';
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
  careerProject?: string | null;
  careerResponsibility?: string | null;
  careerAchievement?: string | null;
  careerContribution?: string | null;
  careerOutcome?: string | null;
  estimatedMinutes?: number;
  /** HH:MM — preferred slot; rejected if it overlaps another task. Does not require Pin. */
  startTime?: string | null;
  endTime?: string | null;
  /** Clear times and let the packer place the task again */
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

/** AI brand summary — Gemini post drafts from Cupkey evidence */
export type AiBrandRange = 'today' | 'day' | 'week' | 'month' | 'year';

export type AiBrandPlatform = 'linkedin' | 'x';

export interface AiBrandSummaryRequestDto {
  /** Anchor civil date YYYY-MM-DD */
  date: string;
  range: AiBrandRange;
  platform: AiBrandPlatform;
}

export interface AiBrandSummaryDto {
  range: AiBrandRange;
  platform: AiBrandPlatform;
  from: string;
  to: string;
  label: string;
  /** Ready-to-paste post copy */
  summary: string;
  facts: {
    totalTasks: number;
    completed: number;
    pending: number;
    estimatedMinutes: number;
    actualMinutes: number;
    completionPercent: number;
    topTasks: Array<{
      name: string;
      date: string;
      actualMinutes: number;
      estimatedMinutes: number;
      status: string;
    }>;
  };
}

/** Per-task LinkedIn / X draft — requires task notes/comments */
export interface AiTaskPostRequestDto {
  taskId: string;
  platform: AiBrandPlatform;
}

export interface AiTaskPostDto {
  taskId: string;
  taskName: string;
  platform: AiBrandPlatform;
  date: string;
  /** Ready-to-paste post copy */
  summary: string;
  /** Notes/comments used as source material */
  notes: string;
  facts: {
    estimatedMinutes: number;
    actualMinutes: number;
    status: string;
  };
  /** Set when the draft is persisted for the task */
  id?: string;
  createdAt?: string;
}

/** One saved AI social draft linked to a task */
export interface StoredTaskAiPostDto {
  id: string;
  userId: string;
  taskId: string;
  taskName: string;
  platform: AiBrandPlatform;
  date: string;
  summary: string;
  notes: string;
  createdAt: string;
  facts: {
    estimatedMinutes: number;
    actualMinutes: number;
    status: string;
  };
}

export interface StoredTaskAiPostsDto {
  items: StoredTaskAiPostDto[];
}

/** One finished task in Career History */
export interface WorkHistoryItemDto {
  id: string;
  date: string;
  name: string;
  estimatedMinutes: number;
  actualMinutes: number;
  notes?: string | null;
  careerProject?: string | null;
  careerResponsibility?: string | null;
  careerAchievement?: string | null;
  careerContribution?: string | null;
  careerOutcome?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}

/** Searchable Career History of completed work */
export interface WorkHistoryDto {
  from: string;
  to: string;
  query: string;
  total: number;
  items: WorkHistoryItemDto[];
  /** False when free / inactive — client should show upgrade */
  hasAccess: boolean;
  reason?: string | null;
  /**
   * Finished tasks (recent archive) that have notes / career notes.
   * Homer appraisal & interview unlock at HOMER_MIN_TASK_NOTES.
   */
  notedTaskCount?: number;
  /** Minimum noted finished tasks required to generate with Homer */
  homerMinNotes?: number;
  /** True when notedTaskCount >= homerMinNotes */
  homerReady?: boolean;
}

/** Minimum finished tasks with notes before Homer can generate */
export const HOMER_MIN_TASK_NOTES = 20;

/** What to include in a Homer summary */
export type AiCareerSummaryScope = 'all' | 'project';

/** Homer AI feature (not work notes) */
export type AiHomerMode = 'weekly' | 'appraisal' | 'interview';

/** Interview answer length / structure */
export type AiHomerInterviewFormat = '30s' | '60s' | 'star';

/** Post-generate refine without changing source filters */
export type AiHomerRefineAction =
  | 'regenerate'
  | 'concise'
  | 'evidence'
  | 'natural'
  | 'professional';

/** How to persist when a matching story already exists */
export type AiHomerSavePolicy = 'new' | 'replace';

/** One finished task used as evidence for a Homer story */
export interface HomerEvidenceItemDto {
  taskId: string;
  date: string;
  name: string;
  actualMinutes: number;
  estimatedMinutes: number;
  project: string | null;
  /** Path to open the task notes context when available */
  href?: string | null;
}

/** Homer summary request — mode picks the coaching format */
export interface AiCareerSummaryRequestDto {
  from: string;
  to: string;
  /** Optional keyword filter (name, notes, career fields) */
  q?: string;
  /** all = whole range; project = one project/product name */
  scope?: AiCareerSummaryScope;
  /** Required when scope is "project" — matches careerProject */
  project?: string;
  /** weekly update | appraisal prep | interview pitch */
  mode?: AiHomerMode;
  /** Interview format (ignored for appraisal) */
  format?: AiHomerInterviewFormat;
  /** Refine an existing draft (same sources) */
  refine?: AiHomerRefineAction;
  /** Prior summary text when refining */
  baseSummary?: string;
  /** Prior headline when refining */
  baseHeadline?: string;
  /** new = always insert; replace = overwrite replaceId */
  savePolicy?: AiHomerSavePolicy;
  /** Existing story id to update when savePolicy is replace */
  replaceId?: string;
}

/** Homer-generated story from finished work */
export interface AiCareerSummaryDto {
  from: string;
  to: string;
  query: string;
  scope: AiCareerSummaryScope;
  project: string | null;
  mode: AiHomerMode;
  format: AiHomerInterviewFormat | null;
  /** Short headline for the period */
  headline: string;
  /** Paste-ready story (weekly lines, appraisal wins, or interview answer) */
  summary: string;
  responsibilities: string[];
  projects: string[];
  achievements: string[];
  /** Short coaching tip — what to lead with / leave out */
  tip: string | null;
  /** Gaps in the source data (do not invent to fill these) */
  gaps: string[];
  /** Source activities used for this story */
  evidence: HomerEvidenceItemDto[];
  /** Tasks used as source material */
  taskCount: number;
  /** Set when persisted (appraisal / interview) */
  id?: string | null;
  createdAt?: string | null;
  /** Matching prior story id (client may ask replace vs new) */
  duplicateOfId?: string | null;
  version?: number | null;
}

/** Persisted Homer appraisal or interview write-up */
export interface StoredHomerGenerationDto {
  id: string;
  userId: string;
  mode: 'appraisal' | 'interview';
  format: AiHomerInterviewFormat | null;
  from: string;
  to: string;
  query: string;
  scope: AiCareerSummaryScope;
  project: string | null;
  headline: string;
  summary: string;
  responsibilities: string[];
  projects: string[];
  achievements: string[];
  tip: string | null;
  gaps: string[];
  evidence: HomerEvidenceItemDto[];
  taskCount: number;
  createdAt: string;
  updatedAt?: string | null;
  version?: number | null;
  /** Prior version id when this is a new version of an older story */
  replacesId?: string | null;
}

export interface StoredHomerGenerationsDto {
  items: StoredHomerGenerationDto[];
}

/** Persist an unsaved Homer draft (update existing or save new version) */
export interface AiHomerPersistRequestDto {
  savePolicy: AiHomerSavePolicy;
  /** Required when savePolicy is replace */
  replaceId?: string;
  draft: Pick<
    AiCareerSummaryDto,
    | 'from'
    | 'to'
    | 'query'
    | 'scope'
    | 'project'
    | 'mode'
    | 'format'
    | 'headline'
    | 'summary'
    | 'responsibilities'
    | 'projects'
    | 'achievements'
    | 'tip'
    | 'gaps'
    | 'evidence'
    | 'taskCount'
  >;
}

/** Whether the current user can call AI features (credits) */
export interface AiAccessDto {
  enabled: boolean;
  /** Legacy flag — Pro gets the monthly pool */
  requirePro: boolean;
  /** True when creditsRemaining > 0 (or metering disabled for testing) */
  hasAccess: boolean;
  reason?: string | null;
  /** Credits left in the current pool */
  creditsRemaining: number;
  /** Pool size (5 Free one-time / 50 Pro monthly) */
  creditsLimit: number;
  /** Credits spent in the current pool */
  creditsUsed: number;
  /** YYYY-MM for Pro, or "lifetime" for Free */
  creditsMonth: string;
  /** Active Pro subscriber */
  isPro: boolean;
  /** Human label for next refill (e.g. Nov 1) — Free: upgrade copy */
  refillLabel: string;
  /** Free allotment (one-time) */
  freeCreditsMonthly: number;
  /** Pro monthly allotment */
  proCreditsMonthly: number;
}

/** Proposed task — never auto-saved; user must approve */
export interface AiProposedTaskDto {
  /** Client-side id for editing before apply */
  key: string;
  name: string;
  estimatedMinutes: number;
  /** Optional HH:mm preferred start */
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
  /** Existing task id when suggesting a change */
  taskId?: string | null;
}

export interface AiDailyPlanRequestDto {
  date: string;
  /** Optional free-text goals / constraints */
  goals?: string;
}

export interface AiDailyPlanDto {
  date: string;
  summary: string;
  proposedTasks: AiProposedTaskDto[];
  /** Reminder: apply is client-side after user approval */
  requiresApproval: true;
}

export interface AiBrainDumpRequestDto {
  date: string;
  text: string;
}

export interface AiBrainDumpDto {
  date: string;
  proposedTasks: AiProposedTaskDto[];
  requiresApproval: true;
}

export interface AiEstimateRequestDto {
  name: string;
  date?: string;
  context?: string;
}

export interface AiEstimateDto {
  name: string;
  estimatedMinutes: number;
  rationale: string;
}

export interface AiPrioritizeRequestDto {
  date: string;
}

export interface AiPrioritizeDto {
  date: string;
  /** Suggested order (task ids, open tasks only) */
  orderedTaskIds: string[];
  rationale: string;
  requiresApproval: true;
}

export type AiRecoveryAction = 'keep' | 'backlog' | 'reschedule' | 'shorten';

export interface AiRecoveryMoveDto {
  taskId: string;
  taskName: string;
  action: AiRecoveryAction;
  /** HH:mm when action is reschedule */
  startTime?: string | null;
  estimatedMinutes?: number | null;
  reason: string;
}

export interface AiRecoverRequestDto {
  date: string;
  /** Optional: what went wrong */
  note?: string;
}

export interface AiRecoverDto {
  date: string;
  summary: string;
  moves: AiRecoveryMoveDto[];
  requiresApproval: true;
}

export interface AiCoachRequestDto {
  date: string;
}

export interface AiCoachDto {
  date: string;
  title: string;
  body: string;
  tips: string[];
}

export interface AiFocusRequestDto {
  date: string;
  taskId?: string;
}

export interface AiFocusDto {
  date: string;
  taskId: string | null;
  taskName: string | null;
  message: string;
  suggestion: string;
}
