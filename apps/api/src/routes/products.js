import { z } from "zod";
import { authGuard } from "../plugins/auth.js";

const createProductSchema = z.object({
  name: z.string().min(1, "产品名称不能为空"),
  sku: z.string().optional().nullable(),
  spec: z.string().optional().nullable(),
  unit: z.string().min(1, "单位不能为空"),
  defaultUnitPrice: z.number().nonnegative().default(0)
});

const updateActiveSchema = z.object({
  active: z.boolean()
});

export async function productRoutes(app) {
  app.get("/products", { preHandler: [authGuard] }, async () => {
    const products = await app.prisma.product.findMany({
      orderBy: { id: "asc" }
    });
    return {
      data: products.map((p) => ({
        ...p,
        defaultUnitPrice: Number(p.defaultUnitPrice)
      }))
    };
  });

  app.post("/products", { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const payload = createProductSchema.parse(request.body || {});

      if (payload.sku) {
        const exists = await app.prisma.product.findFirst({
          where: {
            sku: {
              equals: payload.sku,
              mode: "insensitive"
            }
          }
        });
        if (exists) {
          return reply.code(409).send({ message: "产品编码已存在" });
        }
      }

      const product = await app.prisma.product.create({
        data: payload
      });

      return reply.code(201).send({
        data: {
          ...product,
          defaultUnitPrice: Number(product.defaultUnitPrice)
        }
      });
    } catch (error) {
      return reply.code(400).send({
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
        data: {
          ...product,
          defaultUnitPrice: Number(product.defaultUnitPrice)
        }
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });
}
