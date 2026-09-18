-- One-time: link Clerk auth users to app User rows
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "clerkId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_clerkId_key" ON "User"("clerkId");
