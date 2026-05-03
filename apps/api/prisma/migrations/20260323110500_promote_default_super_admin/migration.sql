-- Promote default admin account to highest admin
UPDATE "User"
SET "role" = 'super_admin'
WHERE "username" = 'admin' AND "role" = 'admin';
