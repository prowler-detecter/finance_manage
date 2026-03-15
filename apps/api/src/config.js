import dotenv from "dotenv";

dotenv.config();

function required(key, fallback = "") {
  const value = process.env[key] || fallback;
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "0.0.0.0",
  jwtSecret: required("JWT_SECRET", "replace-this-in-production"),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  databaseUrl: required("DATABASE_URL", "postgresql://finance_user:finance_pass@localhost:5432/finance_db")
};
