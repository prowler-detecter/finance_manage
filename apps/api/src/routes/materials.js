import { z } from "zod";
import { authGuard } from "../plugins/auth.js";

const createMaterialSchema = z.object({
  name: z.string().min(1, "物料名称不能为空"),
  code: z.string().optional().nullable(),
  spec: z.string().optional().nullable(),
  unit: z.string().min(1, "单位不能为空"),
  defaultUnitPrice: z.number().nonnegative().default(0)
});

const updateMaterialSchema = z.object({
  name: z.string().min(1, "物料名称不能为空"),
  code: z.string().optional().nullable(),
  spec: z.string().optional().nullable(),
  unit: z.string().min(1, "单位不能为空"),
  defaultUnitPrice: z.number().nonnegative()
});

const updateActiveSchema = z.object({
  active: z.boolean()
});

function normalizeMaterialPayload(payload) {
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
  const exists = await prisma.material.findFirst({
    where: {
      code: { equals: code },
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: { id: true }
  });
  if (exists) {
    const error = new Error("物料编码已存在");
    error.statusCode = 409;
    throw error;
  }
}

async function ensureNameSpecUnitUniqueWhenNoCode(prisma, payload, excludeId = null) {
  if (payload.code) return;
  const exists = await prisma.material.findFirst({
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
    const error = new Error("无编码物料的名称+规格+单位已存在");
    error.statusCode = 409;
    throw error;
  }
}

function mapMaterial(material) {
  return {
    ...material,
    defaultUnitPrice: Number(material.defaultUnitPrice)
  };
}

export async function materialRoutes(app) {
  app.get("/materials", { preHandler: [authGuard] }, async () => {
    const [materials, lineRefRows] = await app.prisma.$transaction([
      app.prisma.material.findMany({
        orderBy: { id: "asc" }
      }),
      app.prisma.inboundLine.groupBy({
        by: ["materialId"],
        _count: { _all: true },
        where: {
          lineType: "material",
          materialId: { not: null }
        }
      })
    ]);

    const lineRefMap = new Map(lineRefRows.map((row) => [Number(row.materialId), Number(row._count?._all || 0)]));

    return {
      data: materials.map((row) => {
        const refCount = Number(lineRefMap.get(Number(row.id)) || 0);
        const hasTransactionDetail = refCount > 0;
        return {
          ...mapMaterial(row),
          hasTransactionDetail,
          deletable: !hasTransactionDetail
        };
      })
    };
  });

  app.post("/materials", { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const parsed = createMaterialSchema.parse(request.body || {});
      const payload = normalizeMaterialPayload(parsed);
      await ensureCodeUnique(app.prisma, payload.code);
      await ensureNameSpecUnitUniqueWhenNoCode(app.prisma, payload);

      const created = await app.prisma.material.create({
        data: payload
      });

      return reply.code(201).send({
        data: mapMaterial(created)
      });
    } catch (error) {
      const code = error?.statusCode || 400;
      return reply.code(code).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.patch("/materials/:id", { preHandler: [authGuard] }, async (request, reply) => {
    const materialId = Number(request.params.id);
    if (!materialId) return reply.code(400).send({ message: "物料ID无效" });

    try {
      const parsed = updateMaterialSchema.parse(request.body || {});
      const payload = normalizeMaterialPayload(parsed);

      const exists = await app.prisma.material.findUnique({
        where: { id: materialId },
        select: { id: true }
      });
      if (!exists) return reply.code(404).send({ message: "物料不存在" });

      await ensureCodeUnique(app.prisma, payload.code, materialId);
      await ensureNameSpecUnitUniqueWhenNoCode(app.prisma, payload, materialId);

      const updated = await app.prisma.material.update({
        where: { id: materialId },
        data: payload
      });

      return {
        data: mapMaterial(updated)
      };
    } catch (error) {
      const code = error?.statusCode || 400;
      return reply.code(code).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.patch("/materials/:id/active", { preHandler: [authGuard] }, async (request, reply) => {
    const materialId = Number(request.params.id);
    if (!materialId) return reply.code(400).send({ message: "物料ID无效" });

    try {
      const payload = updateActiveSchema.parse(request.body || {});
      const updated = await app.prisma.material.update({
        where: { id: materialId },
        data: { active: payload.active }
      });

      return {
        data: mapMaterial(updated)
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.delete("/materials/:id", { preHandler: [authGuard] }, async (request, reply) => {
    const materialId = Number(request.params.id);
    if (!materialId) return reply.code(400).send({ message: "物料ID无效" });

    const material = await app.prisma.material.findUnique({
      where: { id: materialId },
      select: { id: true, name: true }
    });
    if (!material) return reply.code(404).send({ message: "物料不存在" });

    const refCount = await app.prisma.inboundLine.count({
      where: {
        lineType: "material",
        materialId
      }
    });
    if (refCount > 0) {
      return reply.code(409).send({
        message: `物料「${material.name}」已参与流水明细，不可删除，请改为停用`
      });
    }

    await app.prisma.material.delete({
      where: { id: materialId }
    });

    return {
      data: { id: materialId }
    };
  });
}
