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

const updatePartnerProfileSchema = z.object({
  contactName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  profileRemark: z.string().optional().nullable()
});

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

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

  app.patch("/partners/:id/profile", { preHandler: [authGuard] }, async (request, reply) => {
    const partnerId = Number(request.params.id);
    if (!partnerId) return reply.code(400).send({ message: "客户/供应商ID无效" });

    try {
      const payload = updatePartnerProfileSchema.parse(request.body || {});
      const phone = normalizeText(payload.phone);
      if (phone && !/^[0-9+\-()\s]*$/.test(phone)) {
        return reply.code(400).send({ message: "联系电话格式不正确，仅允许数字、空格、+、-、括号" });
      }

      const existing = await app.prisma.partner.findUnique({
        where: { id: partnerId }
      });
      if (!existing) return reply.code(404).send({ message: "客户/供应商不存在" });

      const updated = await app.prisma.partner.update({
        where: { id: partnerId },
        data: {
          contactName: normalizeText(payload.contactName),
          phone: phone,
          address: normalizeText(payload.address),
          profileRemark: normalizeText(payload.profileRemark)
        }
      });

      return { data: updated };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });
}
