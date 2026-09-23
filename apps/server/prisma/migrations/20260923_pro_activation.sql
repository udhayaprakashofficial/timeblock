-- Pro lock-in + admin activation fields
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dodoPaymentId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "proPaidAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "proActivatedAt" TIMESTAMP(3);
