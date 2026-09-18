-- Smart scheduling + backlog columns
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "defaultTaskMinutes" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "inBacklog" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Task_userId_inBacklog_idx" ON "Task"("userId", "inBacklog");
