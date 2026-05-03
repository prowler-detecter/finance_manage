-- User account status + registration approval workflow
CREATE TYPE "UserRegistrationStatus" AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE "User"
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "UserRegistration" (
  "id" SERIAL NOT NULL,
  "username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "status" "UserRegistrationStatus" NOT NULL DEFAULT 'pending',
  "reviewed_by" INTEGER,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserRegistration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserRegistration_status_created_at_idx" ON "UserRegistration"("status", "created_at");
CREATE INDEX "UserRegistration_username_status_idx" ON "UserRegistration"("username", "status");

ALTER TABLE "UserRegistration"
ADD CONSTRAINT "UserRegistration_reviewed_by_fkey"
FOREIGN KEY ("reviewed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
