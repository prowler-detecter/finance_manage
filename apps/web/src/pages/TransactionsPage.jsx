import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/AuthContext";

const PRODUCT_ITEM_TYPES = ["out", "sale_return"];
const DECREASE_STOCK_TYPES = ["out"];
const RETURN_TYPES = ["sale_return", "purchase_return"];
const INBOUND_LINE_TYPES = ["in", "purchase_return"];
const QUANTITY_SCALE = 4;
const QUANTITY_EPSILON = 1e-9;
const TX_DRAFT_STORAGE_PREFIX = "finance_tx_draft_v1_";
const RECENT_BOOKKEEPING_CLEAR_PREFIX = "finance_recent_bookkeeping_clear_v1_";
const RECENT_BOOKKEEPING_LIMIT = 100;
const TX_TYPE_SORT_ORDER = {
  out: 1,
  in: 2,
  sale_return: 3,
  purchase_return: 4,
  receive: 5,
  pay: 6,
  receive_diff: 7,
  pay_diff: 8
};

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.replaceAll("/", "-");
}

function dateKeyFromValue(value) {
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return "";
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function typeLabel(type) {
  if (type === "out") return "出库";
  if (type === "in") return "入库";
  if (type === "sale_return") return "销售退货";
  if (type === "purchase_return") return "采购退货";
  if (type === "receive") return "收款";
  if (type === "pay") return "付款";
  if (type === "receive_diff") return "收款差额";
  if (type === "pay_diff") return "付款差额";
  return "未知";
}

function createItemRow() {
  return {
    rowId: Date.now() + Math.floor(Math.random() * 10000),
    productId: "",
    quantity: "",
    unitPrice: ""
  };
}

function createInboundLineRow() {
  return {
    rowId: Date.now() + Math.floor(Math.random() * 10000),
    lineType: "material",
    materialId: "",
    processingId: "",
    name: "",
    sku: "",
    spec: "",
    unit: "",
    quantity: "",
    unitPrice: ""
  };
}

function buildDraftStorageKey(username) {
  const safeUser = String(username || "anonymous").trim() || "anonymous";
  return `${TX_DRAFT_STORAGE_PREFIX}${safeUser}`;
}

function buildRecentBookkeepingClearKey(username) {
  const safeUser = String(username || "anonymous").trim() || "anonymous";
  return `${RECENT_BOOKKEEPING_CLEAR_PREFIX}${safeUser}`;
}

function toMillis(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isReturnType(type) {
  return RETURN_TYPES.includes(type);
}

function isAfterRecentClearMarker(transaction, marker) {
  if (!marker?.clearedAt) return true;
  const txTime = toMillis(transaction?.recordedAt);
  const markerTime = toMillis(marker.clearedAt);
  if (txTime > markerTime) return true;
  if (txTime < markerTime) return false;
  return Number(transaction?.id || 0) > Number(marker.clearedMaxId || 0);
}

function compareRecentRowBySort(a, b, sortBy, sortDir) {
  const direction = sortDir === "asc" ? 1 : -1;
  let compareValue = 0;
  if (sortBy === "recordedAt") {
    compareValue = toMillis(a?.recordedAt) - toMillis(b?.recordedAt);
  } else if (sortBy === "id") {
    compareValue = Number(a?.id || 0) - Number(b?.id || 0);
  } else if (sortBy === "bookkeepingDate") {
    compareValue = String(a?.bookkeepingDate || "").localeCompare(String(b?.bookkeepingDate || ""));
  } else if (sortBy === "transactionDate") {
    compareValue = String(a?.transactionDate || "").localeCompare(String(b?.transactionDate || ""));
  } else if (sortBy === "amount") {
    compareValue = Number(a?.amount || 0) - Number(b?.amount || 0);
  } else if (sortBy === "type") {
    compareValue = Number(TX_TYPE_SORT_ORDER[a?.type] || 999) - Number(TX_TYPE_SORT_ORDER[b?.type] || 999);
  }

  if (compareValue === 0) {
    compareValue = Number(a?.id || 0) - Number(b?.id || 0);
  }

  return compareValue * direction;
}

function needsWarehouseSlip(type) {
  return type === "out" || type === "in" || type === "sale_return" || type === "purchase_return";
}

function expectedPartnerType(type) {
  if (["out", "sale_return", "receive", "receive_diff"].includes(type)) return "customer";
  if (["in", "purchase_return", "pay", "pay_diff"].includes(type)) return "supplier";
  return "";
}

function normalizeSlipBook(book) {
  return String(book || "").trim();
}

function normalizeSlipBookKey(book) {
  return normalizeSlipBook(book).toLowerCase();
}

function compareTxDesc(a, b) {
  const aDate = String(a.transactionDate || "");
  const bDate = String(b.transactionDate || "");
  if (aDate !== bDate) return aDate < bDate ? 1 : -1;

  const aRecorded = new Date(a.recordedAt || 0).getTime();
  const bRecorded = new Date(b.recordedAt || 0).getTime();
  if (aRecorded !== bRecorded) return bRecorded - aRecorded;

  return Number(b.id || 0) - Number(a.id || 0);
}

function slipSequenceTypes(type) {
  if (type === "out" || type === "sale_return") return ["out", "sale_return"];
  if (type === "in" || type === "purchase_return") return ["in", "purchase_return"];
  return [type];
}

function getPreferredSlipBook(transactions, type, partnerId) {
  const typeSet = new Set(slipSequenceTypes(type));
  const rows = (transactions || [])
    .filter(
      (tx) => typeSet.has(tx.type) && Number(tx.partnerId) === Number(partnerId) && normalizeSlipBook(tx.slipBook)
    )
    .sort(compareTxDesc);

  return rows.length > 0 ? normalizeSlipBook(rows[0].slipBook) : "";
}

function getNextSlipNo(transactions, type, slipBook) {
  const key = normalizeSlipBookKey(slipBook);
  if (!key) return 1;
  const typeSet = new Set(slipSequenceTypes(type));

  let maxNo = 0;
  for (const tx of transactions || []) {
    if (!typeSet.has(tx.type)) continue;
    if (normalizeSlipBookKey(tx.slipBook) !== key) continue;
    const no = Number(tx.slipNo || 0);
    if (Number.isInteger(no) && no > maxNo) maxNo = no;
  }
  return maxNo > 0 ? maxNo + 1 : 1;
}

function formatQtyWithUnit(quantity, unit) {
  const qty = Number(quantity);
  const qtyText = Number.isFinite(qty) ? String(qty) : String(quantity ?? "");
  const unitText = String(unit || "").trim();
  return unitText ? `${qtyText}${unitText}` : qtyText;
}

function roundToScale(value, scale = QUANTITY_SCALE) {
  const factor = 10 ** scale;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function normalizeQuantityValue(value) {
  const qty = Number(value);
  if (!Number.isFinite(qty)) return null;
  return roundToScale(qty, QUANTITY_SCALE);
}

function isIntegerLike(value) {
  return Math.abs(Number(value) - Math.trunc(Number(value))) < QUANTITY_EPSILON;
}

function formatQuantityText(value) {
  if (!Number.isFinite(Number(value))) return String(value ?? "");
  const normalized = roundToScale(Number(value), QUANTITY_SCALE);
  return normalized.toFixed(QUANTITY_SCALE).replace(/\.?0+$/, "");
}

function formatItemSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return "无产品明细";
  const parts = items.slice(0, 2).map((item) => {
    const name = item?.productSnapshot?.name || "产品";
    return `${name} x${formatQtyWithUnit(item.quantity, item?.productSnapshot?.unit)}`;
  });
  if (items.length > 2) return `${parts.join("，")} 等${items.length}项`;
  return parts.join("，");
}

function formatInboundSummary(inboundLines) {
  if (!Array.isArray(inboundLines) || inboundLines.length === 0) return "无入库明细";
  const parts = inboundLines.slice(0, 2).map((line) => {
    const typeText = line?.lineType === "processing" ? "加工" : "物料";
    const name = String(line?.name || "").trim() || typeText;
    return `${typeText}:${name} x${formatQtyWithUnit(line.quantity, line?.unit)}`;
  });
  if (inboundLines.length > 2) return `${parts.join("，")} 等${inboundLines.length}项`;
  return parts.length > 0 ? parts.join(" + ") : "无入库明细";
}

function formatTransactionSummary(transaction) {
  if (INBOUND_LINE_TYPES.includes(transaction.type)) return formatInboundSummary(transaction.inboundLines);
  return formatItemSummary(transaction.items);
}

function buildSourceTransactionLabel(transaction) {
  const slip = transaction.slipBook && transaction.slipNo ? `${transaction.slipBook}-${transaction.slipNo}` : "";
  const slipPrefix = slip ? `${slip} | ` : "";
  return `${slipPrefix}${transaction.transactionDate} | ${formatTransactionSummary(transaction)} | ¥${Number(
    transaction.amount || 0
  ).toFixed(2)} | ID:${transaction.id}`;
}

function getDefaultSlipValues(transactions, type, partnerId) {
  const preferredBook = getPreferredSlipBook(transactions, type, Number(partnerId));
  if (!preferredBook) {
    return {
      slipBook: "",
      slipNo: ""
    };
  }

  return {
    slipBook: preferredBook,
    slipNo: String(getNextSlipNo(transactions, type, preferredBook))
  };
}

function normalizeNullableText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function findLibraryEntryBySnapshot(rows, line) {
  const code = normalizeNullableText(line?.sku);
  const name = String(line?.name || "").trim();
  const spec = normalizeNullableText(line?.spec);
  const unit = String(line?.unit || "").trim();
  if (!Array.isArray(rows) || rows.length === 0) return null;

  if (code) {
    return rows.find((row) => String(row.code || "").trim() === code) || null;
  }
  if (!name || !unit) return null;
  return (
    rows.find(
      (row) =>
        !normalizeNullableText(row.code) &&
        String(row.name || "").trim() === name &&
        normalizeNullableText(row.spec) === spec &&
        String(row.unit || "").trim() === unit
    ) || null
  );
}

function createFormSnapshot(form, amountManualOverride, hasSlipInfo) {
  return {
    form: {
      type: String(form.type || "out"),
      partnerId: String(form.partnerId || ""),
      transactionDate: String(form.transactionDate || today()),
      bookkeepingDate: String(form.bookkeepingDate || today()),
      amount: String(form.amount || ""),
      sourceTransactionId: String(form.sourceTransactionId || ""),
      remark: String(form.remark || ""),
      hasSlipInfo: hasSlipInfo !== false,
      slipBook: String(form.slipBook || ""),
      slipNo: String(form.slipNo || ""),
      items: Array.isArray(form.items)
        ? form.items.map((row) => ({
            rowId: row?.rowId || Date.now() + Math.floor(Math.random() * 10000),
            productId: String(row?.productId || ""),
            quantity: String(row?.quantity || ""),
            unitPrice: String(row?.unitPrice || "")
          }))
        : [createItemRow()],
      inboundLines: Array.isArray(form.inboundLines)
        ? form.inboundLines.map((row) => ({
            rowId: row?.rowId || Date.now() + Math.floor(Math.random() * 10000),
            lineType: row?.lineType === "processing" ? "processing" : "material",
            materialId: String(row?.materialId || ""),
            processingId: String(row?.processingId || ""),
            name: String(row?.name || ""),
            sku: String(row?.sku || ""),
            spec: String(row?.spec || ""),
            unit: String(row?.unit || ""),
            quantity: String(row?.quantity || ""),
            unitPrice: String(row?.unitPrice || "")
          }))
        : [createInboundLineRow()]
    },
    amountManualOverride: amountManualOverride === true
  };
}

function createEmptyDraftForm(overrides = {}) {
  return {
    type: "out",
    partnerId: "",
    transactionDate: today(),
    bookkeepingDate: today(),
    amount: "",
    sourceTransactionId: "",
    remark: "",
    slipBook: "",
    slipNo: "",
    items: [createItemRow()],
    inboundLines: [createInboundLineRow()],
    ...overrides
  };
}

export default function TransactionsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const autoFillContextRef = useRef("");
  const sourcePrefillRef = useRef("");
  const hydratedDraftKeyRef = useRef("");
  const skipDraftSaveRef = useRef(false);
  const submitSnapshotRef = useRef(null);
  const draftStorageKey = useMemo(() => buildDraftStorageKey(user?.username), [user?.username]);
  const recentClearStorageKey = useMemo(() => buildRecentBookkeepingClearKey(user?.username), [user?.username]);

  const [form, setForm] = useState(() => createEmptyDraftForm());

  const [amountManualOverride, setAmountManualOverride] = useState(false);
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState({
    name: "",
    sku: "",
    spec: "",
    unit: "",
    defaultUnitPrice: ""
  });
  const [quickInboundOpen, setQuickInboundOpen] = useState(false);
  const [quickInbound, setQuickInbound] = useState({
    lineType: "material",
    name: "",
    code: "",
    spec: "",
    unit: "",
    defaultUnitPrice: ""
  });
  const [hasSlipInfo, setHasSlipInfo] = useState(true);
  const [pendingDeleteTxId, setPendingDeleteTxId] = useState(null);
  const [splitNotice, setSplitNotice] = useState(null);
  const [splitNoticeFeedback, setSplitNoticeFeedback] = useState("");
  const [recentSortBy, setRecentSortBy] = useState("recordedAt");
  const [recentSortDir, setRecentSortDir] = useState("desc");
  const [recentClearedMarker, setRecentClearedMarker] = useState(null);

  const resetDraftToInitialState = useCallback(
    ({ confirm = false, keepCurrentTypePartner = false, nextSlipBook = "", nextSlipNo = "", skipDraftSave = true } = {}) => {
      if (confirm) {
        const ok = window.confirm("确认清空当前记账草稿并恢复为初始状态吗？");
        if (!ok) return false;
      }

      sessionStorage.removeItem(draftStorageKey);
      if (skipDraftSave) {
        skipDraftSaveRef.current = true;
      }

      autoFillContextRef.current = "";
      sourcePrefillRef.current = "";
      submitSnapshotRef.current = null;

      setHasSlipInfo(true);
      setAmountManualOverride(false);
      setSplitNotice(null);
      setSplitNoticeFeedback("");
      setQuickProductOpen(false);
      setQuickInboundOpen(false);
      setQuickProduct({
        name: "",
        sku: "",
        spec: "",
        unit: "",
        defaultUnitPrice: ""
      });
      setQuickInbound({
        lineType: "material",
        name: "",
        code: "",
        spec: "",
        unit: "",
        defaultUnitPrice: ""
      });

      setForm((prev) =>
        createEmptyDraftForm({
          type: keepCurrentTypePartner ? prev.type : "out",
          partnerId: keepCurrentTypePartner ? prev.partnerId : "",
          slipBook: keepCurrentTypePartner ? String(nextSlipBook || "") : "",
          slipNo: keepCurrentTypePartner ? String(nextSlipNo || "") : ""
        })
      );
      return true;
    },
    [draftStorageKey]
  );

  useEffect(() => {
    const raw = localStorage.getItem(recentClearStorageKey);
    if (!raw) {
      setRecentClearedMarker(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        setRecentClearedMarker(null);
        return;
      }
      const clearedAt = String(parsed.clearedAt || "");
      const clearedMaxId = Number(parsed.clearedMaxId || 0);
      if (!clearedAt) {
        setRecentClearedMarker(null);
        return;
      }
      setRecentClearedMarker({
        clearedAt,
        clearedMaxId: Number.isInteger(clearedMaxId) ? clearedMaxId : 0
      });
    } catch {
      setRecentClearedMarker(null);
    }
  }, [recentClearStorageKey]);

  useEffect(() => {
    if (hydratedDraftKeyRef.current === draftStorageKey) return;
    hydratedDraftKeyRef.current = draftStorageKey;
    const raw = sessionStorage.getItem(draftStorageKey);
    if (!raw) return;

    try {
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== "object") return;

      const restoredItems = Array.isArray(draft.items)
        ? draft.items.map((row) => ({
            rowId: Date.now() + Math.floor(Math.random() * 10000),
            productId: String(row?.productId || ""),
            quantity: String(row?.quantity || ""),
            unitPrice: String(row?.unitPrice || "")
          }))
        : [createItemRow()];

      const restoredInboundLines = Array.isArray(draft.inboundLines)
        ? draft.inboundLines.map((row) => ({
            rowId: Date.now() + Math.floor(Math.random() * 10000),
            lineType: row?.lineType === "processing" ? "processing" : "material",
            materialId: String(row?.materialId || ""),
            processingId: String(row?.processingId || ""),
            name: String(row?.name || ""),
            sku: String(row?.sku || ""),
            spec: String(row?.spec || ""),
            unit: String(row?.unit || ""),
            quantity: String(row?.quantity || ""),
            unitPrice: String(row?.unitPrice || "")
          }))
        : [createInboundLineRow()];

      skipDraftSaveRef.current = true;
      const todayKey = today();
      const savedAtKey = dateKeyFromValue(draft.savedAt);
      const fallbackDateKey = normalizeDateText(draft.bookkeepingDate || draft.transactionDate);
      const shouldRefreshDates = savedAtKey ? savedAtKey !== todayKey : Boolean(fallbackDateKey && fallbackDateKey !== todayKey);
      const restoredTransactionDate = shouldRefreshDates
        ? todayKey
        : String(draft.transactionDate || todayKey);
      const restoredBookkeepingDate = shouldRefreshDates
        ? todayKey
        : String(draft.bookkeepingDate || todayKey);

      setHasSlipInfo(draft.hasSlipInfo !== false);
      setForm((prev) => ({
        ...prev,
        type: String(draft.type || prev.type),
        partnerId: String(draft.partnerId || ""),
        transactionDate: restoredTransactionDate,
        bookkeepingDate: restoredBookkeepingDate,
        amount: String(draft.amount || ""),
        sourceTransactionId: String(draft.sourceTransactionId || ""),
        remark: String(draft.remark || ""),
        slipBook: String(draft.slipBook || ""),
        slipNo: String(draft.slipNo || ""),
        items: restoredItems.length > 0 ? restoredItems : [createItemRow()],
        inboundLines: restoredInboundLines.length > 0 ? restoredInboundLines : [createInboundLineRow()]
      }));
      setAmountManualOverride(draft.amountManualOverride === true);
    } catch {
      // ignore invalid draft
    }
  }, [draftStorageKey]);

  const partnersQuery = useQuery({
    queryKey: ["partners"],
    queryFn: async () => (await apiRequest("/partners")).data
  });

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await apiRequest("/products")).data
  });
  const materialsQuery = useQuery({
    queryKey: ["materials"],
    queryFn: async () => (await apiRequest("/materials")).data
  });
  const processingsQuery = useQuery({
    queryKey: ["processings"],
    queryFn: async () => (await apiRequest("/processings")).data
  });

  const transactionsQuery = useQuery({
    queryKey: ["transactions"],
    queryFn: async () => (await apiRequest("/transactions")).data
  });

  const inventoryQuery = useQuery({
    queryKey: ["inventory"],
    queryFn: async () => (await apiRequest("/inventory/overview")).data
  });

  const filteredPartners = useMemo(() => {
    const expect = expectedPartnerType(form.type);
    return (partnersQuery.data || []).filter((p) => !expect || p.type === expect);
  }, [form.type, partnersQuery.data]);

  const partnerNameMap = useMemo(() => {
    const map = new Map();
    for (const partner of partnersQuery.data || []) {
      map.set(Number(partner.id), partner.name);
    }
    return map;
  }, [partnersQuery.data]);

  const inventoryMap = useMemo(() => {
    const map = new Map();
    for (const item of inventoryQuery.data || []) {
      map.set(Number(item.id), Number(item.stock || 0));
    }
    return map;
  }, [inventoryQuery.data]);

  const materialById = useMemo(() => {
    const map = new Map();
    for (const row of materialsQuery.data || []) {
      map.set(Number(row.id), row);
    }
    return map;
  }, [materialsQuery.data]);

  const processingById = useMemo(() => {
    const map = new Map();
    for (const row of processingsQuery.data || []) {
      map.set(Number(row.id), row);
    }
    return map;
  }, [processingsQuery.data]);

  const sourceTransactions = useMemo(() => {
    if (!isReturnType(form.type) || !form.partnerId) return [];
    const sourceType = form.type === "sale_return" ? "out" : "in";
    return (transactionsQuery.data || [])
      .filter((tx) => Number(tx.partnerId) === Number(form.partnerId) && tx.type === sourceType)
      .sort(compareTxDesc);
  }, [form.type, form.partnerId, transactionsQuery.data]);

  const recentBookkeepingBaseline = useMemo(() => {
    const rows = [...(transactionsQuery.data || [])];
    rows.sort((a, b) => {
      const diff = toMillis(b?.recordedAt) - toMillis(a?.recordedAt);
      if (diff !== 0) return diff;
      return Number(b?.id || 0) - Number(a?.id || 0);
    });
    return rows.slice(0, RECENT_BOOKKEEPING_LIMIT);
  }, [transactionsQuery.data]);

  const filteredRecentBookkeeping = useMemo(() => {
    if (!recentClearedMarker) return recentBookkeepingBaseline;
    return recentBookkeepingBaseline.filter((row) => isAfterRecentClearMarker(row, recentClearedMarker));
  }, [recentBookkeepingBaseline, recentClearedMarker]);

  const sortedRecentBookkeeping = useMemo(() => {
    const rows = [...filteredRecentBookkeeping];
    rows.sort((a, b) => compareRecentRowBySort(a, b, recentSortBy, recentSortDir));
    return rows;
  }, [filteredRecentBookkeeping, recentSortBy, recentSortDir]);

  const slipHint = useMemo(() => {
    if (!needsWarehouseSlip(form.type)) return "";
    if (!hasSlipInfo) return "当前设置为无单据信息，本次不记录单据簿号/单据号。";

    const slipBook = normalizeSlipBook(form.slipBook);
    const slipNoText = String(form.slipNo || "").trim();

    if (!slipBook && !slipNoText) return "出库/入库/销售退货/采购退货单号可选填；填写后系统可提示顺号。";
    if (!slipBook && slipNoText) return "如填写单据号，请同时填写单据簿号。";

    const nextNo = getNextSlipNo(transactionsQuery.data || [], form.type, slipBook);
    if (!slipNoText) return `当前簿号 [${slipBook}] 建议下一号：${nextNo}。`;

    const slipNo = Number(slipNoText);
    if (!Number.isInteger(slipNo) || slipNo <= 0) return "单据号需为正整数。";
    if (slipNo === nextNo) return `单据号顺序正常，当前为建议下一号 ${nextNo}。`;
    if (slipNo > nextNo) return `当前输入 ${slipNo}，跳过了建议下一号 ${nextNo}（允许，但请确认）。`;
    return `当前输入 ${slipNo} 小于已使用最大号，若继续使用可能重复。`;
  }, [form.type, form.slipBook, form.slipNo, transactionsQuery.data, hasSlipInfo]);

  const isProductItemType = PRODUCT_ITEM_TYPES.includes(form.type);
  const isInboundType = INBOUND_LINE_TYPES.includes(form.type);
  const autoAmountFromDetail = isProductItemType || isInboundType;
  const outSplitPreview = useMemo(() => {
    if (form.type !== "out") {
      return { hasNegative: false, positiveAmount: 0, returnAmount: 0, totalAmount: 0 };
    }

    let positiveAmount = 0;
    let returnAmount = 0;
    for (const row of form.items) {
      const productId = Number(row.productId || 0);
      const qty = normalizeQuantityValue(row.quantity);
      const price = Number(row.unitPrice || 0);
      if (!productId || qty == null || qty === 0 || price < 0) continue;
      if (qty > 0) positiveAmount += qty * price;
      if (qty < 0) returnAmount += Math.abs(qty) * price;
    }

    return {
      hasNegative: returnAmount > 0,
      positiveAmount,
      returnAmount,
      totalAmount: positiveAmount + returnAmount
    };
  }, [form.type, form.items]);

  const inboundSplitPreview = useMemo(() => {
    if (!isInboundType) {
      return { hasNegative: false, baseAmount: 0, reverseAmount: 0, totalAmount: 0, reverseType: "" };
    }
    const reverseType = form.type === "in" ? "purchase_return" : "in";
    let baseAmount = 0;
    let reverseAmount = 0;
    for (const row of form.inboundLines) {
      const qty = normalizeQuantityValue(row.quantity);
      const price = Number(row.unitPrice || 0);
      const hasLibrarySelection =
        row.lineType === "processing" ? Number(row.processingId || 0) > 0 : Number(row.materialId || 0) > 0;
      if (!hasLibrarySelection || qty == null || qty === 0 || price < 0) continue;
      if (qty > 0) baseAmount += qty * price;
      if (qty < 0) reverseAmount += Math.abs(qty) * price;
    }

    return {
      hasNegative: reverseAmount > 0,
      baseAmount,
      reverseAmount,
      totalAmount: baseAmount + reverseAmount,
      reverseType
    };
  }, [isInboundType, form.type, form.inboundLines]);

  const lineTotal = useMemo(() => {
    if (isInboundType) {
      return inboundSplitPreview.hasNegative
        ? inboundSplitPreview.totalAmount
        : form.inboundLines.reduce((sum, row) => {
            const qty = normalizeQuantityValue(row.quantity);
            const price = Number(row.unitPrice || 0);
            const hasLibrarySelection =
              row.lineType === "processing" ? Number(row.processingId || 0) > 0 : Number(row.materialId || 0) > 0;
            if (hasLibrarySelection && qty != null && qty > 0 && price >= 0) return sum + qty * price;
            return sum;
          }, 0);
    }
    if (form.type === "out") return outSplitPreview.totalAmount;

    return form.items.reduce((sum, row) => {
      const productId = Number(row.productId || 0);
      const qty = normalizeQuantityValue(row.quantity);
      const price = Number(row.unitPrice || 0);
      if (productId > 0 && qty != null && qty > 0 && price >= 0) return sum + qty * price;
      return sum;
    }, 0);
  }, [
    form.items,
    form.inboundLines,
    isInboundType,
    form.type,
    outSplitPreview.totalAmount,
    inboundSplitPreview.hasNegative,
    inboundSplitPreview.totalAmount
  ]);

  const amountModeHint = useMemo(() => {
    if (form.type === "in" && inboundSplitPreview.hasNegative) {
      return "检测到负数数量：提交后将自动拆分为“入库 + 采购退货”，金额按明细自动计算。";
    }
    if (form.type === "purchase_return" && inboundSplitPreview.hasNegative) {
      return "检测到负数数量：提交后将自动拆分为“采购退货 + 入库”，金额按明细自动计算。";
    }
    if (form.type === "in") return "入库按物料/加工明细登记，金额默认由明细自动汇总，可手工修改覆盖。";
    if (form.type === "purchase_return") return "采购退货按物料/加工明细登记，金额默认由明细自动汇总，可手工修改覆盖。";
    if (form.type === "out" && outSplitPreview.hasNegative) {
      return "检测到负数数量：提交后将自动拆分为“出库 + 销售退货”，金额按明细自动计算。";
    }
    if (form.type === "out") return "出库可选登记单据簿号与单据号，金额默认由产品明细汇总。";
    if (isReturnType(form.type)) return "退货金额默认由明细汇总，可选关联原交易。";
    if (isProductItemType) return "金额默认由产品明细自动汇总，可手工修改覆盖。";
    return "收款/付款（含差额）无需录入产品明细。";
  }, [form.type, isProductItemType, outSplitPreview.hasNegative, inboundSplitPreview.hasNegative]);

  const stockWarningText = useMemo(() => {
    if (!DECREASE_STOCK_TYPES.includes(form.type)) return "";
    const qtyByProduct = new Map();

    for (const row of form.items) {
      const productId = Number(row.productId || 0);
      const qty = Number(row.quantity || 0);
      if (!productId || qty <= 0) continue;
      qtyByProduct.set(productId, (qtyByProduct.get(productId) || 0) + qty);
    }

    const warnings = [];
    for (const [productId, outQty] of qtyByProduct.entries()) {
      const product = (productsQuery.data || []).find((p) => Number(p.id) === productId);
      const currentStock = Number(inventoryMap.get(productId) || 0);
      const projectedStock = currentStock - outQty;
      if (projectedStock < 0 && product) warnings.push(`${product.name} 预计库存 ${projectedStock}`);
    }

    return warnings.length > 0 ? `库存预警（不拦截提交）：${warnings.join("；")}` : "";
  }, [form.type, form.items, productsQuery.data, inventoryMap]);

  useEffect(() => {
    const forceAutoForSplit =
      (form.type === "out" && outSplitPreview.hasNegative) ||
      (isInboundType && inboundSplitPreview.hasNegative);
    if (!autoAmountFromDetail || (amountManualOverride && !forceAutoForSplit)) return;
    setForm((prev) => ({ ...prev, amount: lineTotal > 0 ? lineTotal.toFixed(2) : "" }));
    if (forceAutoForSplit && amountManualOverride) {
      setAmountManualOverride(false);
    }
  }, [
    lineTotal,
    amountManualOverride,
    autoAmountFromDetail,
    form.type,
    outSplitPreview.hasNegative,
    isInboundType,
    inboundSplitPreview.hasNegative
  ]);

  useEffect(() => {
    setAmountManualOverride(false);
  }, [form.type]);

  useEffect(() => {
    if (isReturnType(form.type)) return;
    sourcePrefillRef.current = "";
    setForm((prev) => ({ ...prev, sourceTransactionId: "" }));
  }, [form.type]);

  useEffect(() => {
    if (form.type !== "purchase_return") {
      sourcePrefillRef.current = "";
      return;
    }

    const sourceIdText = String(form.sourceTransactionId || "").trim();
    if (!sourceIdText) {
      sourcePrefillRef.current = "";
      return;
    }
    if (sourcePrefillRef.current === sourceIdText) return;

    const sourceTx = (transactionsQuery.data || []).find(
      (tx) => Number(tx.id) === Number(sourceIdText) && tx.type === "in" && Number(tx.partnerId) === Number(form.partnerId)
    );
    if (!sourceTx || !Array.isArray(sourceTx.inboundLines) || sourceTx.inboundLines.length === 0) return;

    const copiedLines = sourceTx.inboundLines.map((line) => ({
      rowId: Date.now() + Math.floor(Math.random() * 10000),
      lineType: line?.lineType === "processing" ? "processing" : "material",
      materialId:
        line?.lineType === "material"
          ? String(
              Number(line?.materialId || 0) ||
                Number(findLibraryEntryBySnapshot(materialsQuery.data || [], line)?.id || 0) ||
                ""
            )
          : "",
      processingId:
        line?.lineType === "processing"
          ? String(
              Number(line?.processingId || 0) ||
                Number(findLibraryEntryBySnapshot(processingsQuery.data || [], line)?.id || 0) ||
                ""
            )
          : "",
      name: String(line?.name || ""),
      sku: String(line?.sku || ""),
      spec: String(line?.spec || ""),
      unit: String(line?.unit || ""),
      quantity: String(line?.quantity || ""),
      unitPrice: String(line?.unitPrice || "")
    }));

    sourcePrefillRef.current = sourceIdText;
    setForm((prev) => ({
      ...prev,
      inboundLines: copiedLines.length > 0 ? copiedLines : [createInboundLineRow()]
    }));
    setAmountManualOverride(false);
  }, [form.type, form.sourceTransactionId, form.partnerId, transactionsQuery.data, materialsQuery.data, processingsQuery.data]);

  useEffect(() => {
    if (needsWarehouseSlip(form.type)) return;
    autoFillContextRef.current = "";
    setForm((prev) => ({ ...prev, slipBook: "", slipNo: "" }));
  }, [form.type]);

  useEffect(() => {
    if (!needsWarehouseSlip(form.type) || !form.partnerId || !hasSlipInfo) return;
    if (normalizeSlipBook(form.slipBook)) return;

    const defaultSlip = getDefaultSlipValues(transactionsQuery.data || [], form.type, Number(form.partnerId));
    if (!defaultSlip.slipBook) return;

    const contextKey = `${form.type}|${form.partnerId}|${defaultSlip.slipBook}`;
    if (autoFillContextRef.current === contextKey) return;
    autoFillContextRef.current = contextKey;

    setForm((prev) => ({
      ...prev,
      slipBook: defaultSlip.slipBook,
      slipNo: prev.slipNo || defaultSlip.slipNo
    }));
  }, [form.type, form.partnerId, form.slipBook, transactionsQuery.data, hasSlipInfo]);

  useEffect(() => {
    if (!needsWarehouseSlip(form.type) || hasSlipInfo) return;
    autoFillContextRef.current = "";
    setForm((prev) => {
      if (!prev.slipBook && !prev.slipNo) return prev;
      return { ...prev, slipBook: "", slipNo: "" };
    });
  }, [form.type, hasSlipInfo]);

  useEffect(() => {
    if (!isProductItemType) return;
    if (form.items.length > 0) return;
    setForm((prev) => ({ ...prev, items: [createItemRow()] }));
  }, [isProductItemType, form.items.length]);

  useEffect(() => {
    if (!isInboundType) return;
    if (form.inboundLines.length > 0) return;
    setForm((prev) => ({ ...prev, inboundLines: [createInboundLineRow()] }));
  }, [isInboundType, form.inboundLines.length]);

  useEffect(() => {
    if (hydratedDraftKeyRef.current !== draftStorageKey) return;
    if (skipDraftSaveRef.current) {
      skipDraftSaveRef.current = false;
      return;
    }

    const draft = {
      savedAt: new Date().toISOString(),
      type: form.type,
      partnerId: form.partnerId,
      transactionDate: form.transactionDate,
      bookkeepingDate: form.bookkeepingDate,
      amount: form.amount,
      sourceTransactionId: form.sourceTransactionId,
      remark: form.remark,
      hasSlipInfo,
      slipBook: form.slipBook,
      slipNo: form.slipNo,
      items: form.items.map((row) => ({
        productId: row.productId,
        quantity: row.quantity,
        unitPrice: row.unitPrice
      })),
      inboundLines: form.inboundLines.map((row) => ({
        lineType: row.lineType,
        materialId: row.materialId,
        processingId: row.processingId,
        name: row.name,
        sku: row.sku,
        spec: row.spec,
        unit: row.unit,
        quantity: row.quantity,
        unitPrice: row.unitPrice
      })),
      amountManualOverride
    };
    sessionStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [draftStorageKey, form, amountManualOverride, hasSlipInfo]);

  const createMutation = useMutation({
    mutationFn: async (payload) =>
      apiRequest("/transactions", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: (res, payload) => {
      const splitResult = res?.splitResult;
      const createdTxRows = Array.isArray(splitResult?.createdTransactions) ? splitResult.createdTransactions : [];
      const submitSnapshot = submitSnapshotRef.current;
      submitSnapshotRef.current = null;
      setSplitNoticeFeedback("");

      if (splitResult?.split && createdTxRows.length > 0) {
        const txSummary = (splitResult.createdTransactions || [])
          .map((row) => `${typeLabel(row.type)}#${row.id}（¥${Number(row.amount || 0).toFixed(2)}）`)
          .join("，");
        setSplitNotice({
          mode: "split",
          message: `系统已按负数数量自动拆单：${txSummary}`,
          transactionIds: createdTxRows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0),
          snapshot: submitSnapshot
        });
      } else if (splitResult?.autoConvertedTo && payload) {
        setSplitNotice({
          mode: "converted",
          message: `本次${typeLabel(payload.type)}明细均为负数，系统已自动按“${typeLabel(
            splitResult.autoConvertedTo
          )}”登记。`,
          transactionIds: createdTxRows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0),
          snapshot: submitSnapshot
        });
      } else {
        setSplitNotice(null);
      }

      const hasCreatedOutTx = createdTxRows.some((row) => row?.type === "out");
      const shouldAutoAdvanceSlip =
        payload &&
        needsWarehouseSlip(payload.type) &&
        normalizeSlipBook(payload.slipBook) &&
        Number.isInteger(Number(payload.slipNo)) &&
        Number(payload.slipNo) > 0 &&
        (payload.type !== "out" || createdTxRows.length === 0 || hasCreatedOutTx);

      const nextSlipBook = shouldAutoAdvanceSlip ? normalizeSlipBook(payload.slipBook) : "";
      const nextSlipNo = shouldAutoAdvanceSlip ? String(Number(payload.slipNo) + 1) : "";

      resetDraftToInitialState({
        keepCurrentTypePartner: true,
        nextSlipBook,
        nextSlipNo,
        skipDraftSave: false
      });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["materials"] });
      queryClient.invalidateQueries({ queryKey: ["processings"] });
    }
  });

  const undoAutoSplitMutation = useMutation({
    mutationFn: async (payload) =>
      apiRequest("/transactions/undo-auto-split", {
        method: "POST",
        body: JSON.stringify({
          transactionIds: payload.transactionIds
        })
      }),
    onSuccess: async (_res, variables) => {
      if (variables?.snapshot?.form) {
        setForm(variables.snapshot.form);
        setAmountManualOverride(variables.snapshot.amountManualOverride === true);
      }
      setSplitNotice(null);
      setSplitNoticeFeedback("已撤销本次自动拆单记录。");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["materials"] }),
        queryClient.invalidateQueries({ queryKey: ["processings"] })
      ]);
    },
    onError: (error) => {
      setSplitNoticeFeedback(error?.message || "撤销失败，请稍后重试");
    }
  });

  const deleteTransactionMutation = useMutation({
    mutationFn: async (id) =>
      apiRequest(`/transactions/${id}`, {
        method: "DELETE"
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["materials"] }),
        queryClient.invalidateQueries({ queryKey: ["processings"] })
      ]);
    }
  });

  const createProductMutation = useMutation({
    mutationFn: async (payload) =>
      apiRequest("/products", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: (res) => {
      const created = res.data;
      setQuickProduct({ name: "", sku: "", spec: "", unit: "", defaultUnitPrice: "" });
      setQuickProductOpen(false);
      queryClient.invalidateQueries({ queryKey: ["products"] });

      setForm((prev) => {
        const nextItems = [...prev.items];
        const emptyIndex = nextItems.findIndex((item) => !item.productId);
        const targetIndex = emptyIndex >= 0 ? emptyIndex : nextItems.length;
        if (emptyIndex < 0) nextItems.push(createItemRow());

        const current = nextItems[targetIndex];
        nextItems[targetIndex] = {
          ...current,
          productId: String(created.id),
          quantity: current.quantity || "1",
          unitPrice: Number(created.defaultUnitPrice || 0).toFixed(2)
        };

        return { ...prev, items: nextItems };
      });
    }
  });

  const createInboundLibraryMutation = useMutation({
    mutationFn: async ({ lineType, payload }) =>
      apiRequest(lineType === "processing" ? "/processings" : "/materials", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: (res, variables) => {
      const created = res.data;
      const lineType = variables.lineType === "processing" ? "processing" : "material";
      if (lineType === "processing") {
        queryClient.invalidateQueries({ queryKey: ["processings"] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["materials"] });
      }

      setQuickInboundOpen(false);
      setQuickInbound({
        lineType: "material",
        name: "",
        code: "",
        spec: "",
        unit: "",
        defaultUnitPrice: ""
      });

      setForm((prev) => {
        const nextLines = [...prev.inboundLines];
        let targetIndex = nextLines.findIndex((row) =>
          lineType === "processing" ? !String(row.processingId || "").trim() : !String(row.materialId || "").trim()
        );
        if (targetIndex < 0) {
          nextLines.push(createInboundLineRow());
          targetIndex = nextLines.length - 1;
        }

        const current = nextLines[targetIndex];
        nextLines[targetIndex] = {
          ...current,
          lineType,
          materialId: lineType === "material" ? String(created.id) : "",
          processingId: lineType === "processing" ? String(created.id) : "",
          name: String(created.name || ""),
          sku: String(created.code || ""),
          spec: String(created.spec || ""),
          unit: String(created.unit || ""),
          quantity: current.quantity || "1",
          unitPrice: Number(created.defaultUnitPrice || 0).toFixed(2)
        };

        return {
          ...prev,
          inboundLines: nextLines
        };
      });
    }
  });

  function setItem(index, patch, fromProductSelection = false) {
    setForm((prev) => {
      const items = [...prev.items];
      const nextRow = { ...items[index], ...patch };

      if (fromProductSelection) {
        const product = (productsQuery.data || []).find((p) => Number(p.id) === Number(nextRow.productId));
        if (product) {
          if (!String(nextRow.quantity || "").trim()) nextRow.quantity = "1";
          nextRow.unitPrice = Number(product.defaultUnitPrice || 0).toFixed(2);
        }
      }

      items[index] = nextRow;
      return { ...prev, items };
    });
  }

  function setInboundLine(index, patch) {
    setForm((prev) => ({
      ...prev,
      inboundLines: prev.inboundLines.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
    }));
  }

  function setInboundLineType(index, lineType) {
    setForm((prev) => ({
      ...prev,
      inboundLines: prev.inboundLines.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return {
          ...row,
          lineType,
          materialId: "",
          processingId: "",
          name: "",
          sku: "",
          spec: "",
          unit: "",
          unitPrice: ""
        };
      })
    }));
  }

  function setInboundLibrarySelection(index, lineType, selectedIdText) {
    const selectedId = Number(selectedIdText || 0);
    const rowData =
      lineType === "processing" ? processingsQuery.data || [] : materialsQuery.data || [];
    const selected = rowData.find((row) => Number(row.id) === selectedId) || null;

    setForm((prev) => ({
      ...prev,
      inboundLines: prev.inboundLines.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        if (!selected) {
          return {
            ...row,
            lineType,
            materialId: "",
            processingId: "",
            name: "",
            sku: "",
            spec: "",
            unit: "",
            unitPrice: ""
          };
        }

        return {
          ...row,
          lineType,
          materialId: lineType === "material" ? String(selected.id) : "",
          processingId: lineType === "processing" ? String(selected.id) : "",
          name: String(selected.name || ""),
          sku: String(selected.code || ""),
          spec: String(selected.spec || ""),
          unit: String(selected.unit || ""),
          quantity: row.quantity || "1",
          unitPrice: Number(selected.defaultUnitPrice || 0).toFixed(2)
        };
      })
    }));
  }

  function fillNextSlipNo() {
    if (!needsWarehouseSlip(form.type)) return;
    const slipBook = normalizeSlipBook(form.slipBook);
    if (!slipBook) {
      window.alert("请先填写单据簿号");
      return;
    }

    setForm((prev) => ({
      ...prev,
      slipNo: String(getNextSlipNo(transactionsQuery.data || [], prev.type, slipBook))
    }));
  }

  async function undoSplitNotice() {
    if (!splitNotice || undoAutoSplitMutation.isPending) return;
    const txIds = Array.isArray(splitNotice.transactionIds)
      ? splitNotice.transactionIds.filter((id) => Number.isInteger(Number(id)) && Number(id) > 0).map((id) => Number(id))
      : [];

    if (txIds.length === 0) {
      setSplitNoticeFeedback("当前记录不支持撤销");
      return;
    }

    try {
      await undoAutoSplitMutation.mutateAsync({
        transactionIds: txIds,
        snapshot: splitNotice.snapshot
      });
    } catch {
      // handled by onError
    }
  }

  async function deleteRecentTransaction(transaction) {
    const slipText =
      normalizeSlipBook(transaction?.slipBook) && Number.isInteger(Number(transaction?.slipNo)) && Number(transaction?.slipNo) > 0
        ? `${normalizeSlipBook(transaction.slipBook)}-${Number(transaction.slipNo)}`
        : "-";
    const confirmText = `确认删除该流水吗？\n类型：${typeLabel(transaction?.type)}\n交易日期：${
      transaction?.transactionDate || "-"
    }\n金额：¥${Number(transaction?.amount || 0).toFixed(2)}\n单号：${slipText}\nID：${
      transaction?.id
    }\n\n删除后不可恢复。`;
    if (!window.confirm(confirmText)) return;

    try {
      setPendingDeleteTxId(Number(transaction.id));
      await deleteTransactionMutation.mutateAsync(Number(transaction.id));
      window.alert("流水已删除");
    } catch (error) {
      window.alert(error.message || "删除流水失败");
    } finally {
      setPendingDeleteTxId(null);
    }
  }

  function clearRecentBookkeepingView() {
    if (recentBookkeepingBaseline.length === 0) {
      window.alert("当前没有可清空的最近记账记录");
      return;
    }
    if (!window.confirm("确认清空“最近记账”模块展示吗？\n仅影响此模块显示，不会删除系统真实流水。")) return;

    const marker = {
      clearedAt: new Date().toISOString(),
      clearedMaxId: recentBookkeepingBaseline.reduce(
        (maxId, row) => Math.max(maxId, Number(row?.id || 0)),
        0
      )
    };
    localStorage.setItem(recentClearStorageKey, JSON.stringify(marker));
    setRecentClearedMarker(marker);
  }

  function restoreRecentBookkeepingView() {
    localStorage.removeItem(recentClearStorageKey);
    setRecentClearedMarker(null);
  }

  async function addProductFromQuickForm() {
    if (!quickProduct.name.trim() || !quickProduct.unit.trim()) {
      window.alert("请完整填写产品名称和单位");
      return;
    }

    try {
      await createProductMutation.mutateAsync({
        name: quickProduct.name.trim(),
        sku: quickProduct.sku.trim() || null,
        spec: quickProduct.spec.trim() || null,
        unit: quickProduct.unit.trim(),
        defaultUnitPrice: Number(quickProduct.defaultUnitPrice || 0)
      });
    } catch (error) {
      window.alert(error.message || "临时新增产品失败");
    }
  }

  async function addInboundLibraryFromQuickForm() {
    if (!quickInbound.name.trim() || !quickInbound.unit.trim()) {
      window.alert(`请完整填写${quickInbound.lineType === "processing" ? "加工项" : "物料"}名称和单位`);
      return;
    }

    try {
      await createInboundLibraryMutation.mutateAsync({
        lineType: quickInbound.lineType,
        payload: {
          name: quickInbound.name.trim(),
          code: quickInbound.code.trim() || null,
          spec: quickInbound.spec.trim() || null,
          unit: quickInbound.unit.trim(),
          defaultUnitPrice: Number(quickInbound.defaultUnitPrice || 0)
        }
      });
    } catch (error) {
      window.alert(error.message || "临时新增物料/加工项失败");
    }
  }

  async function submit(force = false, skipDecimalConfirm = false) {
    if (!form.partnerId || !form.transactionDate || !form.bookkeepingDate) {
      window.alert("请填写完整信息");
      return;
    }

    const slipBook = hasSlipInfo ? normalizeSlipBook(form.slipBook) : "";
    const slipNoText = hasSlipInfo ? String(form.slipNo || "").trim() : "";

    if (needsWarehouseSlip(form.type) && hasSlipInfo && ((slipBook && !slipNoText) || (!slipBook && slipNoText))) {
      window.alert("如需填写单号，请同时填写单据簿号和单据号");
      return;
    }

    if (hasSlipInfo && slipNoText) {
      const slipNo = Number(slipNoText);
      if (!Number.isInteger(slipNo) || slipNo <= 0) {
        window.alert("单据号必须为正整数");
        return;
      }
    }

    const productById = new Map((productsQuery.data || []).map((p) => [Number(p.id), p]));
    const materialMasterById = new Map((materialsQuery.data || []).map((row) => [Number(row.id), row]));
    const processingMasterById = new Map((processingsQuery.data || []).map((row) => [Number(row.id), row]));
    const validItems = [];
    const decimalQuantityRows = [];

    if (isProductItemType) {
      for (let i = 0; i < form.items.length; i += 1) {
        const row = form.items[i];
        const productId = Number(row.productId || 0);
        const rawQuantity = Number(row.quantity || 0);
        const quantity = normalizeQuantityValue(rawQuantity);
        const unitPrice = Number(row.unitPrice || 0);
        const isEmpty = !productId && !String(row.quantity || "").trim() && !String(row.unitPrice || "").trim();
        if (isEmpty) continue;

        if (!productId) {
          window.alert(`第 ${i + 1} 行请选择产品`);
          return;
        }

        if (quantity == null || quantity === 0) {
          window.alert(`第 ${i + 1} 行数量必须为非0有效数字`);
          return;
        }

        if (form.type !== "out" && quantity <= 0) {
          window.alert(`第 ${i + 1} 行数量必须大于0`);
          return;
        }

        if (unitPrice < 0) {
          window.alert(`第 ${i + 1} 行单价不能为负数`);
          return;
        }

        const product = productById.get(productId);
        if (!product) {
          window.alert(`第 ${i + 1} 行产品不存在`);
          return;
        }

        if (!product.active) {
          window.alert(`第 ${i + 1} 行产品已停用，不能用于新单`);
          return;
        }

        if (!isIntegerLike(rawQuantity)) {
          decimalQuantityRows.push({
            scope: "产品明细",
            rowNo: i + 1,
            valueText: formatQuantityText(rawQuantity),
            normalizedText: formatQuantityText(quantity)
          });
        }

        validItems.push({
          productId,
          quantity,
          unitPrice,
          lineAmount: (form.type === "out" ? Math.abs(quantity) : quantity) * unitPrice
        });
      }

      if (validItems.length === 0) {
        window.alert("涉及库存的交易至少需要填写 1 行有效产品明细");
        return;
      }
    }

    const validInboundLines = [];
    if (isInboundType) {
      for (let i = 0; i < form.inboundLines.length; i += 1) {
        const row = form.inboundLines[i];
        const lineType = row.lineType === "processing" ? "processing" : "material";
        const materialId = Number(row.materialId || 0);
        const processingId = Number(row.processingId || 0);
        const rawQuantity = Number(row.quantity || 0);
        const quantity = normalizeQuantityValue(rawQuantity);
        const unitPrice = Number(row.unitPrice || 0);
        const selectedId = lineType === "processing" ? processingId : materialId;
        const isEmpty =
          !selectedId &&
          !String(row.quantity || "").trim() &&
          !String(row.unitPrice || "").trim();
        if (isEmpty) continue;

        if (!Number.isInteger(selectedId) || selectedId <= 0) {
          window.alert(`第 ${i + 1} 行请选择${lineType === "processing" ? "加工项" : "物料"}`);
          return;
        }
        if (quantity == null || quantity === 0) {
          window.alert(`第 ${i + 1} 行数量必须为非0有效数字`);
          return;
        }
        if (unitPrice < 0) {
          window.alert(`第 ${i + 1} 行单价不能为负数`);
          return;
        }

        if (lineType === "processing") {
          const processing = processingMasterById.get(processingId);
          if (!processing) {
            window.alert(`第 ${i + 1} 行加工项不存在`);
            return;
          }
          if (!processing.active) {
            window.alert(`第 ${i + 1} 行加工项已停用，不能用于新单`);
            return;
          }
        } else {
          const material = materialMasterById.get(materialId);
          if (!material) {
            window.alert(`第 ${i + 1} 行物料不存在`);
            return;
          }
          if (!material.active) {
            window.alert(`第 ${i + 1} 行物料已停用，不能用于新单`);
            return;
          }
        }

        if (!isIntegerLike(rawQuantity)) {
          decimalQuantityRows.push({
            scope: lineType === "processing" ? "加工明细" : "物料明细",
            rowNo: i + 1,
            valueText: formatQuantityText(rawQuantity),
            normalizedText: formatQuantityText(quantity)
          });
        }

        validInboundLines.push({
          lineType,
          materialId: lineType === "material" ? materialId : null,
          processingId: lineType === "processing" ? processingId : null,
          quantity,
          unitPrice,
          lineAmount: Math.abs(quantity) * unitPrice
        });
      }

      if (validInboundLines.length === 0) {
        window.alert(`${form.type === "purchase_return" ? "采购退货" : "入库"}至少需要 1 行有效的物料/加工明细`);
        return;
      }
    }

    if (!skipDecimalConfirm && decimalQuantityRows.length > 0) {
      const detailText = decimalQuantityRows
        .map((row) => {
          if (row.valueText === row.normalizedText) {
            return `${row.scope} 第${row.rowNo}行：${row.valueText}`;
          }
          return `${row.scope} 第${row.rowNo}行：${row.valueText} → ${row.normalizedText}`;
        })
        .join("\n- ");
      const warningText = `检测到小数数量：\n- ${detailText}\n\n系统将按最多${QUANTITY_SCALE}位小数保存（超出自动四舍五入）。是否继续提交？`;
      if (!window.confirm(warningText)) return;
    }

    const computedAmount = validItems.reduce((sum, item) => sum + Number(item.lineAmount || 0), 0);
    const inboundComputedAmount = validInboundLines.reduce((sum, line) => sum + Number(line.lineAmount || 0), 0);
    const detailAmount = isInboundType ? inboundComputedAmount : computedAmount;
    const hasNegativeOutQty = form.type === "out" && validItems.some((item) => Number(item.quantity) < 0);
    const hasNegativeInboundQty = isInboundType && validInboundLines.some((line) => Number(line.quantity) < 0);
    let finalAmount = Number(form.amount || (detailAmount > 0 ? detailAmount : 0));
    if (hasNegativeOutQty || hasNegativeInboundQty) finalAmount = detailAmount;

    if (finalAmount <= 0) {
      window.alert("金额必须大于 0");
      return;
    }

    const payload = {
      type: form.type,
      partnerId: Number(form.partnerId),
      transactionDate: form.transactionDate,
      bookkeepingDate: form.bookkeepingDate,
      amount: finalAmount,
      computedAmount: autoAmountFromDetail ? detailAmount : 0,
      remark: form.remark || null,
      sourceTransactionId: form.sourceTransactionId ? Number(form.sourceTransactionId) : null,
      slipBook: slipBook || null,
      slipNo: slipNoText ? Number(slipNoText) : null,
      force
    };

    if (isProductItemType) payload.items = validItems;
    if (isInboundType) {
      payload.inboundLines = validInboundLines;
    }

    try {
      submitSnapshotRef.current = createFormSnapshot(form, amountManualOverride, hasSlipInfo);
      await createMutation.mutateAsync(payload);
    } catch (error) {
      submitSnapshotRef.current = null;
      if (error.status === 409 && Array.isArray(error.body?.warnings)) {
        const text = `系统提示以下风险：\n- ${error.body.warnings.join("\n- ")}\n\n是否继续保存？`;
        if (window.confirm(text)) await submit(true, true);
      } else {
        window.alert(error.message || "保存失败");
      }
    }
  }

  return (
    <section>
      <div className="header-row">
        <h1>记账登记</h1>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-outline btn-compact"
            onClick={() => {
              resetDraftToInitialState({
                confirm: true,
                keepCurrentTypePartner: false,
                skipDraftSave: true
              });
            }}
          >
            清空草稿
          </button>
        </div>
      </div>
      <div className="card card-narrow tx-form-card">
        {splitNotice ? (
          <div className="tx-undo-notice">
            <div className="tx-undo-notice-text">
              <strong>{splitNotice.mode === "split" ? "已自动拆单" : "已自动识别为销售退货"}</strong>
              <div>{splitNotice.message}</div>
              <small className="muted-text">支持 10 分钟内撤销。</small>
            </div>
            <div className="tx-undo-notice-actions">
              <button
                type="button"
                className="btn btn-outline btn-compact"
                onClick={undoSplitNotice}
                disabled={undoAutoSplitMutation.isPending}
              >
                {undoAutoSplitMutation.isPending ? "撤销中..." : "撤销"}
              </button>
              <button
                type="button"
                className="btn btn-compact"
                onClick={() => {
                  setSplitNotice(null);
                  setSplitNoticeFeedback("");
                }}
                disabled={undoAutoSplitMutation.isPending}
              >
                关闭
              </button>
            </div>
          </div>
        ) : null}

        <div className={`muted-text${splitNoticeFeedback ? "" : " hidden"}`}>{splitNoticeFeedback}</div>

        <div className="form-group">
          <label>交易类型</label>
          <select
            value={form.type}
            onChange={(e) => {
              autoFillContextRef.current = "";
              setForm((prev) => ({
                ...prev,
                type: e.target.value,
                partnerId: "",
                sourceTransactionId: "",
                slipBook: "",
                slipNo: ""
              }));
            }}
          >
            <option value="out">出库 (销售 - 别人欠我们)</option>
            <option value="in">入库 (采购 - 我们欠别人)</option>
            <option value="sale_return">销售退货 (客户向我们退货)</option>
            <option value="purchase_return">采购退货 (我们向供应商退货)</option>
            <option value="receive">收款 (别人还钱)</option>
            <option value="pay">付款 (我们还钱)</option>
            <option value="receive_diff">收款差额 (客户往来差额调整)</option>
            <option value="pay_diff">付款差额 (供应商往来差额调整)</option>
          </select>
        </div>

        <div className="form-group">
          <label>选择客户/供应商</label>
          <select
            value={form.partnerId}
            onChange={(e) => {
              const nextPartnerId = e.target.value;
              autoFillContextRef.current = "";
              setForm((prev) => ({
                ...prev,
                partnerId: nextPartnerId,
                sourceTransactionId: "",
                slipBook: "",
                slipNo: ""
              }));
            }}
          >
            <option value="">请选择</option>
            {filteredPartners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.type === "customer" ? "客户" : "供应商"}）
              </option>
            ))}
          </select>
          <small>
            <Link className="link-action" to="/partners">
              + 没找到？去添加新客户
            </Link>
          </small>
        </div>

        {isReturnType(form.type) ? (
          <div className="quick-add-panel">
            <div className="form-group">
              <label>关联原交易 (可选)</label>
              <select
                value={form.sourceTransactionId}
                onChange={(e) => setForm((prev) => ({ ...prev, sourceTransactionId: e.target.value }))}
              >
                <option value="">-- 不关联原交易 --</option>
                {sourceTransactions.map((tx) => (
                  <option key={tx.id} value={tx.id}>
                    {buildSourceTransactionLabel(tx)}
                  </option>
                ))}
              </select>
              <small className="muted-text">
                {form.partnerId
                  ? sourceTransactions.length > 0
                    ? `可选 ${sourceTransactions.length} 条历史${form.type === "sale_return" ? "出库" : "入库"}记录作为退货来源。`
                    : "当前对象暂无可关联的历史交易，可直接登记退货。"
                  : "请先选择客户/供应商，再选择可关联的历史交易。"}
              </small>
            </div>
          </div>
        ) : null}

        <div className="form-group">
          <label>交易日期</label>
          <input
            type="date"
            value={form.transactionDate}
            onChange={(e) => setForm((prev) => ({ ...prev, transactionDate: e.target.value }))}
          />
        </div>

        {needsWarehouseSlip(form.type) ? (
          <div className="quick-add-panel">
            <div className="slip-toggle-row">
              <button
                type="button"
                className={`btn btn-compact${hasSlipInfo ? " btn-primary" : " btn-outline"}`}
                onClick={() => {
                  if (hasSlipInfo) return;
                  setHasSlipInfo(true);
                  autoFillContextRef.current = "";
                  const defaultSlip = getDefaultSlipValues(transactionsQuery.data || [], form.type, Number(form.partnerId));
                  const contextKey = defaultSlip.slipBook ? `${form.type}|${form.partnerId}|${defaultSlip.slipBook}` : "";
                  autoFillContextRef.current = contextKey;
                  setForm((prev) => ({
                    ...prev,
                    slipBook: defaultSlip.slipBook,
                    slipNo: defaultSlip.slipNo
                  }));
                }}
              >
                有单据信息
              </button>
              <button
                type="button"
                className={`btn btn-compact${hasSlipInfo ? " btn-outline" : " btn-primary"}`}
                onClick={() => {
                  if (!hasSlipInfo) return;
                  setHasSlipInfo(false);
                  autoFillContextRef.current = "";
                  setForm((prev) => ({
                    ...prev,
                    slipBook: "",
                    slipNo: ""
                  }));
                }}
              >
                无单据信息
              </button>
            </div>

            {hasSlipInfo ? (
              <div className="modal-grid">
                <div className="form-group">
                  <label>单据簿号 (选填)</label>
                  <input
                    type="text"
                    placeholder="例如：A册"
                    value={form.slipBook}
                    onChange={(e) => setForm((prev) => ({ ...prev, slipBook: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>单据号 (选填，整数)</label>
                  <div className="inline-input-row">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="例如：101"
                      value={form.slipNo}
                      onChange={(e) => setForm((prev) => ({ ...prev, slipNo: e.target.value }))}
                    />
                    <button type="button" className="btn btn-outline btn-compact" onClick={fillNextSlipNo}>
                      带出下一号
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            <small className="muted-text">{slipHint}</small>
          </div>
        ) : null}

        {isInboundType ? (
          <div className="form-group">
            <div className="section-title-row">
              <label>{form.type === "purchase_return" ? "采购退货明细（物料 / 加工）" : "入库明细（物料 / 加工）"}</label>
              <div className="section-actions">
                <button
                  type="button"
                  className="btn btn-outline btn-compact"
                  onClick={() => setForm((prev) => ({ ...prev, inboundLines: [...prev.inboundLines, createInboundLineRow()] }))}
                >
                  + 添加明细行
                </button>
                <button type="button" className="btn btn-outline btn-compact" onClick={() => setQuickInboundOpen((v) => !v)}>
                  + 临时新增物料/加工
                </button>
              </div>
            </div>

            {quickInboundOpen ? (
              <div className="quick-add-panel">
                <div className="quick-add-grid">
                  <select
                    value={quickInbound.lineType}
                    onChange={(e) => setQuickInbound((prev) => ({ ...prev, lineType: e.target.value }))}
                  >
                    <option value="material">物料库</option>
                    <option value="processing">加工库</option>
                  </select>
                  <input
                    type="text"
                    placeholder={quickInbound.lineType === "processing" ? "加工项名称" : "物料名称"}
                    value={quickInbound.name}
                    onChange={(e) => setQuickInbound((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="编码 (选填)"
                    value={quickInbound.code}
                    onChange={(e) => setQuickInbound((prev) => ({ ...prev, code: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="规格 (选填)"
                    value={quickInbound.spec}
                    onChange={(e) => setQuickInbound((prev) => ({ ...prev, spec: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="单位 (如: 件/次)"
                    value={quickInbound.unit}
                    onChange={(e) => setQuickInbound((prev) => ({ ...prev, unit: e.target.value }))}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="默认单价"
                    value={quickInbound.defaultUnitPrice}
                    onChange={(e) => setQuickInbound((prev) => ({ ...prev, defaultUnitPrice: e.target.value }))}
                  />
                </div>
                <div className="quick-add-actions">
                  <button type="button" className="btn btn-primary btn-compact" onClick={addInboundLibraryFromQuickForm}>
                    保存{quickInbound.lineType === "processing" ? "加工项" : "物料"}
                  </button>
                  <button type="button" className="btn btn-compact" onClick={() => setQuickInboundOpen(false)}>
                    取消
                  </button>
                </div>
              </div>
            ) : null}

            {materialsQuery.isLoading || processingsQuery.isLoading ? <small className="muted-text">主数据加载中...</small> : null}
            {materialsQuery.isError ? <small className="error-text">{materialsQuery.error.message}</small> : null}
            {processingsQuery.isError ? <small className="error-text">{processingsQuery.error.message}</small> : null}

            <div className="table-scroll">
              <table className="inbound-lines-table fixed-table">
                <thead>
                  <tr>
                    <th>类别</th>
                    <th>项目</th>
                    <th>编码</th>
                    <th>规格</th>
                    <th>单位</th>
                    <th>数量</th>
                    <th>单价</th>
                    <th>小计</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {form.inboundLines.map((row, idx) => {
                    const master =
                      row.lineType === "processing"
                        ? processingById.get(Number(row.processingId || 0))
                        : materialById.get(Number(row.materialId || 0));
                    const selectedIdText = row.lineType === "processing" ? row.processingId : row.materialId;
                    const optionRows = row.lineType === "processing" ? processingsQuery.data || [] : materialsQuery.data || [];
                    const qty = normalizeQuantityValue(row.quantity) ?? 0;
                    const price = Number(row.unitPrice || 0);
                    const displayLineTotal = Math.abs(qty) * price;
                    return (
                      <tr key={row.rowId}>
                        <td>
                          <select value={row.lineType} onChange={(e) => setInboundLineType(idx, e.target.value)}>
                            <option value="material">物料</option>
                            <option value="processing">加工</option>
                          </select>
                        </td>
                        <td>
                          <select
                            value={selectedIdText}
                            onChange={(e) => setInboundLibrarySelection(idx, row.lineType, e.target.value)}
                          >
                            <option value="">-- 选择{row.lineType === "processing" ? "加工项" : "物料"} --</option>
                            {optionRows
                              .filter((item) => item.active || Number(item.id) === Number(selectedIdText || 0))
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}（{item.code || "无编码"}
                                  {item.active ? "" : ", 已停用"}）
                                </option>
                              ))}
                          </select>
                        </td>
                        <td>{master ? master.code || "-" : row.sku || "-"}</td>
                        <td>{master ? master.spec || "-" : row.spec || "-"}</td>
                        <td>{master ? master.unit || "-" : row.unit || "-"}</td>
                        <td>
                          <input
                            type="number"
                            step="1"
                            value={row.quantity}
                            onChange={(e) => setInboundLine(idx, { quantity: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.unitPrice}
                            onChange={(e) => setInboundLine(idx, { unitPrice: e.target.value })}
                          />
                        </td>
                        <td className="line-total">¥{displayLineTotal.toFixed(2)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-small-outline"
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                inboundLines: prev.inboundLines.filter((item) => item.rowId !== row.rowId)
                              }))
                            }
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="item-summary-row">
              <span>
                {inboundSplitPreview.hasNegative ? "拆单总额预览" : form.type === "purchase_return" ? "采购退货明细汇总" : "入库明细汇总"}：
                <strong>¥{lineTotal.toFixed(2)}</strong>
              </span>
              <span className={`hint-text${autoAmountFromDetail && amountManualOverride ? "" : " hidden"}`}>已手工覆盖金额</span>
            </div>
            <small className={`muted-text${inboundSplitPreview.hasNegative ? "" : " hidden"}`}>
              自动拆分预览：{typeLabel(form.type)} ¥{inboundSplitPreview.baseAmount.toFixed(2)}，
              {typeLabel(inboundSplitPreview.reverseType)} ¥{inboundSplitPreview.reverseAmount.toFixed(2)}。
            </small>
          </div>
        ) : null}

        {isProductItemType ? (
          <div className="form-group">
            <div className="section-title-row">
              <label>产品明细 (涉及库存交易至少 1 行)</label>
              <div className="section-actions">
                <button
                  type="button"
                  className="btn btn-outline btn-compact"
                  onClick={() => setForm((prev) => ({ ...prev, items: [...prev.items, createItemRow()] }))}
                >
                  + 添加产品行
                </button>
                <button type="button" className="btn btn-outline btn-compact" onClick={() => setQuickProductOpen((v) => !v)}>
                  + 临时新增产品
                </button>
              </div>
            </div>

            {quickProductOpen ? (
              <div className="quick-add-panel">
                <div className="quick-add-grid">
                  <input
                    type="text"
                    placeholder="产品名称"
                    value={quickProduct.name}
                    onChange={(e) => setQuickProduct((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="产品编码 (选填)"
                    value={quickProduct.sku}
                    onChange={(e) => setQuickProduct((prev) => ({ ...prev, sku: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="规格 (选填)"
                    value={quickProduct.spec}
                    onChange={(e) => setQuickProduct((prev) => ({ ...prev, spec: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="单位 (如: 件)"
                    value={quickProduct.unit}
                    onChange={(e) => setQuickProduct((prev) => ({ ...prev, unit: e.target.value }))}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="默认单价"
                    value={quickProduct.defaultUnitPrice}
                    onChange={(e) => setQuickProduct((prev) => ({ ...prev, defaultUnitPrice: e.target.value }))}
                  />
                </div>
                <div className="quick-add-actions">
                  <button type="button" className="btn btn-primary btn-compact" onClick={addProductFromQuickForm}>
                    保存产品
                  </button>
                  <button type="button" className="btn btn-compact" onClick={() => setQuickProductOpen(false)}>
                    取消
                  </button>
                </div>
              </div>
            ) : null}

            <table>
              <thead>
                <tr>
                  <th>产品</th>
                  <th>编码</th>
                  <th>规格</th>
                  <th>单位</th>
                  <th>数量</th>
                  <th>单价</th>
                  <th>小计</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((row, idx) => {
                  const product = (productsQuery.data || []).find((p) => Number(p.id) === Number(row.productId || 0));
                  const qty = normalizeQuantityValue(row.quantity) ?? 0;
                  const price = Number(row.unitPrice || 0);
                  const displayLineTotal = form.type === "out" ? Math.abs(qty) * price : qty * price;

                  return (
                    <tr key={row.rowId}>
                      <td>
                        <select value={row.productId} onChange={(e) => setItem(idx, { productId: e.target.value }, true)}>
                          <option value="">-- 选择产品 --</option>
                          {(productsQuery.data || [])
                            .filter((p) => p.active || Number(p.id) === Number(row.productId || 0))
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}（{p.sku || "无编码"}
                                {p.active ? "" : ", 已停用"}）
                              </option>
                            ))}
                        </select>
                      </td>
                      <td>{product ? product.sku || "-" : <span className="cell-muted">-</span>}</td>
                      <td>{product ? product.spec || "-" : <span className="cell-muted">-</span>}</td>
                      <td>{product ? product.unit || "-" : <span className="cell-muted">-</span>}</td>
                      <td>
                        <input
                          type="number"
                          step="1"
                          value={row.quantity}
                          onChange={(e) => setItem(idx, { quantity: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.unitPrice}
                          onChange={(e) => setItem(idx, { unitPrice: e.target.value })}
                        />
                      </td>
                      <td className="line-total">¥{displayLineTotal.toFixed(2)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-small-outline"
                          onClick={() =>
                            setForm((prev) => ({ ...prev, items: prev.items.filter((item) => item.rowId !== row.rowId) }))
                          }
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className={`warning-text${stockWarningText ? "" : " hidden"}`}>{stockWarningText}</div>

            <div className="item-summary-row">
              <span>
                {form.type === "out" && outSplitPreview.hasNegative ? "拆单总额预览" : "明细汇总"}：
                <strong>¥{lineTotal.toFixed(2)}</strong>
              </span>
              <span className={`hint-text${autoAmountFromDetail && amountManualOverride ? "" : " hidden"}`}>已手工覆盖金额</span>
            </div>
            <small className={`muted-text${form.type === "out" && outSplitPreview.hasNegative ? "" : " hidden"}`}>
              自动拆分预览：出库 ¥{outSplitPreview.positiveAmount.toFixed(2)}，销售退货 ¥{outSplitPreview.returnAmount.toFixed(2)}。
            </small>
          </div>
        ) : null}

        <div className="form-group">
          <label>金额</label>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.amount}
            readOnly={(form.type === "out" && outSplitPreview.hasNegative) || (isInboundType && inboundSplitPreview.hasNegative)}
            onChange={(e) => {
              if ((form.type === "out" && outSplitPreview.hasNegative) || (isInboundType && inboundSplitPreview.hasNegative))
                return;
              setForm((prev) => ({ ...prev, amount: e.target.value }));
              if (autoAmountFromDetail) setAmountManualOverride(true);
            }}
          />
          <small className="muted-text">{amountModeHint}</small>
        </div>

        <div className="form-group">
          <label>记账日期</label>
          <input
            type="date"
            value={form.bookkeepingDate}
            onChange={(e) => setForm((prev) => ({ ...prev, bookkeepingDate: e.target.value }))}
          />
        </div>

        <div className="form-group">
          <label>备注</label>
          <input value={form.remark} onChange={(e) => setForm((prev) => ({ ...prev, remark: e.target.value }))} />
        </div>

        <button type="button" className="btn btn-primary" onClick={() => submit(false)} disabled={createMutation.isPending}>
          {createMutation.isPending ? "保存中..." : "确认登记"}
        </button>
      </div>

      <div className="card">
        <div className="recent-bookkeeping-header">
          <h3>最近记账</h3>
          <div className="recent-bookkeeping-actions">
            <label className="recent-bookkeeping-sort">
              <span>排序依据</span>
              <select value={recentSortBy} onChange={(e) => setRecentSortBy(e.target.value)}>
                <option value="recordedAt">记账时间（默认）</option>
                <option value="id">ID</option>
                <option value="bookkeepingDate">记账日期</option>
                <option value="transactionDate">交易日期</option>
                <option value="amount">金额</option>
                <option value="type">类型</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-outline btn-compact"
              onClick={() => setRecentSortDir((prev) => (prev === "desc" ? "asc" : "desc"))}
            >
              {recentSortDir === "desc" ? "降序" : "升序"}
            </button>
            <button type="button" className="btn btn-outline btn-compact" onClick={clearRecentBookkeepingView}>
              一键清空最近记账
            </button>
            {recentClearedMarker ? (
              <button type="button" className="btn btn-outline btn-compact" onClick={restoreRecentBookkeepingView}>
                恢复显示
              </button>
            ) : null}
          </div>
        </div>
        <small className="muted-text recent-bookkeeping-meta">
          最多显示最近记账 {RECENT_BOOKKEEPING_LIMIT} 条（清空仅影响本模块展示）。
        </small>
        <table className="fixed-table tx-recent-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>记账日期</th>
              <th>交易日期</th>
              <th>交易对象</th>
              <th>类型</th>
              <th>金额</th>
              <th>单据号</th>
              <th>交易明细</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedRecentBookkeeping.map((t) => (
              <tr key={t.id}>
                <td>{t.id}</td>
                <td>{t.bookkeepingDate}</td>
                <td>{t.transactionDate}</td>
                <td>{partnerNameMap.get(Number(t.partnerId)) || `对象#${t.partnerId}`}</td>
                <td>{typeLabel(t.type)}</td>
                <td>{Number(t.amount || 0).toFixed(2)}</td>
                <td>{t.slipBook && t.slipNo ? `${t.slipBook}-${t.slipNo}` : "-"}</td>
                <td>{formatTransactionSummary(t)}</td>
                <td>{t.remark || "-"}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-small-outline"
                    onClick={() => deleteRecentTransaction(t)}
                    disabled={deleteTransactionMutation.isPending && pendingDeleteTxId === Number(t.id)}
                  >
                    {deleteTransactionMutation.isPending && pendingDeleteTxId === Number(t.id) ? "删除中..." : "删除"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
