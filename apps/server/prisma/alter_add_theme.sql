-- Add theme preference column (run once in Supabase SQL Editor)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "theme" TEXT NOT NULL DEFAULT 'light';
