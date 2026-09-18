-- Google Meet join links on calendar events
ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "meetLink" TEXT;
