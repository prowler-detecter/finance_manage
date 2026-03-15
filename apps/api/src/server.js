import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { partnerRoutes } from "./routes/partners.js";
import { productRoutes } from "./routes/products.js";
import { transactionRoutes } from "./routes/transactions.js";
import { inventoryRoutes } from "./routes/inventory.js";

const app = Fastify({
  logger: true,
  disableRequestLogging: true
});

app.decorate("prisma", prisma);

await app.register(cors, {
  origin: config.corsOrigin,
  credentials: true
});

await app.register(jwt, {
  secret: config.jwtSecret
});

app.get("/health", async () => {
  return {
    ok: true,
    now: new Date().toISOString()
  };
});

await app.register(authRoutes);
await app.register(partnerRoutes);
await app.register(productRoutes);
await app.register(transactionRoutes);
await app.register(inventoryRoutes);

const close = async () => {
  try {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

process.on("SIGINT", close);
process.on("SIGTERM", close);

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`API ready at http://${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
