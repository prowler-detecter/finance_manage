import { z } from "zod";
import { authGuard } from "../plugins/auth.js";
import { parseISODateOrThrow } from "../utils/date.js";
import { buildStockEvents, computeStock, loadStockData, summarizeBasis, toNumberValue } from "../services/inventory.js";

const createAdjustmentSchema = z.object({
  productId: z.number().int().positive(),
  mode: z.enum(["set", "delta"]),
  quantity: z.number().int(),
  bizDate: z.string().min(1),
  remark: z.string().optional().nullable()
});

function withPendingAdjustment(events, pending) {
  const marker = `pending-${Date.now()}-${Math.random()}`;
  const event = {
    markerKey: marker,
    eventType: pending.mode === "set" ? "adjust-set" : "adjust-delta",
    businessDate: pending.bizDate,
    recordedAt: pending.recordedAt,
    sortId: pending.sortId,
    setQty: pending.mode === "set" ? pending.quantity : undefined,
    delta: pending.mode === "delta" ? pending.quantity : undefined
  };
  const merged = events.concat(event).sort((a, b) => {
    if (a.businessDate !== b.businessDate) return a.businessDate < b.businessDate ? -1 : 1;
    const aMs = new Date(a.recordedAt).getTime();
    const bMs = new Date(b.recordedAt).getTime();
    if (aMs !== bMs) return aMs - bMs;
    if (a.sortId !== b.sortId) return a.sortId - b.sortId;
    return String(a.eventType).localeCompare(String(b.eventType));
  });
  return { marker, merged };
}

export async function inventoryRoutes(app) {
  app.get("/inventory/overview", { preHandler: [authGuard] }, async () => {
    const { products, transactions, adjustments } = await loadStockData(app.prisma);

    const data = products.map((product) => {
      const events = buildStockEvents(product.id, transactions, adjustments);
      const result = computeStock(events);
      const summary = summarizeBasis(events);

      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        spec: product.spec,
        unit: product.unit,
        defaultUnitPrice: toNumberValue(product.defaultUnitPrice),
        stock: result.stock,
        latestBusinessDate: summary.latestBusinessDate,
        latestBusinessType: summary.latestBusinessType,
        basisSummary: summary.basisSummary
      };
    });

    return { data };
  });

  app.post("/stock-adjustments", { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const payload = createAdjustmentSchema.parse(request.body || {});
      const bizDate = parseISODateOrThrow(payload.bizDate, "bizDate");

      if (payload.mode === "set" && payload.quantity < 0) {
        return reply.code(400).send({ message: "盘点数量不能为负数" });
      }
      if (payload.mode === "delta" && payload.quantity === 0) {
        return reply.code(400).send({ message: "增减数量不能为0" });
      }

      const product = await app.prisma.product.findUnique({
        where: { id: payload.productId }
      });
      if (!product) return reply.code(404).send({ message: "产品不存在" });

      const { transactions, adjustments } = await loadStockData(app.prisma);
      const events = buildStockEvents(payload.productId, transactions, adjustments);
      const pending = {
        mode: payload.mode,
        quantity: payload.quantity,
        bizDate: payload.bizDate,
        recordedAt: new Date().toISOString(),
        sortId: Date.now()
      };
      const { marker, merged } = withPendingAdjustment(events, pending);
      const preview = computeStock(merged, marker);

      if (preview.markerBefore == null || preview.markerAfter == null) {
        return reply.code(500).send({ message: "库存预演失败" });
      }

      const changeQty = preview.markerAfter - preview.markerBefore;
      if (changeQty === 0) {
        return reply.code(400).send({ message: "库存无变化，无需保存" });
      }

      const created = await app.prisma.stockAdjustment.create({
        data: {
          productId: payload.productId,
          mode: payload.mode,
          bizDate,
          recordedAt: new Date(),
          beforeQty: preview.markerBefore,
          afterQty: preview.markerAfter,
          changeQty,
          remark: payload.remark || null
        }
      });

      return reply.code(201).send({ data: created });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "参数错误"
      });
    }
  });
}
