import { z } from "zod";
import { authGuard } from "../plugins/auth.js";
import { parseISODateOrThrow } from "../utils/date.js";

const transactionItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().finite().refine((value) => value !== 0, "数量不能为0"),
  unitPrice: z.number().nonnegative(),
  lineAmount: z.number().optional(),
  productSnapshot: z
    .object({
      name: z.string().optional(),
      sku: z.string().optional(),
      spec: z.string().optional(),
      unit: z.string().optional()
    })
    .optional()
});

const inboundBreakdownSchema = z.object({
  materialAmount: z.number().nonnegative().optional(),
  processingAmount: z.number().nonnegative().optional(),
  materialNote: z.string().optional().nullable(),
  processingNote: z.string().optional().nullable()
});

const inboundLineSchema = z.object({
  lineType: z.enum(["material", "processing"]),
  materialId: z.number().int().positive().optional().nullable(),
  processingId: z.number().int().positive().optional().nullable(),
  quantity: z.number().finite().refine((value) => value !== 0, "数量不能为0"),
  unitPrice: z.number().nonnegative(),
  lineAmount: z.number().nonnegative().optional()
});

const createTransactionSchema = z.object({
  type: z.enum(["out", "in", "sale_return", "purchase_return", "receive", "pay", "receive_diff", "pay_diff"]),
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
  inboundBreakdown: inboundBreakdownSchema.optional(),
  inboundLines: z.array(inboundLineSchema).optional(),
  force: z.boolean().optional()
});

const updateSlipSchema = z.object({
  slipBook: z.string().optional().nullable(),
  slipNo: z.number().int().positive().optional().nullable(),
  force: z.boolean().optional()
});

const undoAutoSplitSchema = z.object({
  transactionIds: z.array(z.number().int().positive()).min(1).max(2)
});

const AUTO_SPLIT_UNDO_WINDOW_MS = 10 * 60 * 1000;
const AUTO_SPLIT_GROUP_MAX_SPAN_MS = 60 * 1000;
const QUANTITY_SCALE = 4;

function expectedPartnerType(type) {
  if (type === "out" || type === "sale_return" || type === "receive" || type === "receive_diff") return "customer";
  if (type === "in" || type === "purchase_return" || type === "pay" || type === "pay_diff") return "supplier";
  return null;
}

function needProductItems(type) {
  return ["out", "sale_return"].includes(type);
}

function needInboundLines(type) {
  return ["in", "purchase_return"].includes(type);
}

function needSlip(type) {
  return ["out", "in", "sale_return", "purchase_return"].includes(type);
}

function slipSequenceTypes(type) {
  if (type === "out" || type === "sale_return") return ["out", "sale_return"];
  if (type === "in" || type === "purchase_return") return ["in", "purchase_return"];
  return [type];
}

function normalizeSlipBook(value) {
  return String(value || "").trim();
}

function decimalToNumber(value) {
  return Number(value?.toString?.() ?? value ?? 0);
}

function roundToScale(value, scale = QUANTITY_SCALE) {
  const factor = 10 ** scale;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function normalizeQuantity(value) {
  const qty = Number(value);
  if (!Number.isFinite(qty)) return null;
  return roundToScale(qty, QUANTITY_SCALE);
}

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : "";
}

function buildSlipDuplicateWarningText(slipBook, slipNo, duplicate, operatorUserId) {
  const duplicateUserId = Number(duplicate?.recordedById || 0);
  const duplicateUsername = String(duplicate?.recordedBy?.username || "").trim();
  const currentUserId = Number(operatorUserId || 0);
  if (duplicateUserId > 0 && currentUserId > 0 && duplicateUserId !== currentUserId) {
    return `簿号 ${slipBook} 单据号 ${slipNo} 已由用户 ${duplicateUsername || `#${duplicateUserId}`} 登记`;
  }
  return `簿号 ${slipBook} 单据号 ${slipNo} 已存在`;
}

function computeItemAmount(rows) {
  return rows.reduce((sum, row) => {
    const quantity = Math.abs(Number(row.quantity || 0));
    const unitPrice = Number(row.unitPrice || 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return sum;
    return sum + quantity * unitPrice;
  }, 0);
}

function computeInboundAmount(rows) {
  return rows.reduce((sum, row) => {
    const quantity = Math.abs(Number(row.quantity || 0));
    const unitPrice = Number(row.unitPrice || 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return sum;
    return sum + quantity * unitPrice;
  }, 0);
}

function mapTransaction(transaction) {
  return {
    ...transaction,
    recordedByUsername: transaction.recordedBy?.username || null,
    amount: decimalToNumber(transaction.amount),
    computedAmount: transaction.computedAmount == null ? null : decimalToNumber(transaction.computedAmount),
    transactionDate: transaction.transactionDate.toISOString().slice(0, 10),
    bookkeepingDate: transaction.bookkeepingDate.toISOString().slice(0, 10),
    items: transaction.items.map((item) => ({
      ...item,
      quantity: decimalToNumber(item.quantity),
      unitPrice: decimalToNumber(item.unitPrice),
      lineAmount: decimalToNumber(item.lineAmount),
      productSnapshot: {
        name: item.snapshotName,
        sku: item.snapshotSku,
        spec: item.snapshotSpec,
        unit: item.snapshotUnit
      }
    })),
    inboundBreakdown: transaction.inboundBreakdown
      ? {
          materialAmount: decimalToNumber(transaction.inboundBreakdown.materialAmount),
          processingAmount: decimalToNumber(transaction.inboundBreakdown.processingAmount),
          materialNote: transaction.inboundBreakdown.materialNote,
          processingNote: transaction.inboundBreakdown.processingNote
        }
      : null,
    inboundLines: (transaction.inboundLines || []).map((line) => ({
      ...line,
      quantity: decimalToNumber(line.quantity),
      unitPrice: decimalToNumber(line.unitPrice),
      lineAmount: decimalToNumber(line.lineAmount)
    }))
  };
}

export async function transactionRoutes(app) {
  app.get("/transactions", { preHandler: [authGuard] }, async () => {
    const transactions = await app.prisma.transaction.findMany({
      include: {
        items: true,
        inboundBreakdown: true,
        inboundLines: true,
        recordedBy: {
          select: { username: true }
        }
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
      const recorderUserId = Number(request.authUser?.id || 0) > 0 ? Number(request.authUser.id) : null;

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
          const sequenceTypes = slipSequenceTypes(payload.type);
          const maxRow = await app.prisma.transaction.aggregate({
            _max: { slipNo: true },
            where: {
              type: { in: sequenceTypes },
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
              type: { in: sequenceTypes },
              slipBook: slipBook,
              slipNo: slipNo
            },
            select: {
              id: true,
              recordedById: true,
              recordedBy: {
                select: { username: true }
              }
            }
          });
          if (duplicate) {
            warnings.push(buildSlipDuplicateWarningText(slipBook, slipNo, duplicate, recorderUserId));
          }
        }
      }

      if (warnings.length > 0 && !force) {
        return reply.code(409).send({
          message: "存在风险提示，需要确认后继续",
          warnings
        });
      }

      let normalizedItems = [];
      let outPositiveItems = [];
      let outNegativeItems = [];
      let normalizedInboundLines = [];
      let inboundPositiveLines = [];
      let inboundNegativeLines = [];
      if (needProductItems(payload.type)) {
        if (!Array.isArray(payload.items) || payload.items.length === 0) {
          return reply.code(400).send({ message: "库存相关交易至少需要一条产品明细" });
        }

        normalizedItems = payload.items.map((row) => ({
          productId: Number(row.productId),
          quantity: normalizeQuantity(row.quantity),
          unitPrice: Number(row.unitPrice),
          productSnapshot: row.productSnapshot
        }));

        for (let i = 0; i < normalizedItems.length; i += 1) {
          const row = normalizedItems[i];
          if (row.quantity == null || row.quantity === 0) {
            return reply.code(400).send({ message: `第 ${i + 1} 行数量必须为非0有效数字` });
          }
          if (payload.type !== "out" && row.quantity <= 0) {
            return reply.code(400).send({ message: `第 ${i + 1} 行数量必须大于0` });
          }
          if (!Number.isFinite(row.unitPrice) || row.unitPrice < 0) {
            return reply.code(400).send({ message: `第 ${i + 1} 行单价不能为负数` });
          }
        }

        if (payload.type === "out") {
          outPositiveItems = normalizedItems.filter((row) => row.quantity > 0);
          outNegativeItems = normalizedItems
            .filter((row) => row.quantity < 0)
            .map((row) => ({ ...row, quantity: Math.abs(row.quantity) }));
        }
      }

      if (needInboundLines(payload.type)) {
        if (!Array.isArray(payload.inboundLines) || payload.inboundLines.length === 0) {
          return reply.code(400).send({ message: `${payload.type === "in" ? "入库" : "采购退货"}需要填写物料/加工明细` });
        }
        normalizedInboundLines = payload.inboundLines.map((line) => ({
          lineType: String(line.lineType || ""),
          materialId: line.materialId == null ? null : Number(line.materialId),
          processingId: line.processingId == null ? null : Number(line.processingId),
          quantity: normalizeQuantity(line.quantity),
          unitPrice: Number(line.unitPrice)
        }));

        for (let i = 0; i < normalizedInboundLines.length; i += 1) {
          const row = normalizedInboundLines[i];
          if (!["material", "processing"].includes(row.lineType)) {
            return reply.code(400).send({ message: `第 ${i + 1} 行类别必须是“物料”或“加工”` });
          }
          if (row.quantity == null || row.quantity === 0) {
            return reply.code(400).send({ message: `第 ${i + 1} 行数量必须为非0有效数字` });
          }
          if (!Number.isFinite(row.unitPrice) || row.unitPrice < 0) {
            return reply.code(400).send({ message: `第 ${i + 1} 行单价不能为负数` });
          }

          if (row.lineType === "material") {
            if (!Number.isInteger(row.materialId) || row.materialId <= 0) {
              return reply.code(400).send({ message: `第 ${i + 1} 行请选择物料库条目` });
            }
            if (row.processingId) {
              return reply.code(400).send({ message: `第 ${i + 1} 行物料明细不能填写加工ID` });
            }
          } else {
            if (!Number.isInteger(row.processingId) || row.processingId <= 0) {
              return reply.code(400).send({ message: `第 ${i + 1} 行请选择加工库条目` });
            }
            if (row.materialId) {
              return reply.code(400).send({ message: `第 ${i + 1} 行加工明细不能填写物料ID` });
            }
          }
        }

        inboundPositiveLines = normalizedInboundLines.filter((line) => Number(line.quantity) > 0);
        inboundNegativeLines = normalizedInboundLines
          .filter((line) => Number(line.quantity) < 0)
          .map((line) => ({ ...line, quantity: Math.abs(Number(line.quantity)) }));

        const inboundTotal = computeInboundAmount(normalizedInboundLines);
        if (inboundTotal <= 0) {
          return reply.code(400).send({ message: `${payload.type === "in" ? "入库" : "采购退货"}明细金额必须大于0` });
        }
      }

      const createdTransactions = await app.prisma.$transaction(async (tx) => {
        const productMap = new Map();
        if (normalizedItems.length > 0) {
          const productIds = [...new Set(normalizedItems.map((row) => row.productId))];
          const products = await tx.product.findMany({
            where: { id: { in: productIds } }
          });

          for (const product of products) {
            productMap.set(product.id, product);
          }

          for (const productId of productIds) {
            const product = productMap.get(productId);
            if (!product) throw new Error(`产品不存在: ${productId}`);
            if (!product.active) throw new Error(`产品已停用，不能用于新单: ${product.name}`);
          }
        }
        const materialMap = new Map();
        const processingMap = new Map();
        if (normalizedInboundLines.length > 0) {
          const materialIds = [
            ...new Set(
              normalizedInboundLines.filter((line) => line.lineType === "material").map((line) => Number(line.materialId))
            )
          ];
          const processingIds = [
            ...new Set(
              normalizedInboundLines
                .filter((line) => line.lineType === "processing")
                .map((line) => Number(line.processingId))
            )
          ];

          if (materialIds.length > 0) {
            const materials = await tx.material.findMany({
              where: { id: { in: materialIds } }
            });
            for (const material of materials) materialMap.set(material.id, material);
            for (const materialId of materialIds) {
              const material = materialMap.get(materialId);
              if (!material) throw new Error(`物料不存在: ${materialId}`);
              if (!material.active) throw new Error(`物料已停用，不能用于新单: ${material.name}`);
            }
          }

          if (processingIds.length > 0) {
            const processings = await tx.processing.findMany({
              where: { id: { in: processingIds } }
            });
            for (const processing of processings) processingMap.set(processing.id, processing);
            for (const processingId of processingIds) {
              const processing = processingMap.get(processingId);
              if (!processing) throw new Error(`加工项不存在: ${processingId}`);
              if (!processing.active) throw new Error(`加工项已停用，不能用于新单: ${processing.name}`);
            }
          }
        }

        function buildInboundSnapshot(line) {
          if (line.lineType === "material") {
            const material = materialMap.get(Number(line.materialId));
            if (!material) throw new Error(`物料不存在: ${line.materialId}`);
            return {
              materialId: material.id,
              processingId: null,
              name: material.name,
              sku: material.code || null,
              spec: material.spec || null,
              unit: material.unit
            };
          }

          const processing = processingMap.get(Number(line.processingId));
          if (!processing) throw new Error(`加工项不存在: ${line.processingId}`);
          return {
            materialId: null,
            processingId: processing.id,
            name: processing.name,
            sku: processing.code || null,
            spec: processing.spec || null,
            unit: processing.unit
          };
        }

        async function createTransactionWithDetails({
          type,
          amount,
          computedAmount,
          items = [],
          inboundLines = [],
          sourceTransactionId = null,
          sourceRef = null,
          slipBook = null,
          slipNo = null
        }) {
          const transaction = await tx.transaction.create({
            data: {
              type,
              partnerId: payload.partnerId,
              transactionDate,
              bookkeepingDate,
              recordedAt: new Date(),
              recordedById: recorderUserId,
              amount,
              computedAmount,
              remark: payload.remark || null,
              sourceTransactionId,
              sourceRef,
              slipBook,
              slipNo
            }
          });

          for (const row of items) {
            const product = productMap.get(row.productId);
            const quantity = normalizeQuantity(Math.abs(Number(row.quantity)));
            if (quantity == null || quantity === 0) {
              throw new Error("产品明细数量无效");
            }
            const unitPrice = Number(row.unitPrice);
            const lineAmount = quantity * unitPrice;
            await tx.transactionItem.create({
              data: {
                transactionId: transaction.id,
                productId: row.productId,
                quantity,
                unitPrice,
                lineAmount,
                snapshotName: row.productSnapshot?.name || product.name,
                snapshotSku: row.productSnapshot?.sku || product.sku || null,
                snapshotSpec: row.productSnapshot?.spec || product.spec || null,
                snapshotUnit: row.productSnapshot?.unit || product.unit || null
              }
            });
          }

          if (needInboundLines(type) && inboundLines.length > 0) {
            for (const line of inboundLines) {
              const quantity = normalizeQuantity(Math.abs(Number(line.quantity)));
              if (quantity == null || quantity === 0) {
                throw new Error("入库明细数量无效");
              }
              const lineAmount = quantity * line.unitPrice;
              const snapshot = buildInboundSnapshot(line);
              await tx.inboundLine.create({
                data: {
                  transactionId: transaction.id,
                  materialId: snapshot.materialId,
                  processingId: snapshot.processingId,
                  lineType: line.lineType,
                  name: snapshot.name,
                  sku: snapshot.sku,
                  spec: snapshot.spec,
                  unit: snapshot.unit,
                  quantity,
                  unitPrice: line.unitPrice,
                  lineAmount
                }
              });
            }
          }

          return tx.transaction.findUnique({
            where: { id: transaction.id },
            include: {
              items: true,
              inboundBreakdown: true,
              inboundLines: true,
              recordedBy: {
                select: { username: true }
              }
            }
          });
        }

        const results = [];
        const hasOutNegativeItems = payload.type === "out" && outNegativeItems.length > 0;
        const hasInboundNegativeLines = needInboundLines(payload.type) && inboundNegativeLines.length > 0;

        if (hasOutNegativeItems) {
          if (outPositiveItems.length > 0) {
            const outAmount = computeItemAmount(outPositiveItems);
            const createdOut = await createTransactionWithDetails({
              type: "out",
              amount: outAmount,
              computedAmount: outAmount,
              items: outPositiveItems,
              sourceTransactionId: payload.sourceTransactionId || null,
              sourceRef: payload.sourceRef || null,
              slipBook: slipBook || null,
              slipNo: slipNo || null
            });
            results.push(createdOut);
          }

          const returnAmount = computeItemAmount(outNegativeItems);
          const createdReturn = await createTransactionWithDetails({
            type: "sale_return",
            amount: returnAmount,
            computedAmount: returnAmount,
            items: outNegativeItems,
            slipBook: slipBook || null,
            slipNo: slipNo || null
          });
          results.push(createdReturn);
          return results;
        }

        if (hasInboundNegativeLines) {
          const reverseType = payload.type === "in" ? "purchase_return" : "in";

          if (inboundPositiveLines.length > 0) {
            const baseAmount = computeInboundAmount(inboundPositiveLines);
            const createdBase = await createTransactionWithDetails({
              type: payload.type,
              amount: baseAmount,
              computedAmount: baseAmount,
              inboundLines: inboundPositiveLines,
              sourceTransactionId: payload.sourceTransactionId || null,
              sourceRef: payload.sourceRef || null,
              slipBook: slipBook || null,
              slipNo: slipNo || null
            });
            results.push(createdBase);
          }

          const reverseAmount = computeInboundAmount(inboundNegativeLines);
          const createdReverse = await createTransactionWithDetails({
            type: reverseType,
            amount: reverseAmount,
            computedAmount: reverseAmount,
            inboundLines: inboundNegativeLines,
            slipBook: slipBook || null,
            slipNo: slipNo || null
          });
          results.push(createdReverse);
          return results;
        }

        const singleCreated = await createTransactionWithDetails({
          type: payload.type,
          amount: payload.amount,
          computedAmount: payload.computedAmount ?? null,
          items: needProductItems(payload.type) ? normalizedItems : [],
          inboundLines: needInboundLines(payload.type) ? normalizedInboundLines : [],
          sourceTransactionId: payload.sourceTransactionId || null,
          sourceRef: payload.sourceRef || null,
          slipBook: slipBook || null,
          slipNo: slipNo || null
        });
        results.push(singleCreated);
        return results;
      });

      const mappedTransactions = createdTransactions.map(mapTransaction);
      const splitResult = {
        split: mappedTransactions.length > 1,
        autoConvertedTo:
          mappedTransactions.length === 1 && mappedTransactions[0].type !== payload.type
            ? mappedTransactions[0].type
            : null,
        createdTransactions: mappedTransactions.map((tx) => ({
          id: tx.id,
          type: tx.type,
          amount: tx.amount
        }))
      };

      return reply.code(201).send({
        warnings,
        data: mappedTransactions[0],
        splitResult
      });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.post("/transactions/undo-auto-split", { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const payload = undoAutoSplitSchema.parse(request.body || {});
      const uniqueIds = [...new Set(payload.transactionIds.map((id) => Number(id)))];

      if (uniqueIds.length !== payload.transactionIds.length) {
        return reply.code(400).send({ message: "transactionIds 不能重复" });
      }

      if (uniqueIds.length < 1 || uniqueIds.length > 2) {
        return reply.code(400).send({ message: "仅支持撤销 1 条或 2 条自动拆单交易" });
      }

      const transactions = await app.prisma.transaction.findMany({
        where: {
          id: { in: uniqueIds }
        },
        select: {
          id: true,
          type: true,
          partnerId: true,
          transactionDate: true,
          bookkeepingDate: true,
          recordedAt: true
        }
      });

      if (transactions.length !== uniqueIds.length) {
        return reply.code(404).send({ message: "存在交易记录不存在或已被删除" });
      }

      const now = Date.now();
      const recordTimes = transactions.map((row) => new Date(row.recordedAt).getTime());
      for (let i = 0; i < transactions.length; i += 1) {
        if (now - recordTimes[i] > AUTO_SPLIT_UNDO_WINDOW_MS) {
          return reply.code(409).send({ message: "已超过可撤销时间窗口（10分钟）" });
        }
      }

      if (transactions.length === 1) {
        if (!["sale_return", "purchase_return", "in"].includes(transactions[0].type)) {
          return reply.code(409).send({ message: "单笔撤销仅支持自动转单场景（销售退货/采购退货/入库）" });
        }
      }

      if (transactions.length === 2) {
        const typeSet = new Set(transactions.map((row) => row.type));
        const isOutSplit = typeSet.has("out") && typeSet.has("sale_return");
        const isInboundSplit = typeSet.has("in") && typeSet.has("purchase_return");
        if (!isOutSplit && !isInboundSplit) {
          return reply.code(409).send({ message: "双笔撤销仅支持“出库+销售退货”或“入库+采购退货”组合" });
        }

        const partnerSet = new Set(transactions.map((row) => row.partnerId));
        if (partnerSet.size !== 1) {
          return reply.code(409).send({ message: "两条交易对象不一致，无法按自动拆单撤销" });
        }

        const txDateSet = new Set(transactions.map((row) => dateKey(row.transactionDate)));
        if (txDateSet.size !== 1) {
          return reply.code(409).send({ message: "两条交易业务日期不一致，无法按自动拆单撤销" });
        }

        const bookDateSet = new Set(transactions.map((row) => dateKey(row.bookkeepingDate)));
        if (bookDateSet.size !== 1) {
          return reply.code(409).send({ message: "两条交易记账日期不一致，无法按自动拆单撤销" });
        }

        const minRecordedAt = Math.min(...recordTimes);
        const maxRecordedAt = Math.max(...recordTimes);
        if (maxRecordedAt - minRecordedAt > AUTO_SPLIT_GROUP_MAX_SPAN_MS) {
          return reply.code(409).send({ message: "两条交易生成时间差过大，无法按自动拆单撤销" });
        }
      }

      const deletedIds = [...uniqueIds];
      const deleted = await app.prisma.$transaction(async (tx) => {
        const result = await tx.transaction.deleteMany({
          where: { id: { in: deletedIds } }
        });
        return result.count;
      });

      if (deleted !== deletedIds.length) {
        return reply.code(409).send({ message: "撤销失败：部分交易已变更，请刷新后重试" });
      }

      return {
        data: {
          deletedTransactionIds: deletedIds
        }
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });

  app.delete("/transactions/:id", { preHandler: [authGuard] }, async (request, reply) => {
    const transactionId = Number(request.params.id);
    if (!transactionId) return reply.code(400).send({ message: "交易ID无效" });

    const existing = await app.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { id: true }
    });
    if (!existing) return reply.code(404).send({ message: "交易不存在" });

    await app.prisma.transaction.delete({
      where: { id: transactionId }
    });

    return {
      data: {
        deletedTransactionId: transactionId
      }
    };
  });

  app.patch("/transactions/:id/slip", { preHandler: [authGuard] }, async (request, reply) => {
    const transactionId = Number(request.params.id);
    if (!transactionId) return reply.code(400).send({ message: "交易ID无效" });

    try {
      const payload = updateSlipSchema.parse(request.body || {});
      const force = payload.force === true;
      const slipBook = normalizeSlipBook(payload.slipBook);
      const slipNo = payload.slipNo || null;
      const operatorUserId = Number(request.authUser?.id || 0);

      const transaction = await app.prisma.transaction.findUnique({
        where: { id: transactionId },
        select: { id: true, type: true }
      });

      if (!transaction) return reply.code(404).send({ message: "交易不存在" });
      if (!needSlip(transaction.type))
        return reply.code(400).send({ message: "仅出库/入库/销售退货/采购退货支持补填或修改单号" });

      if ((slipBook && !slipNo) || (!slipBook && slipNo)) {
        return reply.code(400).send({ message: "单据簿号和单据号需要同时填写" });
      }

      const warnings = [];
      if (slipBook && slipNo) {
        const sequenceTypes = slipSequenceTypes(transaction.type);
        const maxRow = await app.prisma.transaction.aggregate({
          _max: { slipNo: true },
          where: {
            type: { in: sequenceTypes },
            slipBook: slipBook,
            id: { not: transaction.id }
          }
        });
        const maxUsedNo = maxRow._max.slipNo || 0;
        const nextNo = maxUsedNo > 0 ? maxUsedNo + 1 : 1;
        if (slipNo !== nextNo) {
          warnings.push(`当前簿号建议下一号为 ${nextNo}，本次为 ${slipNo}`);
        }

        const duplicate = await app.prisma.transaction.findFirst({
          where: {
            type: { in: sequenceTypes },
            slipBook: slipBook,
            slipNo: slipNo,
            id: { not: transaction.id }
          },
          select: {
            id: true,
            recordedById: true,
            recordedBy: {
              select: { username: true }
            }
          }
        });
        if (duplicate) {
          warnings.push(buildSlipDuplicateWarningText(slipBook, slipNo, duplicate, operatorUserId));
        }
      }

      if (warnings.length > 0 && !force) {
        return reply.code(409).send({
          message: "存在风险提示，需要确认后继续",
          warnings
        });
      }

      const updated = await app.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          slipBook: slipBook || null,
          slipNo: slipNo || null
        },
        include: {
          items: true,
          inboundBreakdown: true,
          inboundLines: true,
          recordedBy: {
            select: { username: true }
          }
        }
      });

      return {
        warnings,
        data: mapTransaction(updated)
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });
}
