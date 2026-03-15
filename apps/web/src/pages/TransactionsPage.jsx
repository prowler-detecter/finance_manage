import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";

const STOCK_TYPES = ["out", "in", "sale_return", "purchase_return"];
const DECREASE_STOCK_TYPES = ["out", "purchase_return"];
const RETURN_TYPES = ["sale_return", "purchase_return"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function typeLabel(type) {
  if (type === "out") return "出库";
  if (type === "in") return "入库";
  if (type === "sale_return") return "销售退货";
  if (type === "purchase_return") return "采购退货";
  if (type === "receive") return "收款";
  if (type === "pay") return "付款";
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

function isReturnType(type) {
  return RETURN_TYPES.includes(type);
}

function needsWarehouseSlip(type) {
  return type === "out" || type === "in";
}

function expectedPartnerType(type) {
  if (["out", "sale_return", "receive"].includes(type)) return "customer";
  if (["in", "purchase_return", "pay"].includes(type)) return "supplier";
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

function getPreferredSlipBook(transactions, type, partnerId) {
  const rows = (transactions || [])
    .filter((tx) => tx.type === type && Number(tx.partnerId) === Number(partnerId) && normalizeSlipBook(tx.slipBook))
    .sort(compareTxDesc);

  return rows.length > 0 ? normalizeSlipBook(rows[0].slipBook) : "";
}

function getNextSlipNo(transactions, type, slipBook) {
  const key = normalizeSlipBookKey(slipBook);
  if (!key) return 1;

  let maxNo = 0;
  for (const tx of transactions || []) {
    if (tx.type !== type) continue;
    if (normalizeSlipBookKey(tx.slipBook) !== key) continue;
    const no = Number(tx.slipNo || 0);
    if (Number.isInteger(no) && no > maxNo) maxNo = no;
  }
  return maxNo > 0 ? maxNo + 1 : 1;
}

function formatItemSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return "无产品明细";
  const parts = items.slice(0, 2).map((item) => {
    const name = item?.productSnapshot?.name || "产品";
    return `${name} x${Number(item.quantity || 0)}`;
  });
  if (items.length > 2) return `${parts.join("，")} 等${items.length}项`;
  return parts.join("，");
}

function buildSourceTransactionLabel(transaction) {
  const slip = transaction.slipBook && transaction.slipNo ? `${transaction.slipBook}-${transaction.slipNo}` : "";
  const slipPrefix = slip ? `${slip} | ` : "";
  return `${slipPrefix}${transaction.transactionDate} | ${formatItemSummary(transaction.items)} | ¥${Number(
    transaction.amount || 0
  ).toFixed(2)} | ID:${transaction.id}`;
}

export default function TransactionsPage() {
  const queryClient = useQueryClient();
  const autoFillContextRef = useRef("");

  const [form, setForm] = useState({
    type: "out",
    partnerId: "",
    transactionDate: today(),
    bookkeepingDate: today(),
    amount: "",
    sourceTransactionId: "",
    sourceRef: "",
    remark: "",
    slipBook: "",
    slipNo: "",
    items: [createItemRow()]
  });

  const [amountManualOverride, setAmountManualOverride] = useState(false);
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState({
    name: "",
    sku: "",
    spec: "",
    unit: "",
    defaultUnitPrice: ""
  });

  const partnersQuery = useQuery({
    queryKey: ["partners"],
    queryFn: async () => (await apiRequest("/partners")).data
  });

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await apiRequest("/products")).data
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

  const inventoryMap = useMemo(() => {
    const map = new Map();
    for (const item of inventoryQuery.data || []) {
      map.set(Number(item.id), Number(item.stock || 0));
    }
    return map;
  }, [inventoryQuery.data]);

  const sourceTransactions = useMemo(() => {
    if (!isReturnType(form.type) || !form.partnerId) return [];
    const sourceType = form.type === "sale_return" ? "out" : "in";
    return (transactionsQuery.data || [])
      .filter((tx) => Number(tx.partnerId) === Number(form.partnerId) && tx.type === sourceType)
      .sort(compareTxDesc);
  }, [form.type, form.partnerId, transactionsQuery.data]);

  const slipHint = useMemo(() => {
    if (!needsWarehouseSlip(form.type)) return "";

    const slipBook = normalizeSlipBook(form.slipBook);
    const slipNoText = String(form.slipNo || "").trim();

    if (!slipBook && !slipNoText) return "出库/入库单号可选填；填写后系统可提示顺号。";
    if (!slipBook && slipNoText) return "如填写单据号，请同时填写单据簿号。";

    const nextNo = getNextSlipNo(transactionsQuery.data || [], form.type, slipBook);
    if (!slipNoText) return `当前簿号 [${slipBook}] 建议下一号：${nextNo}。`;

    const slipNo = Number(slipNoText);
    if (!Number.isInteger(slipNo) || slipNo <= 0) return "单据号需为正整数。";
    if (slipNo === nextNo) return `单据号顺序正常，当前为建议下一号 ${nextNo}。`;
    if (slipNo > nextNo) return `当前输入 ${slipNo}，跳过了建议下一号 ${nextNo}（允许，但请确认）。`;
    return `当前输入 ${slipNo} 小于已使用最大号，若继续使用可能重复。`;
  }, [form.type, form.slipBook, form.slipNo, transactionsQuery.data]);

  const isStockType = STOCK_TYPES.includes(form.type);

  const lineTotal = useMemo(() => {
    return form.items.reduce((sum, row) => {
      const productId = Number(row.productId || 0);
      const qty = Number(row.quantity || 0);
      const price = Number(row.unitPrice || 0);
      if (productId > 0 && qty > 0 && price >= 0) return sum + qty * price;
      return sum;
    }, 0);
  }, [form.items]);

  const amountModeHint = useMemo(() => {
    if (needsWarehouseSlip(form.type)) return "出库/入库可选登记单据簿号与单据号，金额默认由产品明细汇总。";
    if (isReturnType(form.type)) return "退货金额默认由产品明细汇总，可选关联原交易并填写原单号。";
    if (isStockType) return "金额默认由产品明细自动汇总，可手工修改覆盖。";
    return "收款/付款无需录入产品明细。";
  }, [form.type, isStockType]);

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
    if (!isStockType || amountManualOverride) return;
    setForm((prev) => ({ ...prev, amount: lineTotal > 0 ? lineTotal.toFixed(2) : "" }));
  }, [lineTotal, amountManualOverride, isStockType]);

  useEffect(() => {
    setAmountManualOverride(false);
  }, [form.type]);

  useEffect(() => {
    if (isReturnType(form.type)) return;
    setForm((prev) => ({ ...prev, sourceTransactionId: "", sourceRef: "" }));
  }, [form.type]);

  useEffect(() => {
    if (needsWarehouseSlip(form.type)) return;
    autoFillContextRef.current = "";
    setForm((prev) => ({ ...prev, slipBook: "", slipNo: "" }));
  }, [form.type]);

  useEffect(() => {
    if (!needsWarehouseSlip(form.type) || !form.partnerId) return;
    if (normalizeSlipBook(form.slipBook)) return;

    const preferredBook = getPreferredSlipBook(transactionsQuery.data || [], form.type, Number(form.partnerId));
    if (!preferredBook) return;

    const contextKey = `${form.type}|${form.partnerId}|${preferredBook}`;
    if (autoFillContextRef.current === contextKey) return;
    autoFillContextRef.current = contextKey;

    setForm((prev) => ({
      ...prev,
      slipBook: preferredBook,
      slipNo: prev.slipNo || String(getNextSlipNo(transactionsQuery.data || [], prev.type, preferredBook))
    }));
  }, [form.type, form.partnerId, form.slipBook, transactionsQuery.data]);

  useEffect(() => {
    if (!isStockType) return;
    if (form.items.length > 0) return;
    setForm((prev) => ({ ...prev, items: [createItemRow()] }));
  }, [isStockType, form.items.length]);

  const createMutation = useMutation({
    mutationFn: async (payload) =>
      apiRequest("/transactions", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      setForm((prev) => ({
        ...prev,
        amount: "",
        remark: "",
        sourceTransactionId: "",
        sourceRef: "",
        slipBook: "",
        slipNo: "",
        items: [createItemRow()]
      }));
      setAmountManualOverride(false);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
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
          unitPrice:
            current.unitPrice || current.unitPrice === 0 ? String(current.unitPrice) : Number(created.defaultUnitPrice).toFixed(2)
        };

        return { ...prev, items: nextItems };
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
          if (!String(nextRow.unitPrice || "").trim() || Number(nextRow.unitPrice) === 0) {
            nextRow.unitPrice = Number(product.defaultUnitPrice).toFixed(2);
          }
        }
      }

      items[index] = nextRow;
      return { ...prev, items };
    });
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

  async function submit(force = false) {
    if (!form.partnerId || !form.transactionDate || !form.bookkeepingDate) {
      window.alert("请填写完整信息");
      return;
    }

    const slipBook = normalizeSlipBook(form.slipBook);
    const slipNoText = String(form.slipNo || "").trim();

    if (needsWarehouseSlip(form.type) && ((slipBook && !slipNoText) || (!slipBook && slipNoText))) {
      window.alert("如需填写单号，请同时填写单据簿号和单据号");
      return;
    }

    if (slipNoText) {
      const slipNo = Number(slipNoText);
      if (!Number.isInteger(slipNo) || slipNo <= 0) {
        window.alert("单据号必须为正整数");
        return;
      }
    }

    const productById = new Map((productsQuery.data || []).map((p) => [Number(p.id), p]));
    const validItems = [];

    if (isStockType) {
      for (let i = 0; i < form.items.length; i += 1) {
        const row = form.items[i];
        const productId = Number(row.productId || 0);
        const quantity = Number(row.quantity || 0);
        const unitPrice = Number(row.unitPrice || 0);
        const isEmpty = !productId && !String(row.quantity || "").trim() && !String(row.unitPrice || "").trim();
        if (isEmpty) continue;

        if (!productId) {
          window.alert(`第 ${i + 1} 行请选择产品`);
          return;
        }

        if (!Number.isInteger(quantity) || quantity <= 0) {
          window.alert(`第 ${i + 1} 行数量必须为正整数`);
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

        validItems.push({
          productId,
          quantity,
          unitPrice,
          lineAmount: quantity * unitPrice
        });
      }

      if (validItems.length === 0) {
        window.alert("涉及库存的交易至少需要填写 1 行有效产品明细");
        return;
      }
    }

    const computedAmount = validItems.reduce((sum, item) => sum + Number(item.lineAmount || 0), 0);
    const finalAmount = Number(form.amount || (computedAmount > 0 ? computedAmount : 0));

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
      computedAmount: isStockType ? computedAmount : 0,
      remark: form.remark || null,
      sourceTransactionId: form.sourceTransactionId ? Number(form.sourceTransactionId) : null,
      sourceRef: form.sourceRef || null,
      slipBook: slipBook || null,
      slipNo: slipNoText ? Number(slipNoText) : null,
      force
    };

    if (isStockType) payload.items = validItems;

    try {
      await createMutation.mutateAsync(payload);
    } catch (error) {
      if (error.status === 409 && Array.isArray(error.body?.warnings)) {
        const text = `系统提示以下风险：\n- ${error.body.warnings.join("\n- ")}\n\n是否继续保存？`;
        if (window.confirm(text)) await submit(true);
      } else {
        window.alert(error.message || "保存失败");
      }
    }
  }

  return (
    <section>
      <h1>记账登记</h1>
      <div className="card card-narrow">
        <div className="form-group">
          <label>交易类型</label>
          <select
            value={form.type}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                type: e.target.value,
                partnerId: "",
                sourceTransactionId: "",
                sourceRef: ""
              }))
            }
          >
            <option value="out">出库 (销售 - 别人欠我们)</option>
            <option value="in">入库 (采购 - 我们欠别人)</option>
            <option value="sale_return">销售退货 (客户向我们退货)</option>
            <option value="purchase_return">采购退货 (我们向供应商退货)</option>
            <option value="receive">收款 (别人还钱)</option>
            <option value="pay">付款 (我们还钱)</option>
          </select>
        </div>

        <div className="form-group">
          <label>选择客户/供应商</label>
          <select value={form.partnerId} onChange={(e) => setForm((prev) => ({ ...prev, partnerId: e.target.value }))}>
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
                    : "当前对象暂无可关联的历史交易，可直接填写原单号。"
                  : "请先选择客户/供应商，再选择可关联的历史交易。"}
              </small>
            </div>
            <div className="form-group">
              <label>原单号/外部单号 (可选)</label>
              <input
                type="text"
                placeholder="例如：SO2026-001"
                value={form.sourceRef}
                onChange={(e) => setForm((prev) => ({ ...prev, sourceRef: e.target.value }))}
              />
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
            <small className="muted-text">{slipHint}</small>
          </div>
        ) : null}

        {isStockType ? (
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
                  const qty = Number(row.quantity || 0);
                  const price = Number(row.unitPrice || 0);

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
                          min="1"
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
                      <td className="line-total">¥{(qty * price).toFixed(2)}</td>
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
                明细汇总：<strong>¥{lineTotal.toFixed(2)}</strong>
              </span>
              <span className={`hint-text${isStockType && amountManualOverride ? "" : " hidden"}`}>已手工覆盖金额</span>
            </div>
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
            onChange={(e) => {
              setForm((prev) => ({ ...prev, amount: e.target.value }));
              if (isStockType) setAmountManualOverride(true);
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
        <h3>最近交易</h3>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>交易日期</th>
              <th>类型</th>
              <th>金额</th>
              <th>单据号</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {(transactionsQuery.data || []).slice(0, 20).map((t) => (
              <tr key={t.id}>
                <td>{t.id}</td>
                <td>{t.transactionDate}</td>
                <td>{typeLabel(t.type)}</td>
                <td>{Number(t.amount || 0).toFixed(2)}</td>
                <td>{t.slipBook && t.slipNo ? `${t.slipBook}-${t.slipNo}` : "-"}</td>
                <td>{t.remark || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
