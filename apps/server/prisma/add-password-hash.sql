-- Add password support for email/password sign-up (run in Supabase SQL Editor once)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
