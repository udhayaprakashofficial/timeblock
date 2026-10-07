-- Soft holds for the first-10 Annual Welcome founding seats.
CREATE TABLE IF NOT EXISTS "AnnualWelcomeClaim" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnualWelcomeClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AnnualWelcomeClaim_userId_key"
  ON "AnnualWelcomeClaim"("userId");

CREATE INDEX IF NOT EXISTS "AnnualWelcomeClaim_status_expiresAt_idx"
  ON "AnnualWelcomeClaim"("status", "expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AnnualWelcomeClaim_userId_fkey'
  ) THEN
    ALTER TABLE "AnnualWelcomeClaim"
      ADD CONSTRAINT "AnnualWelcomeClaim_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
