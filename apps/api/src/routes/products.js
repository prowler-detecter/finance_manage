import { z } from "zod";
import { authGuard } from "../plugins/auth.js";

const createProductSchema = z.object({
  name: z.string().min(1, "产品名称不能为空"),
  sku: z.string().optional().nullable(),
  spec: z.string().optional().nullable(),
  unit: z.string().min(1, "单位不能为空"),
  defaultUnitPrice: z.number().nonnegative().default(0)
});

const updateProductSchema = z.object({
  name: z.string().min(1, "产品名称不能为空"),
  sku: z.string().optional().nullable(),
  spec: z.string().optional().nullable(),
  unit: z.string().min(1, "单位不能为空"),
  defaultUnitPrice: z.number().nonnegative()
});

const updateActiveSchema = z.object({
  active: z.boolean()
});

function normalizeProductPayload(payload) {
  return {
    name: String(payload.name || ""),
    sku: payload.sku == null ? null : String(payload.sku),
    spec: payload.spec == null ? null : String(payload.spec),
    unit: String(payload.unit || ""),
    defaultUnitPrice: Number(payload.defaultUnitPrice || 0)
  };
}

async function ensureSkuUnique(prisma, sku, excludeId = null) {
  if (!sku) return;
  const exists = await prisma.product.findFirst({
    where: {
      sku: {
        equals: sku,
        mode: "insensitive"
      },
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: { id: true }
  });
  if (exists) {
    const error = new Error("产品编码已存在");
    error.statusCode = 409;
    throw error;
  }
}

async function ensureNameSpecUnique(prisma, name, spec, excludeId = null) {
  const exists = await prisma.product.findFirst({
    where: {
      name,
      spec: spec ?? null,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: { id: true }
  });
  if (exists) {
    const error = new Error("产品名称和规格已存在");
    error.statusCode = 409;
    throw error;
  }
}

function mapProduct(product) {
  return {
    ...product,
    defaultUnitPrice: Number(product.defaultUnitPrice)
  };
}

export async function productRoutes(app) {
  app.get("/products", { preHandler: [authGuard] }, async () => {
    const [products, itemRefRows] = await app.prisma.$transaction([
      app.prisma.product.findMany({
        orderBy: { id: "asc" }
      }),
      app.prisma.transactionItem.groupBy({
        by: ["productId"],
        _count: { _all: true }
      })
    ]);

    const itemRefMap = new Map(itemRefRows.map((row) => [Number(row.productId), Number(row._count?._all || 0)]));

    return {
      data: products.map((p) => {
        const refCount = Number(itemRefMap.get(Number(p.id)) || 0);
        const hasTransactionDetail = refCount > 0;
        return {
          ...mapProduct(p),
          hasTransactionDetail,
          deletable: !hasTransactionDetail
        };
      })
    };
  });

  app.post("/products", { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const parsed = createProductSchema.parse(request.body || {});
      const payload = normalizeProductPayload(parsed);
      await ensureSkuUnique(app.prisma, payload.sku);
      await ensureNameSpecUnique(app.prisma, payload.name, payload.spec);

      const product = await app.prisma.product.create({
        data: payload
      });

      return reply.code(201).send({
        data: mapProduct(product)
      });
    } catch (error) {
      const code = error?.statusCode || 400;
      return reply.code(code).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.patch("/products/:id", { preHandler: [authGuard] }, async (request, reply) => {
    const productId = Number(request.params.id);
    if (!productId) return reply.code(400).send({ message: "产品ID无效" });

    try {
      const parsed = updateProductSchema.parse(request.body || {});
      const payload = normalizeProductPayload(parsed);

      const exists = await app.prisma.product.findUnique({
        where: { id: productId },
        select: { id: true }
      });
      if (!exists) return reply.code(404).send({ message: "产品不存在" });

      await ensureSkuUnique(app.prisma, payload.sku, productId);
      await ensureNameSpecUnique(app.prisma, payload.name, payload.spec, productId);

      const updated = await app.prisma.product.update({
        where: { id: productId },
        data: payload
      });

      return {
        data: mapProduct(updated)
      };
    } catch (error) {
      const code = error?.statusCode || 400;
      return reply.code(code).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.patch("/products/:id/active", { preHandler: [authGuard] }, async (request, reply) => {
    const productId = Number(request.params.id);
    if (!productId) return reply.code(400).send({ message: "产品ID无效" });

    try {
      const payload = updateActiveSchema.parse(request.body || {});
      const product = await app.prisma.product.update({
        where: { id: productId },
        data: { active: payload.active }
      });
      return {
        data: mapProduct(product)
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.delete("/products/:id", { preHandler: [authGuard] }, async (request, reply) => {
    const productId = Number(request.params.id);
    if (!productId) return reply.code(400).send({ message: "产品ID无效" });

    const product = await app.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true }
    });
    if (!product) return reply.code(404).send({ message: "产品不存在" });

    const txItemCount = await app.prisma.transactionItem.count({ where: { productId } });

    if (txItemCount > 0) {
      return reply.code(409).send({
        message: `产品「${product.name}」已参与流水明细，不可删除，请改为停用`
      });
    }

    // 删除前清理该产品的盘点记录，避免外键限制
    // （你的规则是仅按“是否参与流水明细”决定能否删除）
    await app.prisma.$transaction([
      app.prisma.stockAdjustment.deleteMany({ where: { productId } }),
      app.prisma.product.delete({ where: { id: productId } })
    ]);

    return {
      data: {
        id: productId
      }
    };
  });
}
