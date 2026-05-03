import bcrypt from "bcryptjs";
import { z } from "zod";
import { adminGuard, authGuard, superAdminGuard } from "../plugins/auth.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const registerSchema = z.object({
  username: z.string().min(1, "用户名不能为空").max(64),
  password: z.string().min(1, "密码不能为空").max(128)
});

const reviewRegistrationSchema = z.object({
  action: z.enum(["approve", "reject"])
});

const updateRoleSchema = z.object({
  role: z.enum(["admin", "user"])
});

const updateActiveSchema = z.object({
  active: z.boolean()
});

const updateUsernameSchema = z.object({
  username: z.string().min(1, "用户名不能为空").max(64)
});

const resetPasswordSchema = z.object({
  password: z.string().min(1, "密码不能为空").max(128)
});

const listRegistrationQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional()
});

function normalizeUsername(value) {
  return String(value || "").trim();
}

export async function authRoutes(app) {
  app.post("/auth/register", async (request, reply) => {
    try {
      const payload = registerSchema.parse(request.body || {});
      const username = normalizeUsername(payload.username);
      if (!username) {
        return reply.code(400).send({ message: "用户名不能为空" });
      }

      const [existingUser, existingPending] = await app.prisma.$transaction([
        app.prisma.user.findUnique({
          where: { username },
          select: { id: true }
        }),
        app.prisma.userRegistration.findFirst({
          where: {
            username,
            status: "pending"
          },
          select: { id: true }
        })
      ]);

      if (existingUser) {
        return reply.code(409).send({ message: "用户名已存在，请更换后重试" });
      }
      if (existingPending) {
        return reply.code(409).send({ message: "该用户名已有待审核申请，请等待审核结果" });
      }

      const passwordHash = await bcrypt.hash(payload.password, 10);
      await app.prisma.userRegistration.create({
        data: {
          username,
          passwordHash,
          status: "pending"
        }
      });

      return reply.code(201).send({
        data: {
          message: "注册申请已提交，等待管理员审核"
        }
      });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.post("/auth/login", async (request, reply) => {
    try {
      const payload = loginSchema.parse(request.body || {});
      const username = normalizeUsername(payload.username);
      const user = await app.prisma.user.findUnique({
        where: { username }
      });

      if (!user) {
        return reply.code(401).send({ message: "用户名或密码错误" });
      }
      if (!user.active) {
        return reply.code(403).send({ message: "账号已被禁用，请联系管理员" });
      }

      const ok = await bcrypt.compare(payload.password, user.passwordHash);
      if (!ok) {
        return reply.code(401).send({ message: "用户名或密码错误" });
      }

      const token = await reply.jwtSign({
        sub: String(user.id),
        username: user.username,
        role: user.role
      });

      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          active: user.active
        }
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.get("/auth/me", { preHandler: [authGuard] }, async (request, reply) => {
    const userId = Number(request.authUser?.id || 0);
    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, role: true, active: true }
    });
    if (!user) {
      return reply.code(404).send({ message: "用户不存在" });
    }
    return { user };
  });

  app.get("/admin/registrations", { preHandler: [authGuard, adminGuard] }, async (request, reply) => {
    try {
      const query = listRegistrationQuerySchema.parse(request.query || {});
      const rows = await app.prisma.userRegistration.findMany({
        where: query.status ? { status: query.status } : undefined,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          reviewer: {
            select: { id: true, username: true }
          }
        }
      });

      return {
        data: rows.map((row) => ({
          id: row.id,
          username: row.username,
          status: row.status,
          reviewedBy: row.reviewedBy,
          reviewerName: row.reviewer?.username || null,
          reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString()
        }))
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.patch("/admin/registrations/:id/review", { preHandler: [authGuard, adminGuard] }, async (request, reply) => {
    const registrationId = Number(request.params.id);
    if (!registrationId) return reply.code(400).send({ message: "申请ID无效" });

    try {
      const payload = reviewRegistrationSchema.parse(request.body || {});
      const reviewerId = Number(request.authUser?.id || 0);
      if (!reviewerId) return reply.code(401).send({ message: "登录已失效" });

      const registration = await app.prisma.userRegistration.findUnique({
        where: { id: registrationId }
      });
      if (!registration) {
        return reply.code(404).send({ message: "注册申请不存在" });
      }
      if (registration.status !== "pending") {
        return reply.code(409).send({ message: "该申请已处理，请刷新列表" });
      }

      if (payload.action === "reject") {
        const updated = await app.prisma.userRegistration.update({
          where: { id: registrationId },
          data: {
            status: "rejected",
            reviewedBy: reviewerId,
            reviewedAt: new Date()
          }
        });
        return {
          data: {
            id: updated.id,
            status: updated.status
          }
        };
      }

      const result = await app.prisma.$transaction(async (tx) => {
        const existingUser = await tx.user.findUnique({
          where: { username: registration.username },
          select: { id: true }
        });
        if (existingUser) {
          throw new Error("该用户名已被占用，无法通过此申请");
        }

        await tx.user.create({
          data: {
            username: registration.username,
            passwordHash: registration.passwordHash,
            role: "user",
            active: true
          }
        });

        const updated = await tx.userRegistration.update({
          where: { id: registrationId },
          data: {
            status: "approved",
            reviewedBy: reviewerId,
            reviewedAt: new Date()
          }
        });

        return updated;
      });

      return {
        data: {
          id: result.id,
          status: result.status
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "参数错误";
      const code = message.includes("占用") ? 409 : 400;
      return reply.code(code).send({ message });
    }
  });

  app.get("/admin/users", { preHandler: [authGuard, adminGuard] }, async () => {
    const users = await app.prisma.user.findMany({
      orderBy: [{ id: "asc" }]
    });
    return {
      data: users.map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
        active: user.active,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      }))
    };
  });

  app.patch("/admin/users/:id/role", { preHandler: [authGuard, superAdminGuard] }, async (request, reply) => {
    const userId = Number(request.params.id);
    if (!userId) return reply.code(400).send({ message: "用户ID无效" });

    try {
      const payload = updateRoleSchema.parse(request.body || {});
      const operatorId = Number(request.authUser?.id || 0);
      if (operatorId === userId) {
        return reply.code(409).send({ message: "不能修改自己的角色" });
      }

      const updated = await app.prisma.user.update({
        where: { id: userId },
        data: { role: payload.role }
      });
      return {
        data: {
          id: updated.id,
          role: updated.role
        }
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.patch("/admin/users/:id/username", { preHandler: [authGuard, adminGuard] }, async (request, reply) => {
    const userId = Number(request.params.id);
    if (!userId) return reply.code(400).send({ message: "用户ID无效" });

    try {
      const payload = updateUsernameSchema.parse(request.body || {});
      const username = normalizeUsername(payload.username);
      if (!username) {
        return reply.code(400).send({ message: "用户名不能为空" });
      }

      const operatorRole = String(request.authUser?.role || "user");
      const target = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, username: true }
      });
      if (!target) return reply.code(404).send({ message: "用户不存在" });
      if (target.role === "super_admin" && operatorRole !== "super_admin") {
        return reply.code(403).send({ message: "仅最高管理员可修改最高管理员用户名" });
      }

      const duplicate = await app.prisma.user.findFirst({
        where: {
          username,
          id: {
            not: userId
          }
        },
        select: { id: true }
      });
      if (duplicate) {
        return reply.code(409).send({ message: "用户名已存在，请更换后重试" });
      }

      const updated = await app.prisma.user.update({
        where: { id: userId },
        data: { username }
      });
      return {
        data: {
          id: updated.id,
          username: updated.username
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "参数错误";
      if (message.includes("Unique constraint")) {
        return reply.code(409).send({ message: "用户名已存在，请更换后重试" });
      }
      return reply.code(400).send({ message });
    }
  });

  app.patch("/admin/users/:id/active", { preHandler: [authGuard, adminGuard] }, async (request, reply) => {
    const userId = Number(request.params.id);
    if (!userId) return reply.code(400).send({ message: "用户ID无效" });

    try {
      const payload = updateActiveSchema.parse(request.body || {});
      const operatorId = Number(request.authUser?.id || 0);
      const operatorRole = String(request.authUser?.role || "user");
      if (operatorId === userId && payload.active === false) {
        return reply.code(409).send({ message: "不能禁用自己的账号" });
      }

      const target = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true }
      });
      if (!target) return reply.code(404).send({ message: "用户不存在" });
      if (target.role === "super_admin" && operatorRole !== "super_admin") {
        return reply.code(403).send({ message: "仅最高管理员可变更最高管理员账号状态" });
      }

      const updated = await app.prisma.user.update({
        where: { id: userId },
        data: { active: payload.active }
      });
      return {
        data: {
          id: updated.id,
          active: updated.active
        }
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.patch("/admin/users/:id/password", { preHandler: [authGuard, adminGuard] }, async (request, reply) => {
    const userId = Number(request.params.id);
    if (!userId) return reply.code(400).send({ message: "用户ID无效" });

    try {
      const payload = resetPasswordSchema.parse(request.body || {});
      const operatorRole = String(request.authUser?.role || "user");
      const target = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true }
      });
      if (!target) return reply.code(404).send({ message: "用户不存在" });
      if (target.role === "super_admin" && operatorRole !== "super_admin") {
        return reply.code(403).send({ message: "仅最高管理员可重置最高管理员密码" });
      }

      const passwordHash = await bcrypt.hash(payload.password, 10);
      const updated = await app.prisma.user.update({
        where: { id: userId },
        data: { passwordHash }
      });
      return {
        data: {
          id: updated.id
        }
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });
}
