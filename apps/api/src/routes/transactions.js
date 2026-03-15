import { z } from "zod";
import { authGuard } from "../plugins/auth.js";
import { parseISODateOrThrow } from "../utils/date.js";

const transactionItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  lineAmount: z.number().nonnegative().optional(),
  productSnapshot: z
    .object({
      name: z.string().optional(),
      sku: z.string().optional(),
      spec: z.string().optional(),
      unit: z.string().optional()
    })
    .optional()
});

const createTransactionSchema = z.object({
  type: z.enum(["out", "in", "sale_return", "purchase_return", "receive", "pay"]),
  partnerId: z.number().int().positive(),
  transactionDate: z.string().min(1),
  bookkeepingDate: z.string().min(1),
  amount: z.number().positive(),
  computedAmount: z.number().nonnegative().optional(),
  remark: z.string().optional().nullable(),
  sourceTransactionId: z.number().int().positive().optional().nullable(),
  sourceRef: z.string().optional().nullable(),
  slipBook: z.string().optional().nullable(),
  slipNo: z.number().int().positive().optional().nullable(),
  items: z.array(transactionItemSchema).optional(),
  force: z.boolean().optional()
});

function expectedPartnerType(type) {
  if (type === "out" || type === "sale_return" || type === "receive") return "customer";
  if (type === "in" || type === "purchase_return" || type === "pay") return "supplier";
  return null;
}

function needProductItems(type) {
  return ["out", "in", "sale_return", "purchase_return"].includes(type);
}

function needSlip(type) {
  return ["out", "in"].includes(type);
}

function normalizeSlipBook(value) {
  return String(value || "").trim();
}

function decimalToNumber(value) {
  return Number(value?.toString?.() ?? value ?? 0);
}

function mapTransaction(transaction) {
  return {
    ...transaction,
    amount: decimalToNumber(transaction.amount),
    computedAmount: transaction.computedAmount == null ? null : decimalToNumber(transaction.computedAmount),
    transactionDate: transaction.transactionDate.toISOString().slice(0, 10),
    bookkeepingDate: transaction.bookkeepingDate.toISOString().slice(0, 10),
    items: transaction.items.map((item) => ({
      ...item,
      unitPrice: decimalToNumber(item.unitPrice),
      lineAmount: decimalToNumber(item.lineAmount),
      productSnapshot: {
        name: item.snapshotName,
        sku: item.snapshotSku,
        spec: item.snapshotSpec,
        unit: item.snapshotUnit
      }
    }))
  };
}

export async function transactionRoutes(app) {
  app.get("/transactions", { preHandler: [authGuard] }, async () => {
    const transactions = await app.prisma.transaction.findMany({
      include: {
        items: true
      },
      orderBy: [{ transactionDate: "desc" }, { recordedAt: "desc" }, { id: "desc" }]
    });

    return { data: transactions.map(mapTransaction) };
  });

  app.post("/transactions", { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const payload = createTransactionSchema.parse(request.body || {});
      const transactionDate = parseISODateOrThrow(payload.transactionDate, "transactionDate");
      const bookkeepingDate = parseISODateOrThrow(payload.bookkeepingDate, "bookkeepingDate");
      const force = payload.force === true;

      const partner = await app.prisma.partner.findUnique({
        where: { id: payload.partnerId }
      });
      if (!partner) return reply.code(404).send({ message: "客户/供应商不存在" });

      const expectedType = expectedPartnerType(payload.type);
      if (expectedType && partner.type !== expectedType) {
        return reply.code(400).send({ message: "交易对象类型不匹配" });
      }

      const warnings = [];
      const slipBook = normalizeSlipBook(payload.slipBook);
      const slipNo = payload.slipNo || null;

      if (needSlip(payload.type)) {
        if ((slipBook && !slipNo) || (!slipBook && slipNo)) {
          return reply.code(400).send({ message: "单据簿号和单据号需要同时填写" });
        }

        if (slipBook && slipNo) {
          const maxRow = await app.prisma.transaction.aggregate({
            _max: { slipNo: true },
            where: {
              type: payload.type,
              slipBook: slipBook
            }
          });
          const maxUsedNo = maxRow._max.slipNo || 0;
          const nextNo = maxUsedNo > 0 ? maxUsedNo + 1 : 1;

          if (slipNo !== nextNo) {
            warnings.push(`当前簿号建议下一号为 ${nextNo}，本次为 ${slipNo}`);
          }

          const duplicate = await app.prisma.transaction.findFirst({
            where: {
              type: payload.type,
              slipBook: slipBook,
              slipNo: slipNo
            },
            select: { id: true }
          });
          if (duplicate) {
            warnings.push(`簿号 ${slipBook} 单据号 ${slipNo} 已存在`);
          }
        }
      }

      if (warnings.length > 0 && !force) {
        return reply.code(409).send({
          message: "存在风险提示，需要确认后继续",
          warnings
        });
      }

      if (needProductItems(payload.type)) {
        if (!Array.isArray(payload.items) || payload.items.length === 0) {
          return reply.code(400).send({ message: "库存相关交易至少需要一条产品明细" });
        }
      }

      const created = await app.prisma.$transaction(async (tx) => {
        const transaction = await tx.transaction.create({
          data: {
            type: payload.type,
            partnerId: payload.partnerId,
            transactionDate,
            bookkeepingDate,
            recordedAt: new Date(),
            amount: payload.amount,
            computedAmount: payload.computedAmount ?? null,
            remark: payload.remark || null,
            sourceTransactionId: payload.sourceTransactionId || null,
            sourceRef: payload.sourceRef || null,
            slipBook: slipBook || null,
            slipNo: slipNo || null
          }
        });

        if (needProductItems(payload.type) && payload.items) {
          for (const row of payload.items) {
            const product = await tx.product.findUnique({
              where: { id: row.productId }
            });
            if (!product) {
              throw new Error(`产品不存在: ${row.productId}`);
            }
            if (!product.active) {
              throw new Error(`产品已停用，不能用于新单: ${product.name}`);
            }

            const lineAmount = row.lineAmount ?? row.quantity * row.unitPrice;
            await tx.transactionItem.create({
              data: {
                transactionId: transaction.id,
                productId: row.productId,
                quantity: row.quantity,
                unitPrice: row.unitPrice,
                lineAmount,
                snapshotName: row.productSnapshot?.name || product.name,
                snapshotSku: row.productSnapshot?.sku || product.sku || null,
                snapshotSpec: row.productSnapshot?.spec || product.spec || null,
                snapshotUnit: row.productSnapshot?.unit || product.unit || null
              }
            });
          }
        }

        return tx.transaction.findUnique({
          where: { id: transaction.id },
          include: { items: true }
        });
      });

      return reply.code(201).send({
        warnings,
        data: mapTransaction(created)
      });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });
}
