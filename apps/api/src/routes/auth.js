import bcrypt from "bcryptjs";
import { z } from "zod";
import { authGuard } from "../plugins/auth.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export async function authRoutes(app) {
  app.post("/auth/login", async (request, reply) => {
    try {
      const payload = loginSchema.parse(request.body || {});
      const user = await app.prisma.user.findUnique({
        where: { username: payload.username }
      });

      if (!user) {
        return reply.code(401).send({ message: "用户名或密码错误" });
      }

      const ok = await bcrypt.compare(payload.password, user.passwordHash);
      if (!ok) {
        return reply.code(401).send({ message: "用户名或密码错误" });
      }

      const token = await reply.jwtSign({
        sub: String(user.id),
        username: user.username
      });

      return {
        token,
        user: {
          id: user.id,
          username: user.username
        }
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.get("/auth/me", { preHandler: [authGuard] }, async (request, reply) => {
    const userId = Number(request.user.sub);
    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true }
    });
    if (!user) {
      return reply.code(404).send({ message: "用户不存在" });
    }
    return { user };
  });
}
