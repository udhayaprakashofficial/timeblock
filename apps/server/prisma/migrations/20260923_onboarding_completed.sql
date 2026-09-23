-- Required by Prisma User model + finish-onboarding. Missing column caused live 500s.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingCompleted" BOOLEAN NOT NULL DEFAULT true;
