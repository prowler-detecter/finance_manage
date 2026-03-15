import { Prisma } from "@prisma/client";
import { getTimeMs, toISODateString } from "../utils/date.js";

const STOCK_INCREASE_TYPES = new Set(["in", "sale_return"]);
const STOCK_DECREASE_TYPES = new Set(["out", "purchase_return"]);

function getTransactionDelta(type, quantity) {
  if (STOCK_INCREASE_TYPES.has(type)) return quantity;
  if (STOCK_DECREASE_TYPES.has(type)) return -quantity;
  return 0;
}

function eventTypeLabel(event) {
  if (event.eventType === "tx") {
    if (event.transactionType === "in") return "入库";
    if (event.transactionType === "out") return "出库";
    if (event.transactionType === "sale_return") return "销售退货";
    if (event.transactionType === "purchase_return") return "采购退货";
    return "交易";
  }
  if (event.eventType === "adjust-set") return "盘点覆写";
  if (event.eventType === "adjust-delta") return "增减调整";
  return "未知";
}

function compareEvents(a, b) {
  if (a.businessDate !== b.businessDate) return a.businessDate < b.businessDate ? -1 : 1;
  const aMs = getTimeMs(a.recordedAt);
  const bMs = getTimeMs(b.recordedAt);
  if (aMs !== bMs) return aMs - bMs;
  if (a.sortId !== b.sortId) return a.sortId - b.sortId;
  return String(a.eventType).localeCompare(String(b.eventType));
}

export function buildStockEvents(productId, transactions, adjustments) {
  const events = [];

  for (const transaction of transactions) {
    for (const item of transaction.items) {
      if (item.productId !== productId) continue;
      const delta = getTransactionDelta(transaction.type, item.quantity);
      if (!delta) continue;
      events.push({
        eventType: "tx",
        transactionType: transaction.type,
        businessDate: toISODateString(transaction.transactionDate),
        recordedAt: transaction.recordedAt,
        sortId: transaction.id,
        delta
      });
    }
  }

  for (const adjustment of adjustments) {
    if (adjustment.productId !== productId) continue;
    if (adjustment.mode === "set") {
      events.push({
        eventType: "adjust-set",
        businessDate: toISODateString(adjustment.bizDate),
        recordedAt: adjustment.recordedAt,
        sortId: adjustment.id,
        setQty: adjustment.afterQty
      });
      continue;
    }
    events.push({
      eventType: "adjust-delta",
      businessDate: toISODateString(adjustment.bizDate),
      recordedAt: adjustment.recordedAt,
      sortId: adjustment.id,
      delta: adjustment.changeQty
    });
  }

  return events.sort(compareEvents);
}

export function computeStock(events, marker = null) {
  let stock = 0;
  let markerBefore = null;
  let markerAfter = null;

  for (const event of events) {
    if (marker && event.markerKey === marker) markerBefore = stock;
    if (event.eventType === "adjust-set") {
      stock = event.setQty;
    } else {
      stock += event.delta || 0;
    }
    if (marker && event.markerKey === marker) markerAfter = stock;
  }

  return { stock, markerBefore, markerAfter };
}

export function summarizeBasis(events) {
  if (events.length === 0) {
    return {
      latestBusinessDate: null,
      latestBusinessType: null,
      latestRecordedAt: null,
      basisSummary: "暂无库存事件"
    };
  }

  const latest = events[events.length - 1];
  let anchorIndex = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].eventType === "adjust-set") {
      anchorIndex = i;
      break;
    }
  }

  let basisSummary = "";
  if (anchorIndex < 0) {
    basisSummary = `无盘点基准，按全部业务累计（事件 ${events.length} 条）`;
  } else {
    const anchor = events[anchorIndex];
    basisSummary = `盘点基准 ${anchor.businessDate} 设为 ${anchor.setQty}，其后事件 ${events.length - anchorIndex - 1} 条`;
  }

  return {
    latestBusinessDate: latest.businessDate,
    latestBusinessType: eventTypeLabel(latest),
    latestRecordedAt: latest.recordedAt,
    basisSummary
  };
}

export async function loadStockData(prisma) {
  const [products, transactions, adjustments] = await Promise.all([
    prisma.product.findMany({
      orderBy: { id: "asc" }
    }),
    prisma.transaction.findMany({
      include: {
        items: true
      }
    }),
    prisma.stockAdjustment.findMany()
  ]);

  return { products, transactions, adjustments };
}

export function toNumberValue(decimal) {
  if (decimal instanceof Prisma.Decimal) {
    return Number(decimal.toString());
  }
  return Number(decimal || 0);
}
