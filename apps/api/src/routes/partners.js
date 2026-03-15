import { z } from "zod";
import { authGuard } from "../plugins/auth.js";

const createPartnerSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  type: z.enum(["customer", "supplier"]),
  contactName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  profileRemark: z.string().optional().nullable()
});

export async function partnerRoutes(app) {
  app.get("/partners", { preHandler: [authGuard] }, async () => {
    const partners = await app.prisma.partner.findMany({
      orderBy: { id: "asc" }
    });
    return { data: partners };
  });

  app.post("/partners", { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const payload = createPartnerSchema.parse(request.body || {});
      const partner = await app.prisma.partner.create({
        data: payload
      });
      return reply.code(201).send({ data: partner });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });
}
