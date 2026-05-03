import { z } from "zod";
import { authGuard } from "../plugins/auth.js";

const createProcessingSchema = z.object({
  name: z.string().min(1, "加工名称不能为空"),
  code: z.string().optional().nullable(),
  spec: z.string().optional().nullable(),
  unit: z.string().min(1, "单位不能为空"),
  defaultUnitPrice: z.number().nonnegative().default(0)
});

const updateProcessingSchema = z.object({
  name: z.string().min(1, "加工名称不能为空"),
  code: z.string().optional().nullable(),
  spec: z.string().optional().nullable(),
  unit: z.string().min(1, "单位不能为空"),
  defaultUnitPrice: z.number().nonnegative()
});

const updateActiveSchema = z.object({
  active: z.boolean()
});

function normalizeProcessingPayload(payload) {
  return {
    name: String(payload.name || "").trim(),
    code: payload.code == null ? null : String(payload.code).trim() || null,
    spec: payload.spec == null ? null : String(payload.spec).trim() || null,
    unit: String(payload.unit || "").trim(),
    defaultUnitPrice: Number(payload.defaultUnitPrice || 0)
  };
}

async function ensureCodeUnique(prisma, code, excludeId = null) {
  if (!code) return;
  const exists = await prisma.processing.findFirst({
    where: {
      code: { equals: code },
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: { id: true }
  });
  if (exists) {
    const error = new Error("加工编码已存在");
    error.statusCode = 409;
    throw error;
  }
}

async function ensureNameSpecUnitUniqueWhenNoCode(prisma, payload, excludeId = null) {
  if (payload.code) return;
  const exists = await prisma.processing.findFirst({
    where: {
      code: null,
      name: payload.name,
      spec: payload.spec ?? null,
      unit: payload.unit,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: { id: true }
  });
  if (exists) {
    const error = new Error("无编码加工项的名称+规格+单位已存在");
    error.statusCode = 409;
    throw error;
  }
}

function mapProcessing(row) {
  return {
    ...row,
    defaultUnitPrice: Number(row.defaultUnitPrice)
  };
}

export async function processingRoutes(app) {
  app.get("/processings", { preHandler: [authGuard] }, async () => {
    const [rows, lineRefRows] = await app.prisma.$transaction([
      app.prisma.processing.findMany({
        orderBy: { id: "asc" }
      }),
      app.prisma.inboundLine.groupBy({
        by: ["processingId"],
        _count: { _all: true },
        where: {
          lineType: "processing",
          processingId: { not: null }
        }
      })
    ]);

    const lineRefMap = new Map(lineRefRows.map((item) => [Number(item.processingId), Number(item._count?._all || 0)]));

    return {
      data: rows.map((row) => {
        const refCount = Number(lineRefMap.get(Number(row.id)) || 0);
        const hasTransactionDetail = refCount > 0;
        return {
          ...mapProcessing(row),
          hasTransactionDetail,
          deletable: !hasTransactionDetail
        };
      })
    };
  });

  app.post("/processings", { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const parsed = createProcessingSchema.parse(request.body || {});
      const payload = normalizeProcessingPayload(parsed);
      await ensureCodeUnique(app.prisma, payload.code);
      await ensureNameSpecUnitUniqueWhenNoCode(app.prisma, payload);

      const created = await app.prisma.processing.create({
        data: payload
      });

      return reply.code(201).send({
        data: mapProcessing(created)
      });
    } catch (error) {
      const code = error?.statusCode || 400;
      return reply.code(code).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.patch("/processings/:id", { preHandler: [authGuard] }, async (request, reply) => {
    const processingId = Number(request.params.id);
    if (!processingId) return reply.code(400).send({ message: "加工ID无效" });

    try {
      const parsed = updateProcessingSchema.parse(request.body || {});
      const payload = normalizeProcessingPayload(parsed);

      const exists = await app.prisma.processing.findUnique({
        where: { id: processingId },
        select: { id: true }
      });
      if (!exists) return reply.code(404).send({ message: "加工项不存在" });

      await ensureCodeUnique(app.prisma, payload.code, processingId);
      await ensureNameSpecUnitUniqueWhenNoCode(app.prisma, payload, processingId);

      const updated = await app.prisma.processing.update({
        where: { id: processingId },
        data: payload
      });

      return {
        data: mapProcessing(updated)
      };
    } catch (error) {
      const code = error?.statusCode || 400;
      return reply.code(code).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.patch("/processings/:id/active", { preHandler: [authGuard] }, async (request, reply) => {
    const processingId = Number(request.params.id);
    if (!processingId) return reply.code(400).send({ message: "加工ID无效" });

    try {
      const payload = updateActiveSchema.parse(request.body || {});
      const updated = await app.prisma.processing.update({
        where: { id: processingId },
        data: { active: payload.active }
      });
      return {
        data: mapProcessing(updated)
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.delete("/processings/:id", { preHandler: [authGuard] }, async (request, reply) => {
    const processingId = Number(request.params.id);
    if (!processingId) return reply.code(400).send({ message: "加工ID无效" });

    const row = await app.prisma.processing.findUnique({
      where: { id: processingId },
      select: { id: true, name: true }
    });
    if (!row) return reply.code(404).send({ message: "加工项不存在" });

    const refCount = await app.prisma.inboundLine.count({
      where: {
        lineType: "processing",
        processingId
      }
    });
    if (refCount > 0) {
      return reply.code(409).send({
        message: `加工项「${row.name}」已参与流水明细，不可删除，请改为停用`
      });
    }

    await app.prisma.processing.delete({
      where: { id: processingId }
    });

    return {
      data: { id: processingId }
    };
  });
}
