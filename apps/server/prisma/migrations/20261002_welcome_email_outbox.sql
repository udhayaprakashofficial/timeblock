-- Welcome-mail outbox so failed Brevo sends can be drained by cron / /me / sign-in.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "welcomeEmailAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "welcomeEmailLastAttemptAt" TIMESTAMPTZ;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "welcomeEmailLastError" TEXT;
