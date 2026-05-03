export async function authGuard(request, reply) {
  try {
    await request.jwtVerify();
    const userId = Number(request.user?.sub || 0);
    if (!userId) {
      return reply.code(401).send({ message: "Unauthorized" });
    }

    const user = await request.server.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, role: true, active: true }
    });
    if (!user) {
      return reply.code(401).send({ message: "用户不存在或登录已失效" });
    }
    if (!user.active) {
      return reply.code(403).send({ message: "账号已被禁用，请联系管理员" });
    }

    request.authUser = user;
  } catch (error) {
    return reply.code(401).send({ message: "Unauthorized" });
  }
}

export async function adminGuard(request, reply) {
  try {
    if (!request.authUser) {
      await authGuard(request, reply);
      if (!request.authUser) return;
    }
    if (!["admin", "super_admin"].includes(String(request.authUser.role || ""))) {
      return reply.code(403).send({ message: "仅管理员可执行此操作" });
    }
  } catch (error) {
    return reply.code(401).send({ message: "Unauthorized" });
  }
}

export async function superAdminGuard(request, reply) {
  try {
    if (!request.authUser) {
      await authGuard(request, reply);
      if (!request.authUser) return;
    }
    if (request.authUser.role !== "super_admin") {
      return reply.code(403).send({ message: "仅最高管理员可执行此操作" });
    }
  } catch (error) {
    return reply.code(401).send({ message: "Unauthorized" });
  }
}
