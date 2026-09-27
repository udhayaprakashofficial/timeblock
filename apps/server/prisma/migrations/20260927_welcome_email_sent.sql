-- Idempotent welcome email tracking (retry on sign-in if Brevo failed at signup).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "welcomeEmailSentAt" TIMESTAMPTZ;
