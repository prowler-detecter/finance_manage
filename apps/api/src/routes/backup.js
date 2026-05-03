import crypto from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { authGuard } from "../plugins/auth.js";

const BACKUP_SCHEMA_VERSION = 2;
const APP_VERSION = process.env.APP_VERSION || "1.0.0";
const SOURCE_INSTANCE_ID =
  process.env.SOURCE_INSTANCE_ID ||
  crypto.createHash("sha1").update(config.databaseUrl).digest("hex").slice(0, 12);

const ALL_DATA_KEYS = [
  "users",
  "partners",
  "products",
  "materials",
  "processings",
  "transactions",
  "transactionItems",
  "inboundLines",
  "inboundBreakdowns",
  "stockAdjustments",
  "materialStockAdjustments"
];

const ACCOUNT_KEYS = ["users"];
const BUSINESS_KEYS = ALL_DATA_KEYS.filter((key) => !ACCOUNT_KEYS.includes(key));
const SCOPE_KEYS = {
  system: ALL_DATA_KEYS,
  business: BUSINESS_KEYS,
  accounts: ACCOUNT_KEYS
};

const scopeSchema = z.enum(["system", "business", "accounts"]);
const strategySchema = z.enum(["replace", "empty_only", "merge"]);
const conflictSchema = z.enum(["skip", "overwrite"]);

const previewSchema = z.object({
  backup: z.unknown(),
  scope: scopeSchema,
  strategy: strategySchema
});

const restoreSchema = z.object({
  backup: z.unknown(),
  scope: scopeSchema,
  strategy: strategySchema,
  onConflict: conflictSchema.optional().default("skip")
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortById(rows) {
  return [...rows].sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function normalizeText(value) {
  return value == null ? null : String(value);
}

function normalizeDate(value, fallback = new Date()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function dateOnly(value) {
  return normalizeDate(value).toISOString().slice(0, 10);
}

function scopeKeys(scope) {
  return SCOPE_KEYS[scope] || [];
}

function ensureScopePermission(request, scope) {
  const role = request.authUser?.role || request.user?.role || "user";
  if (!["admin", "super_admin"].includes(role)) {
    const error = new Error("普通用户无备份与恢复权限");
    error.statusCode = 403;
    throw error;
  }
}

function jsonSafe(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item));
  if (isObject(value)) {
    if (typeof value.toNumber === "function") return toNumber(value.toNumber(), 0);
    if (value.constructor?.name === "Decimal" && typeof value.toString === "function") {
      return toNumber(value.toString(), 0);
    }
    const obj = {};
    for (const [key, inner] of Object.entries(value)) obj[key] = jsonSafe(inner);
    return obj;
  }
  return value;
}

function normalizeEnvelope(input) {
  if (!isObject(input)) throw new Error("备份文件格式无效：根节点必须是对象");
  const metaRaw = isObject(input.meta) ? input.meta : {};
  const dataRaw = isObject(input.data) ? input.data : input;
  const data = {};
  for (const key of ALL_DATA_KEYS) data[key] = Array.isArray(dataRaw[key]) ? dataRaw[key] : [];
  const schemaVersion = Number(metaRaw.schemaVersion || 1);
  if (!Number.isFinite(schemaVersion) || schemaVersion <= 0) throw new Error("备份文件 schemaVersion 无效");
  if (schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error(`备份文件版本过高（${schemaVersion}），当前仅支持到 ${BACKUP_SCHEMA_VERSION}`);
  }
  return {
    meta: {
      schemaVersion,
      exportedAt: metaRaw.exportedAt || null,
      scope: ["system", "business", "accounts"].includes(metaRaw.scope) ? metaRaw.scope : "business",
      appVersion: metaRaw.appVersion || null,
      sourceInstanceId: metaRaw.sourceInstanceId || null
    },
    data
  };
}

function dataByScope(data, scope) {
  const keys = scopeKeys(scope);
  const picked = {};
  for (const key of ALL_DATA_KEYS) picked[key] = keys.includes(key) ? data[key] : [];
  return picked;
}

async function loadScopeData(prisma, scope) {
  const keys = scopeKeys(scope);
  const out = {};
  const jobs = [];
  const push = (key, fn) => {
    if (!keys.includes(key)) return;
    jobs.push(
      fn().then((rows) => {
        out[key] = rows;
      })
    );
  };

  push("users", () => prisma.user.findMany({ orderBy: { id: "asc" } }));
  push("partners", () => prisma.partner.findMany({ orderBy: { id: "asc" } }));
  push("products", () => prisma.product.findMany({ orderBy: { id: "asc" } }));
  push("materials", () => prisma.material.findMany({ orderBy: { id: "asc" } }));
  push("processings", () => prisma.processing.findMany({ orderBy: { id: "asc" } }));
  push("transactions", () => prisma.transaction.findMany({ orderBy: { id: "asc" } }));
  push("transactionItems", () => prisma.transactionItem.findMany({ orderBy: { id: "asc" } }));
  push("inboundLines", () => prisma.inboundLine.findMany({ orderBy: { id: "asc" } }));
  push("inboundBreakdowns", () => prisma.inboundBreakdown.findMany({ orderBy: { id: "asc" } }));
  push("stockAdjustments", () => prisma.stockAdjustment.findMany({ orderBy: { id: "asc" } }));
  push("materialStockAdjustments", () => prisma.materialStockAdjustment.findMany({ orderBy: { id: "asc" } }));

  await Promise.all(jobs);
  for (const key of ALL_DATA_KEYS) if (!Array.isArray(out[key])) out[key] = [];
  return out;
}

async function loadScopeCounts(prisma, scope) {
  const keys = scopeKeys(scope);
  const out = {};
  const jobs = [];
  const push = (key, fn) => {
    if (!keys.includes(key)) return;
    jobs.push(
      fn().then((count) => {
        out[key] = Number(count || 0);
      })
    );
  };

  push("users", () => prisma.user.count());
  push("partners", () => prisma.partner.count());
  push("products", () => prisma.product.count());
  push("materials", () => prisma.material.count());
  push("processings", () => prisma.processing.count());
  push("transactions", () => prisma.transaction.count());
  push("transactionItems", () => prisma.transactionItem.count());
  push("inboundLines", () => prisma.inboundLine.count());
  push("inboundBreakdowns", () => prisma.inboundBreakdown.count());
  push("stockAdjustments", () => prisma.stockAdjustment.count());
  push("materialStockAdjustments", () => prisma.materialStockAdjustment.count());
  await Promise.all(jobs);
  return out;
}

function partnerKey(row) {
  return `${row?.type === "supplier" ? "supplier" : "customer"}|${normalizeText(row?.name) || ""}`;
}

function productKey(row) {
  const sku = normalizeText(row?.sku);
  if (sku) return `sku:${sku.toLowerCase()}`;
  return `ns:${normalizeText(row?.name) || ""}|${normalizeText(row?.spec) || ""}`;
}

function materialKey(row) {
  const code = normalizeText(row?.code);
  if (code) return `code:${code.toLowerCase()}`;
  return `nsu:${normalizeText(row?.name) || ""}|${normalizeText(row?.spec) || ""}|${normalizeText(row?.unit) || ""}`;
}

function processingKey(row) {
  const code = normalizeText(row?.code);
  if (code) return `code:${code.toLowerCase()}`;
  return `nsu:${normalizeText(row?.name) || ""}|${normalizeText(row?.spec) || ""}|${normalizeText(row?.unit) || ""}`;
}

function userKey(row) {
  return String(row?.username || "");
}

function mapByUnique(rows, keyBuilder) {
  const map = new Map();
  for (const row of rows || []) {
    const key = keyBuilder(row);
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
}

function buildDetailMaps(data) {
  const itemsByTx = new Map();
  const linesByTx = new Map();
  for (const row of data.transactionItems || []) {
    const txId = Number(row.transactionId);
    if (!txId) continue;
    if (!itemsByTx.has(txId)) itemsByTx.set(txId, []);
    itemsByTx.get(txId).push(row);
  }
  for (const row of data.inboundLines || []) {
    const txId = Number(row.transactionId);
    if (!txId) continue;
    if (!linesByTx.has(txId)) linesByTx.set(txId, []);
    linesByTx.get(txId).push(row);
  }
  return { itemsByTx, linesByTx };
}

function slipDedupKey(tx) {
  const book = String(tx?.slipBook || "").trim();
  const no = Number(tx?.slipNo);
  if (!book || !Number.isFinite(no) || no <= 0) return null;
  return `${tx.type}|${Number(tx.partnerId || 0)}|${book}|${no}`;
}

function fingerprintTx(tx, items, lines) {
  const normalizedItems = (items || [])
    .map((row) => ({
      productId: Number(row.productId || 0),
      snapshot: `${row.snapshotName || ""}|${row.snapshotSku || ""}|${row.snapshotSpec || ""}|${row.snapshotUnit || ""}`,
      quantity: toNumber(row.quantity),
      unitPrice: toNumber(row.unitPrice)
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  const normalizedLines = (lines || [])
    .map((row) => ({
      lineType: row.lineType === "processing" ? "processing" : "material",
      materialId: Number(row.materialId || 0),
      processingId: Number(row.processingId || 0),
      snapshot: `${row.name || ""}|${row.sku || ""}|${row.spec || ""}|${row.unit || ""}`,
      quantity: toNumber(row.quantity),
      unitPrice: toNumber(row.unitPrice)
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  const payload = {
    type: tx.type,
    partnerId: Number(tx.partnerId || 0),
    transactionDate: dateOnly(tx.transactionDate),
    bookkeepingDate: dateOnly(tx.bookkeepingDate),
    amount: toNumber(tx.amount),
    remark: tx.remark || null,
    sourceRef: tx.sourceRef || null,
    items: normalizedItems,
    lines: normalizedLines
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function summarizeMergePreview(scopedData, existingData, scope) {
  const entities = {};
  for (const key of scopeKeys(scope)) {
    entities[key] = {
      total: scopedData[key]?.length || 0,
      canCreate: 0,
      conflicts: 0
    };
  }
  const conflicts = [];

  function countEntity(entity, keyBuilder) {
    if (!entities[entity]) return;
    const existingMap = mapByUnique(existingData[entity] || [], keyBuilder);
    for (const row of scopedData[entity] || []) {
      const key = keyBuilder(row);
      if (key && existingMap.has(key)) {
        entities[entity].conflicts += 1;
      } else {
        entities[entity].canCreate += 1;
        if (key) existingMap.set(key, row);
      }
    }
  }

  countEntity("users", userKey);
  countEntity("partners", partnerKey);
  countEntity("products", productKey);
  countEntity("materials", materialKey);
  countEntity("processings", processingKey);

  if (entities.transactions) {
    const existingDetails = buildDetailMaps(existingData);
    const importDetails = buildDetailMaps(scopedData);
    const slipSet = new Set();
    const fpSet = new Set();

    for (const tx of existingData.transactions || []) {
      const txId = Number(tx.id);
      const slipKey = slipDedupKey(tx);
      if (slipKey) slipSet.add(slipKey);
      fpSet.add(fingerprintTx(tx, existingDetails.itemsByTx.get(txId) || [], existingDetails.linesByTx.get(txId) || []));
    }

    for (const tx of sortById(scopedData.transactions || [])) {
      const txId = Number(tx.id);
      const slipKey = slipDedupKey(tx);
      const fp = fingerprintTx(tx, importDetails.itemsByTx.get(txId) || [], importDetails.linesByTx.get(txId) || []);
      const conflict = (slipKey && slipSet.has(slipKey)) || fpSet.has(fp);
      if (conflict) {
        entities.transactions.conflicts += 1;
        conflicts.push({
          entity: "transactions",
          ref: txId || null,
          reason: slipKey && slipSet.has(slipKey) ? "单号重复" : "内容指纹重复"
        });
      } else {
        entities.transactions.canCreate += 1;
        if (slipKey) slipSet.add(slipKey);
        fpSet.add(fp);
      }
    }
  }

  return { entities, conflicts: conflicts.slice(0, 30) };
}

async function ensureScopeEmpty(prisma, scope) {
  const counts = await loadScopeCounts(prisma, scope);
  const nonEmpty = Object.entries(counts).filter(([, count]) => Number(count || 0) > 0);
  return { isEmpty: nonEmpty.length === 0, counts };
}

async function clearScope(tx, scope) {
  const includeBusiness = scope === "system" || scope === "business";
  const includeAccounts = scope === "system" || scope === "accounts";

  if (includeBusiness) {
    await tx.materialStockAdjustment.deleteMany();
    await tx.stockAdjustment.deleteMany();
    await tx.inboundBreakdown.deleteMany();
    await tx.inboundLine.deleteMany();
    await tx.transactionItem.deleteMany();
    await tx.transaction.deleteMany();
    await tx.processing.deleteMany();
    await tx.material.deleteMany();
    await tx.product.deleteMany();
    await tx.partner.deleteMany();
  }
  if (includeAccounts) {
    await tx.user.deleteMany();
  }
}

function mapUserRow(row, keepId = false) {
  const role = row.role === "super_admin" ? "super_admin" : row.role === "admin" ? "admin" : "user";
  return {
    ...(keepId ? { id: Number(row.id) } : {}),
    username: String(row.username || "").trim(),
    passwordHash: String(row.passwordHash || ""),
    role
  };
}

function mapPartnerRow(row, keepId = false) {
  return {
    ...(keepId ? { id: Number(row.id) } : {}),
    name: String(row.name || "").trim(),
    type: row.type === "supplier" ? "supplier" : "customer",
    contactName: normalizeText(row.contactName),
    phone: normalizeText(row.phone),
    address: normalizeText(row.address),
    profileRemark: normalizeText(row.profileRemark)
  };
}

function mapProductRow(row, keepId = false) {
  return {
    ...(keepId ? { id: Number(row.id) } : {}),
    name: String(row.name || "").trim(),
    sku: normalizeText(row.sku),
    spec: normalizeText(row.spec),
    unit: String(row.unit || "").trim(),
    defaultUnitPrice: toNumber(row.defaultUnitPrice, 0),
    active: row.active !== false
  };
}

function mapMaterialRow(row, keepId = false) {
  return {
    ...(keepId ? { id: Number(row.id) } : {}),
    name: String(row.name || "").trim(),
    code: normalizeText(row.code),
    spec: normalizeText(row.spec),
    unit: String(row.unit || "").trim(),
    defaultUnitPrice: toNumber(row.defaultUnitPrice, 0),
    active: row.active !== false
  };
}

function mapProcessingRow(row, keepId = false) {
  return {
    ...(keepId ? { id: Number(row.id) } : {}),
    name: String(row.name || "").trim(),
    code: normalizeText(row.code),
    spec: normalizeText(row.spec),
    unit: String(row.unit || "").trim(),
    defaultUnitPrice: toNumber(row.defaultUnitPrice, 0),
    active: row.active !== false
  };
}

function mapTransactionRow(row, partnerId, sourceTransactionId, keepId = false) {
  return {
    ...(keepId ? { id: Number(row.id) } : {}),
    type: row.type,
    partnerId,
    transactionDate: normalizeDate(row.transactionDate),
    bookkeepingDate: normalizeDate(row.bookkeepingDate),
    recordedAt: normalizeDate(row.recordedAt),
    amount: toNumber(row.amount, 0),
    computedAmount: row.computedAmount == null ? null : toNumber(row.computedAmount, 0),
    remark: normalizeText(row.remark),
    sourceTransactionId: sourceTransactionId || null,
    sourceRef: normalizeText(row.sourceRef),
    slipBook: normalizeText(row.slipBook),
    slipNo: row.slipNo == null ? null : toInt(row.slipNo, 0) || null
  };
}

function mapTransactionItemRow(row, transactionId, productId, keepId = false) {
  return {
    ...(keepId ? { id: Number(row.id) } : {}),
    transactionId,
    productId,
    quantity: toNumber(row.quantity, 0),
    unitPrice: toNumber(row.unitPrice, 0),
    lineAmount: toNumber(row.lineAmount, 0),
    snapshotName: String(row.snapshotName || ""),
    snapshotSku: normalizeText(row.snapshotSku),
    snapshotSpec: normalizeText(row.snapshotSpec),
    snapshotUnit: normalizeText(row.snapshotUnit)
  };
}

function mapInboundLineRow(row, transactionId, materialId, processingId, keepId = false) {
  return {
    ...(keepId ? { id: Number(row.id) } : {}),
    transactionId,
    materialId: materialId || null,
    processingId: processingId || null,
    lineType: row.lineType === "processing" ? "processing" : "material",
    name: String(row.name || ""),
    sku: normalizeText(row.sku),
    spec: normalizeText(row.spec),
    unit: String(row.unit || ""),
    quantity: toNumber(row.quantity, 0),
    unitPrice: toNumber(row.unitPrice, 0),
    lineAmount: toNumber(row.lineAmount, 0)
  };
}

function mapInboundBreakdownRow(row, transactionId, keepId = false) {
  return {
    ...(keepId ? { id: Number(row.id) } : {}),
    transactionId,
    materialAmount: toNumber(row.materialAmount, 0),
    processingAmount: toNumber(row.processingAmount, 0),
    materialNote: normalizeText(row.materialNote),
    processingNote: normalizeText(row.processingNote)
  };
}

function mapStockAdjustmentRow(row, productId, keepId = false) {
  return {
    ...(keepId ? { id: Number(row.id) } : {}),
    productId,
    mode: row.mode === "set" ? "set" : "delta",
    changeQty: toNumber(row.changeQty, 0),
    beforeQty: toNumber(row.beforeQty, 0),
    afterQty: toNumber(row.afterQty, 0),
    bizDate: normalizeDate(row.bizDate),
    remark: normalizeText(row.remark),
    recordedAt: normalizeDate(row.recordedAt),
    operator: normalizeText(row.operator)
  };
}

function mapMaterialAdjustmentRow(row, materialId, keepId = false) {
  return {
    ...(keepId ? { id: Number(row.id) } : {}),
    materialId,
    mode: row.mode === "set" ? "set" : "delta",
    changeQty: toInt(row.changeQty, 0),
    beforeQty: toInt(row.beforeQty, 0),
    afterQty: toInt(row.afterQty, 0),
    bizDate: normalizeDate(row.bizDate),
    remark: normalizeText(row.remark),
    recordedAt: normalizeDate(row.recordedAt),
    operator: normalizeText(row.operator)
  };
}

export async function backupRoutes(app) {
  app.get("/backup/json", { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const query = z.object({ scope: scopeSchema.default("business") }).parse(request.query || {});
      ensureScopePermission(request, query.scope);
      const scopeData = await loadScopeData(app.prisma, query.scope);
      const payload = {
        meta: {
          schemaVersion: BACKUP_SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
          scope: query.scope,
          appVersion: APP_VERSION,
          sourceInstanceId: SOURCE_INSTANCE_ID
        },
        data: jsonSafe(scopeData)
      };
      return { data: payload };
    } catch (error) {
      return reply.code(error?.statusCode || 400).send({
        message: error instanceof Error ? error.message : "备份导出失败"
      });
    }
  });

  app.post("/backup/json/preview", { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const payload = previewSchema.parse(request.body || {});
      ensureScopePermission(request, payload.scope);
      const envelope = normalizeEnvelope(payload.backup);
      const scopedData = dataByScope(envelope.data, payload.scope);
      const incomingCounts = {};
      for (const key of scopeKeys(payload.scope)) incomingCounts[key] = scopedData[key]?.length || 0;
      const existingCounts = await loadScopeCounts(app.prisma, payload.scope);

      if (payload.strategy === "replace") {
        return {
          data: {
            scope: payload.scope,
            strategy: payload.strategy,
            canExecute: true,
            meta: envelope.meta,
            incomingCounts,
            existingCounts
          }
        };
      }

      if (payload.strategy === "empty_only") {
        const canExecute = Object.values(existingCounts).every((count) => Number(count || 0) === 0);
        return {
          data: {
            scope: payload.scope,
            strategy: payload.strategy,
            canExecute,
            meta: envelope.meta,
            incomingCounts,
            existingCounts,
            warnings: canExecute ? [] : ["目标作用域非空，不允许执行仅空库导入"]
          }
        };
      }

      const existingData = await loadScopeData(app.prisma, payload.scope);
      const mergePreview = summarizeMergePreview(scopedData, existingData, payload.scope);
      return {
        data: {
          scope: payload.scope,
          strategy: payload.strategy,
          canExecute: true,
          meta: envelope.meta,
          incomingCounts,
          existingCounts,
          preview: mergePreview
        }
      };
    } catch (error) {
      return reply.code(error?.statusCode || 400).send({
        message: error instanceof Error ? error.message : "导入预检查失败"
      });
    }
  });

  app.post("/backup/json/restore", { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const payload = restoreSchema.parse(request.body || {});
      ensureScopePermission(request, payload.scope);
      const envelope = normalizeEnvelope(payload.backup);
      const scopedData = dataByScope(envelope.data, payload.scope);

      if (payload.strategy === "empty_only") {
        const emptyCheck = await ensureScopeEmpty(app.prisma, payload.scope);
        if (!emptyCheck.isEmpty) {
          return reply.code(409).send({
            message: "目标作用域非空，无法执行仅空库导入",
            data: { counts: emptyCheck.counts }
          });
        }
      }

      const report = {
        scope: payload.scope,
        strategy: payload.strategy,
        onConflict: payload.onConflict,
        summary: { created: 0, overwritten: 0, skipped: 0, failed: 0 },
        entities: {},
        conflicts: [],
        failures: []
      };
      for (const key of scopeKeys(payload.scope)) {
        report.entities[key] = {
          total: scopedData[key]?.length || 0,
          created: 0,
          overwritten: 0,
          skipped: 0,
          conflicts: 0,
          failed: 0
        };
      }

      const touch = (entity, field) => {
        if (!report.entities[entity]) return;
        report.entities[entity][field] += 1;
        if (["created", "overwritten", "skipped", "failed"].includes(field)) {
          report.summary[field] += 1;
        }
      };

      await app.prisma.$transaction(async (tx) => {
        const includeBusiness = payload.scope === "system" || payload.scope === "business";
        const includeAccounts = payload.scope === "system" || payload.scope === "accounts";

        if (payload.strategy === "replace") {
          await clearScope(tx, payload.scope);
        }

        if (includeAccounts) {
          const existingUsers = payload.strategy === "replace" ? [] : await tx.user.findMany({ orderBy: { id: "asc" } });
          const userMap = mapByUnique(existingUsers, userKey);
          for (const row of sortById(scopedData.users || [])) {
            if (!row?.username || !row?.passwordHash) {
              touch("users", "failed");
              report.failures.push({ entity: "users", ref: row?.id || null, reason: "账号字段不完整" });
              continue;
            }
            const key = userKey(row);
            const existing = userMap.get(key);
            if (existing) {
              touch("users", "conflicts");
              report.conflicts.push({ entity: "users", ref: row.username, reason: "用户名重复" });
              if (payload.strategy === "replace" || payload.onConflict === "overwrite") {
                await tx.user.update({
                  where: { id: existing.id },
                  data: {
                    passwordHash: String(row.passwordHash || existing.passwordHash),
                    role: row.role === "super_admin" ? "super_admin" : row.role === "admin" ? "admin" : "user"
                  }
                });
                touch("users", "overwritten");
              } else {
                touch("users", "skipped");
              }
            } else {
              await tx.user.create({ data: mapUserRow(row, payload.strategy === "replace") });
              touch("users", "created");
            }
          }
        }

        if (includeBusiness) {
          const partnerIdMap = new Map();
          const productIdMap = new Map();
          const materialIdMap = new Map();
          const processingIdMap = new Map();
          const txIdMap = new Map();

          const existingPartners = payload.strategy === "replace" ? [] : await tx.partner.findMany({ orderBy: { id: "asc" } });
          const existingProducts = payload.strategy === "replace" ? [] : await tx.product.findMany({ orderBy: { id: "asc" } });
          const existingMaterials = payload.strategy === "replace" ? [] : await tx.material.findMany({ orderBy: { id: "asc" } });
          const existingProcessings =
            payload.strategy === "replace" ? [] : await tx.processing.findMany({ orderBy: { id: "asc" } });

          const partnerMap = mapByUnique(existingPartners, partnerKey);
          const productMap = mapByUnique(existingProducts, productKey);
          const materialMap = mapByUnique(existingMaterials, materialKey);
          const processingMap = mapByUnique(existingProcessings, processingKey);

          for (const row of sortById(scopedData.partners || [])) {
            const key = partnerKey(row);
            const existing = partnerMap.get(key);
            if (existing) {
              partnerIdMap.set(Number(row.id || 0), existing.id);
              touch("partners", "conflicts");
              if (payload.strategy === "replace" || payload.onConflict === "overwrite") {
                await tx.partner.update({ where: { id: existing.id }, data: mapPartnerRow(row, false) });
                touch("partners", "overwritten");
              } else {
                touch("partners", "skipped");
              }
            } else {
              const created = await tx.partner.create({ data: mapPartnerRow(row, payload.strategy === "replace") });
              partnerMap.set(key, created);
              partnerIdMap.set(Number(row.id || 0), created.id);
              touch("partners", "created");
            }
          }

          for (const row of sortById(scopedData.products || [])) {
            const key = productKey(row);
            const existing = productMap.get(key);
            if (existing) {
              productIdMap.set(Number(row.id || 0), existing.id);
              touch("products", "conflicts");
              if (payload.strategy === "replace" || payload.onConflict === "overwrite") {
                await tx.product.update({ where: { id: existing.id }, data: mapProductRow(row, false) });
                touch("products", "overwritten");
              } else {
                touch("products", "skipped");
              }
            } else {
              const created = await tx.product.create({ data: mapProductRow(row, payload.strategy === "replace") });
              productMap.set(key, created);
              productIdMap.set(Number(row.id || 0), created.id);
              touch("products", "created");
            }
          }

          for (const row of sortById(scopedData.materials || [])) {
            const key = materialKey(row);
            const existing = materialMap.get(key);
            if (existing) {
              materialIdMap.set(Number(row.id || 0), existing.id);
              touch("materials", "conflicts");
              if (payload.strategy === "replace" || payload.onConflict === "overwrite") {
                await tx.material.update({ where: { id: existing.id }, data: mapMaterialRow(row, false) });
                touch("materials", "overwritten");
              } else {
                touch("materials", "skipped");
              }
            } else {
              const created = await tx.material.create({ data: mapMaterialRow(row, payload.strategy === "replace") });
              materialMap.set(key, created);
              materialIdMap.set(Number(row.id || 0), created.id);
              touch("materials", "created");
            }
          }

          for (const row of sortById(scopedData.processings || [])) {
            const key = processingKey(row);
            const existing = processingMap.get(key);
            if (existing) {
              processingIdMap.set(Number(row.id || 0), existing.id);
              touch("processings", "conflicts");
              if (payload.strategy === "replace" || payload.onConflict === "overwrite") {
                await tx.processing.update({ where: { id: existing.id }, data: mapProcessingRow(row, false) });
                touch("processings", "overwritten");
              } else {
                touch("processings", "skipped");
              }
            } else {
              const created = await tx.processing.create({ data: mapProcessingRow(row, payload.strategy === "replace") });
              processingMap.set(key, created);
              processingIdMap.set(Number(row.id || 0), created.id);
              touch("processings", "created");
            }
          }

          const existingTxData =
            payload.strategy === "replace"
              ? { transactions: [], transactionItems: [], inboundLines: [] }
              : {
                  transactions: await tx.transaction.findMany({ orderBy: { id: "asc" } }),
                  transactionItems: await tx.transactionItem.findMany({ orderBy: { id: "asc" } }),
                  inboundLines: await tx.inboundLine.findMany({ orderBy: { id: "asc" } })
                };
          const existingDetails = buildDetailMaps(existingTxData);
          const importedDetails = buildDetailMaps(scopedData);
          const slipMap = new Map();
          const fpMap = new Map();
          for (const item of existingTxData.transactions || []) {
            const id = Number(item.id);
            const slip = slipDedupKey(item);
            const fp = fingerprintTx(
              item,
              existingDetails.itemsByTx.get(id) || [],
              existingDetails.linesByTx.get(id) || []
            );
            if (slip && !slipMap.has(slip)) slipMap.set(slip, item.id);
            if (fp && !fpMap.has(fp)) fpMap.set(fp, item.id);
          }

          for (const row of sortById(scopedData.transactions || [])) {
            const sourceTxId = Number(row.id || 0);
            const partnerId = partnerIdMap.get(Number(row.partnerId || 0)) ?? Number(row.partnerId || 0);
            if (!partnerId) {
              touch("transactions", "failed");
              report.failures.push({ entity: "transactions", ref: sourceTxId || null, reason: "交易对象映射失败" });
              continue;
            }

            const importItems = importedDetails.itemsByTx.get(sourceTxId) || [];
            const importLines = importedDetails.linesByTx.get(sourceTxId) || [];
            const slipKey = slipDedupKey({ ...row, partnerId });
            const fp = fingerprintTx({ ...row, partnerId }, importItems, importLines);
            const existingId = (slipKey && slipMap.get(slipKey)) || fpMap.get(fp) || null;

            const sourceTxRef = row.sourceTransactionId == null ? null : txIdMap.get(Number(row.sourceTransactionId)) || null;
            let targetTxId = null;
            if (existingId) {
              touch("transactions", "conflicts");
              if (payload.strategy === "replace" || payload.onConflict === "overwrite") {
                await tx.transaction.update({
                  where: { id: existingId },
                  data: mapTransactionRow(row, partnerId, sourceTxRef, false)
                });
                await tx.transactionItem.deleteMany({ where: { transactionId: existingId } });
                await tx.inboundLine.deleteMany({ where: { transactionId: existingId } });
                await tx.inboundBreakdown.deleteMany({ where: { transactionId: existingId } });
                targetTxId = existingId;
                touch("transactions", "overwritten");
              } else {
                targetTxId = existingId;
                touch("transactions", "skipped");
              }
            } else {
              const created = await tx.transaction.create({
                data: mapTransactionRow(row, partnerId, sourceTxRef, payload.strategy === "replace")
              });
              targetTxId = created.id;
              touch("transactions", "created");
              if (slipKey) slipMap.set(slipKey, targetTxId);
              fpMap.set(fp, targetTxId);
            }
            txIdMap.set(sourceTxId, targetTxId);

            if (targetTxId && (payload.strategy === "replace" || !existingId || payload.onConflict === "overwrite")) {
              for (const item of importItems) {
                const productId = productIdMap.get(Number(item.productId || 0)) ?? Number(item.productId || 0);
                if (!productId) continue;
                await tx.transactionItem.create({
                  data: mapTransactionItemRow(item, targetTxId, productId, payload.strategy === "replace")
                });
                touch("transactionItems", "created");
              }

              for (const line of importLines) {
                const materialId = line.lineType === "material" ? materialIdMap.get(Number(line.materialId || 0)) ?? Number(line.materialId || 0) : null;
                const processingId =
                  line.lineType === "processing"
                    ? processingIdMap.get(Number(line.processingId || 0)) ?? Number(line.processingId || 0)
                    : null;
                await tx.inboundLine.create({
                  data: mapInboundLineRow(line, targetTxId, materialId, processingId, payload.strategy === "replace")
                });
                touch("inboundLines", "created");
              }
            }
          }

          for (const row of sortById(scopedData.inboundBreakdowns || [])) {
            const txId = txIdMap.get(Number(row.transactionId || 0)) ?? Number(row.transactionId || 0);
            if (!txId) {
              touch("inboundBreakdowns", "failed");
              continue;
            }
            const existing = await tx.inboundBreakdown.findUnique({ where: { transactionId: txId } });
            if (existing) {
              touch("inboundBreakdowns", "conflicts");
              if (payload.strategy === "replace" || payload.onConflict === "overwrite") {
                await tx.inboundBreakdown.update({
                  where: { transactionId: txId },
                  data: mapInboundBreakdownRow(row, txId, false)
                });
                touch("inboundBreakdowns", "overwritten");
              } else {
                touch("inboundBreakdowns", "skipped");
              }
            } else {
              await tx.inboundBreakdown.create({
                data: mapInboundBreakdownRow(row, txId, payload.strategy === "replace")
              });
              touch("inboundBreakdowns", "created");
            }
          }

          for (const row of sortById(scopedData.stockAdjustments || [])) {
            const productId = productIdMap.get(Number(row.productId || 0)) ?? Number(row.productId || 0);
            if (!productId) {
              touch("stockAdjustments", "failed");
              continue;
            }
            await tx.stockAdjustment.create({ data: mapStockAdjustmentRow(row, productId, payload.strategy === "replace") });
            touch("stockAdjustments", "created");
          }

          for (const row of sortById(scopedData.materialStockAdjustments || [])) {
            const materialId = materialIdMap.get(Number(row.materialId || 0)) ?? Number(row.materialId || 0);
            if (!materialId) {
              touch("materialStockAdjustments", "failed");
              continue;
            }
            await tx.materialStockAdjustment.create({
              data: mapMaterialAdjustmentRow(row, materialId, payload.strategy === "replace")
            });
            touch("materialStockAdjustments", "created");
          }
        }
      });

      return {
        data: {
          message: "恢复执行完成",
          report
        }
      };
    } catch (error) {
      return reply.code(error?.statusCode || 400).send({
        message: error instanceof Error ? error.message : "恢复执行失败"
      });
    }
  });

}
