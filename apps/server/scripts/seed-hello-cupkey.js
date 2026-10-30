#!/usr/bin/env node
/**
 * One-shot demo seed for hello@cupkey.io only (Founder · Cupkey · idea → sales).
 * Not loaded by the Nest app at runtime — run explicitly:
 *
 *   node apps/server/scripts/seed-hello-cupkey.js
 *
 * Idempotent via sourceProvider=demo_seed + sourceExternalId.
 * Safe for other users: refuses any email other than TARGET_EMAIL.
 */
const { randomBytes } = require('crypto');
const { resolve } = require('path');
const { config } = require('dotenv');

config({ path: resolve(__dirname, '../.env') });

const TARGET_EMAIL = 'hello@cupkey.io';
const SEED_PROVIDER = 'demo_seed';
const SEED_PREFIX = 'hello-cupkey';
const TIMEZONE = 'Asia/Kolkata';
const RANGE_START = '2026-10-01';
/** Inclusive end — today in Asia/Kolkata when the script runs. */
const RANGE_END = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey =
  process.env.SUPABASE_SECRET_KEY?.trim() ||
  process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
  '';

function createId(prefix = 'c') {
  return `${prefix}${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return [];
  return JSON.parse(text);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayUtcNoon(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay(); // 0=Sun
}

function eachDateInclusive(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Phase of the founder journey for a given calendar day. */
function phaseFor(date) {
  if (date < '2026-10-08') return 'idea';
  if (date < '2026-10-15') return 'mvp';
  if (date < '2026-10-22') return 'build';
  if (date < '2026-10-29') return 'launch';
  return 'sales';
}

/**
 * Daily work catalog — Founder building Cupkey, idea → sales convert.
 * Index rotates by day so weeks vary without looking copy-pasted.
 */
const CATALOG = {
  idea: [
    {
      name: 'Write the Cupkey problem statement',
      minutes: 45,
      notes:
        'People keep adding tasks but never know when the day is full. Cupkey should plan against real hours and meetings.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — problem definition',
        careerAchievement: 'Framed the core job: plan the day, protect the breaks',
        careerContribution: 'Interviewed 4 overloaded builders about Friday pile-up',
        careerOutcome: 'Clear one-line thesis for the landing page',
      },
    },
    {
      name: 'Map idea → first paying user path',
      minutes: 60,
      notes:
        'Idea → waitlist → planner habit → Spotlight post → paid Pro. Conversion hinges on finished-work proof.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — GTM sketch',
        careerAchievement: 'Drafted idea-to-sales funnel',
        careerContribution: 'Defined free planner vs paid AI credits wedge',
        careerOutcome: 'Pricing story that matches product reality',
      },
    },
    {
      name: 'Competitive scan: Sunsama / Motion / Akiflow',
      minutes: 50,
      notes:
        'They schedule hard. We stop at 80% and help people show the work. Differentiation is honesty + Spotlight + Homer.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — market research',
        careerAchievement: 'Named three gaps competitors leave open',
        careerContribution: 'Compared onboarding and calendar sync UX',
        careerOutcome: 'Positioning: leave on time, then show the work',
      },
    },
    {
      name: 'Sketch cupkey.io hero copy',
      minutes: 40,
      notes:
        'To-do lists help you plan. Cupkey helps you execute. Keep the brand louder than any feature headline.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — messaging',
        careerAchievement: 'Locked hero line for marketing',
        careerContribution: 'Cut three weaker headlines',
        careerOutcome: 'Ready for Webflow/WordPress publish',
      },
    },
  ],
  mvp: [
    {
      name: 'Scope MVP: schedule + tasks + timer',
      minutes: 55,
      notes:
        'Must-have: work hours, breaks, task packer, live timer. Nice-to-have later: AI posts and Homer.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — product scope',
        careerAchievement: 'Cut MVP to a shippable core',
        careerContribution: 'Wrote acceptance checklist for v1',
        careerOutcome: 'Two-week build plan without fluff',
      },
    },
    {
      name: 'Design Google calendar read-only sync',
      minutes: 70,
      notes:
        'OAuth identity for login; calendar.readonly only when connecting. Never write to the calendar.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — integrations',
        careerAchievement: 'Split login vs calendar scopes',
        careerContribution: 'Documented redirect URI and Testing-mode pitfalls',
        careerOutcome: 'Safer Google connect path for new users',
      },
    },
    {
      name: 'Prototype day packer at 80% cap',
      minutes: 90,
      notes:
        'When utilization crosses 80%, push leftover tasks to tomorrow. Override allowed, but remind on Friday.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — scheduling engine',
        careerAchievement: 'Implemented the honesty rule in the packer',
        careerContribution: 'Edge cases for meetings and lunch breaks',
        careerOutcome: 'Days that refuse to lie about capacity',
      },
    },
    {
      name: 'Onboarding: hours, breaks, first three tasks',
      minutes: 45,
      notes:
        'Four minutes on Monday. Seed today from the preview so the first session feels real.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — activation',
        careerAchievement: 'Shortened onboarding to one screen flow',
        careerContribution: 'Tied timezone to civil date for task seed',
        careerOutcome: 'Higher chance of day-one completion',
      },
    },
  ],
  build: [
    {
      name: 'Ship Today timeline + task notes',
      minutes: 80,
      notes:
        'Notes are the raw material for Spotlight. Without notes, AI posts stay empty — make capture frictionless.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — product build',
        careerAchievement: 'Notes field live on every task',
        careerContribution: 'Wired autosave and share panel hooks',
        careerOutcome: 'Finished work becomes postable evidence',
      },
    },
    {
      name: 'Build timesheet export (Excel / PDF / link)',
      minutes: 75,
      notes:
        'Freelancers convert when Friday export is one click. Share link for managers who will not install another app.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — timesheets',
        careerAchievement: 'Self-filling timesheet from timer history',
        careerContribution: 'PDF + Excel parity for client handoff',
        careerOutcome: 'Clear upgrade path for unlimited exports',
      },
    },
    {
      name: 'Wire Dodo checkout for Pro credits',
      minutes: 65,
      notes:
        'Free keeps 5 AI credits once. Pro gets 50/month. Annual welcome seats for early believers.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — monetization',
        careerAchievement: 'Checkout + webhook path to Pro',
        careerContribution: 'Mapped product ids for monthly vs annual',
        careerOutcome: 'Idea-to-paid conversion is technically open',
      },
    },
    {
      name: 'Harden auth session on app.cupkey.io',
      minutes: 50,
      notes:
        'First-party cookie via Next rewrite to Nest. Login codes break across serverless — prefer session on callback.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — reliability',
        careerAchievement: 'Stopped silent post-Google bounce to marketing',
        careerContribution: 'Aligned callback URI and GIS token fallback',
        careerOutcome: 'Sign-in that actually lands on /schedule',
      },
    },
  ],
  launch: [
    {
      name: 'Ship Spotlight: task → LinkedIn / X draft',
      minutes: 85,
      notes:
        'Generate from real notes and time spent. Sound like a person, not a press release. User edits before posting.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — Spotlight',
        careerAchievement: 'First AI feature that sells the free habit',
        careerContribution: 'Prompt rules that ban hashtags and fake metrics',
        careerOutcome: 'Builders can post what they shipped the same day',
      },
    },
    {
      name: 'Ship Homer career coach summaries',
      minutes: 70,
      notes:
        'Appraisal and interview modes from finished tasks. Lead with the win that has a number.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — Homer',
        careerAchievement: 'Career story generated from Cupkey history',
        careerContribution: 'Persisted generations for History page',
        careerOutcome: 'Professionals see why the product sticks',
      },
    },
    {
      name: 'Polish pricing page and credit copy',
      minutes: 40,
      notes:
        'Free forever for the planner. Pay when you want more AI. Unused Pro credits do not roll over — say it plainly.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — conversion copy',
        careerAchievement: 'Pricing that matches credit metering',
        careerContribution: 'Removed trial-ish language from Free',
        careerOutcome: 'Cleaner path from habit to Pro',
      },
    },
    {
      name: 'Fix production Google OAuth edge cases',
      minutes: 55,
      notes:
        'redirect_uri_mismatch and authError=google on cupkey.io. Prefer GIS token login; keep Nest AI routes reachable.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — production firefight',
        careerAchievement: 'Unblocked Google sign-in for real users',
        careerContribution: 'Web BFF + middleware handoff fixes',
        careerOutcome: 'New signups can reach the dashboard again',
      },
    },
  ],
  sales: [
    {
      name: 'Personal outreach to waitlist builders',
      minutes: 60,
      notes:
        'Short note: planner is free, Spotlight turns finished tasks into posts. Ask for one honest day using the 80% cap.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — sales',
        careerAchievement: 'Started idea-to-sales conversations',
        careerContribution: 'Segmented builders vs freelancers vs pros',
        careerOutcome: 'First demo calls booked from outreach',
      },
    },
    {
      name: 'Run a live Cupkey demo for a freelancer',
      minutes: 45,
      notes:
        'Show overbooking prevention, timesheet export, and one Spotlight draft from their own notes.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — demos',
        careerAchievement: 'Converted curiosity into a hands-on session',
        careerContribution: 'Scripted a 12-minute demo path',
        careerOutcome: 'Clear objections list for the next ten calls',
      },
    },
    {
      name: 'Write founder letter + conversion CTA',
      minutes: 50,
      notes:
        'Why another planner: lists never say the day is full. CTA: join free, connect calendar, ship three tasks.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — narrative sales',
        careerAchievement: 'Published the founder story with a hard CTA',
        careerContribution: 'Tied product moments to appraisal and posting pain',
        careerOutcome: 'Marketing and product tell the same story',
      },
    },
    {
      name: 'Review funnel: signup → schedule → Pro',
      minutes: 35,
      notes:
        'Drop-offs after Google auth and empty Spotlight. Fix the holes before buying more traffic.',
      career: {
        careerProject: 'Cupkey',
        careerResponsibility: 'Founder — conversion ops',
        careerAchievement: 'Mapped leaky steps in idea-to-sales',
        careerContribution: 'Prioritized auth + AI API redeploy',
        careerOutcome: 'Next week’s outreach will not hit a broken login',
      },
    },
  ],
};

function tasksForDate(date) {
  const wd = weekdayUtcNoon(date);
  // Weekends: lighter founder catch-up (Sat only), skip Sunday
  if (wd === 0) return [];
  const phase = phaseFor(date);
  const pool = CATALOG[phase];
  const dayIndex = Math.floor(
    (new Date(`${date}T12:00:00Z`) - new Date(`${RANGE_START}T12:00:00Z`)) /
      86400000,
  );
  const count = wd === 6 ? 1 : 3 + (dayIndex % 2); // 3–4 weekdays, 1 Saturday
  const picks = [];
  for (let i = 0; i < count; i++) {
    const item = pool[(dayIndex + i) % pool.length];
    picks.push({ ...item, order: i });
  }
  return picks;
}

function scheduleForTask(date, order, minutes) {
  // Pack into a simple morning/afternoon grid (IST stored as timestamptz)
  const startHour = 9 + order * 2;
  const start = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00+05:30`);
  const end = new Date(start.getTime() + minutes * 60_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function ensureUser() {
  const rows = await rest(
    `User?select=id,email,name,onboardingCompleted,timezone&email=eq.${encodeURIComponent(TARGET_EMAIL)}&limit=1`,
  );
  const now = new Date().toISOString();
  if (rows[0]) {
    await rest(`User?id=eq.${rows[0].id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        name: 'Lakshmanan Raman',
        timezone: TIMEZONE,
        onboardingCompleted: true,
        theme: 'dark',
        defaultTaskMinutes: 45,
        updatedAt: now,
      },
    });
    return rows[0].id;
  }
  const id = createId();
  await rest('User', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      id,
      email: TARGET_EMAIL,
      name: 'Lakshmanan Raman',
      theme: 'dark',
      timezone: TIMEZONE,
      defaultTaskMinutes: 45,
      onboardingCompleted: true,
      plan: 'free',
      createdAt: now,
      updatedAt: now,
    },
  });
  return id;
}

async function ensureSchedule(userId) {
  const now = new Date().toISOString();
  for (const weekday of [1, 2, 3, 4, 5]) {
    const existing = await rest(
      `DailyScheduleTemplate?select=id&userId=eq.${userId}&weekday=eq.${weekday}&limit=1`,
    );
    let templateId = existing[0]?.id;
    if (!templateId) {
      templateId = createId();
      await rest('DailyScheduleTemplate', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          id: templateId,
          userId,
          weekday,
          workStart: '09:00',
          workEnd: '18:00',
          createdAt: now,
          updatedAt: now,
        },
      });
      await rest('Break', {
        method: 'POST',
        prefer: 'return=minimal',
        body: {
          id: createId(),
          templateId,
          name: 'Lunch',
          start: '12:30',
          end: '13:00',
        },
      });
    }
  }
}

async function clearPriorSeedTasks(userId) {
  // Only rows created by this script (never touch user-made work).
  // TimeEntry rows cascade on Task delete when FKs are present.
  await rest(
    `Task?userId=eq.${encodeURIComponent(userId)}&sourceProvider=eq.${SEED_PROVIDER}`,
    { method: 'DELETE', prefer: 'return=minimal' },
  );
}

async function insertTasks(userId) {
  const dates = eachDateInclusive(RANGE_START, RANGE_END);
  let created = 0;
  const now = new Date().toISOString();

  for (const date of dates) {
    const dayTasks = tasksForDate(date);
    for (const t of dayTasks) {
      const externalId = `${SEED_PREFIX}:${date}:${t.order}:${t.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40)}`;
      const { start, end } = scheduleForTask(date, t.order, t.minutes);
      // Past days completed; today/future: mix of completed + pending
      const isPast = date < RANGE_END;
      const status = isPast || t.order === 0 ? 'completed' : 'pending';
      const taskId = createId();
      await rest('Task', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          id: taskId,
          userId,
          date,
          name: t.name,
          estimatedMinutes: t.minutes,
          status,
          order: t.order,
          scheduledStart: start,
          scheduledEnd: end,
          sourceProvider: SEED_PROVIDER,
          sourceExternalId: externalId,
          scheduleLocked: false,
          inBacklog: false,
          notes: t.notes,
          careerProject: t.career.careerProject,
          careerResponsibility: t.career.careerResponsibility,
          careerAchievement: t.career.careerAchievement,
          careerContribution: t.career.careerContribution,
          careerOutcome: t.career.careerOutcome,
          createdAt: now,
          updatedAt: now,
        },
      });

      if (status === 'completed') {
        const actual = Math.max(
          20,
          Math.round(t.minutes * (0.85 + ((t.order + date.length) % 3) * 0.1)),
        );
        const startedAt = start;
        const endedAt = new Date(
          new Date(start).getTime() + actual * 60_000,
        ).toISOString();
        await rest('TimeEntry', {
          method: 'POST',
          prefer: 'return=minimal',
          body: {
            id: createId(),
            taskId,
            startedAt,
            endedAt,
            actualMinutes: actual,
            createdAt: now,
          },
        });
      }
      created += 1;
    }
  }
  return created;
}

async function main() {
  if (!baseUrl || !apiKey) {
    console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in apps/server/.env');
    process.exit(1);
  }

  // Hard gate — never seed another account
  const emailArg = (process.argv[2] || TARGET_EMAIL).trim().toLowerCase();
  if (emailArg !== TARGET_EMAIL) {
    console.error(
      `Refusing to seed "${emailArg}". This script only allows ${TARGET_EMAIL}.`,
    );
    process.exit(1);
  }

  console.log(`Seeding ${TARGET_EMAIL} from ${RANGE_START} → ${RANGE_END} (${TIMEZONE})`);
  await rest('User?select=id&limit=1');
  const userId = await ensureUser();
  console.log(`User id=${userId}`);
  await ensureSchedule(userId);
  console.log('Weekday schedule ensured (09:00–18:00, lunch 12:30)');
  await clearPriorSeedTasks(userId);
  console.log('Cleared prior demo_seed tasks for this user only');
  const n = await insertTasks(userId);
  console.log(`Inserted ${n} founder tasks (idea → sales). Done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
