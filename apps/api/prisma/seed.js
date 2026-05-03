import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME || "admin";
  const password = process.env.SEED_ADMIN_PASSWORD || "admin123456";
  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await prisma.user.findUnique({
    where: { username }
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: "super_admin",
        active: true
      }
    });
    console.log(`Seeded admin user: ${username}`);
  } else {
    if (existing.role !== "super_admin" || existing.active !== true) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: "super_admin", active: true }
      });
    }
    console.log(`Admin user already exists: ${username}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
