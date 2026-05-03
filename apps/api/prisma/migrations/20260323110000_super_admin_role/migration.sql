-- Add highest admin role
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'super_admin';
