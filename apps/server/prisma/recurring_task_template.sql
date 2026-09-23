-- Recurring task templates for Cupkey (run in Supabase SQL editor if needed)
create table if not exists "RecurringTaskTemplate" (
  id text primary key,
  "userId" text not null references "User"(id) on delete cascade,
  name text not null,
  "estimatedMinutes" integer not null,
  weekdays jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists "RecurringTaskTemplate_userId_active_idx"
  on "RecurringTaskTemplate" ("userId", active);
