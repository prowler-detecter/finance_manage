-- Add role-based permissions for backup/restore
CREATE TYPE "UserRole" AS ENUM ('admin', 'user');

ALTER TABLE "User"
ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'user';

UPDATE "User"
SET "role" = 'admin'
WHERE "username" = 'admin';
