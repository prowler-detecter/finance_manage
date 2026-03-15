import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";

const STOCK_TYPES = ["out", "in", "sale_return", "purchase_return"];

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

function expectedPartnerType(type) {
  if (["out", "sale_return", "receive"].includes(type)) return "customer";
  if (["in", "purchase_return", "pay"].includes(type)) return "supplier";
  return "";
}

export default function TransactionsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    type: "out",
    partnerId: "",
    transactionDate: today(),
    bookkeepingDate: today(),
    amount: "",
    remark: "",
    slipBook: "",
    slipNo: "",
    items: [{ productId: "", quantity: 1, unitPrice: 0 }]
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

  const filteredPartners = useMemo(() => {
    const expect = expectedPartnerType(form.type);
    return (partnersQuery.data || []).filter((p) => !expect || p.type === expect);
  }, [form.type, partnersQuery.data]);

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
        slipBook: "",
        slipNo: "",
        items: [{ productId: "", quantity: 1, unitPrice: 0 }]
      }));
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    }
  });

  const isStockType = STOCK_TYPES.includes(form.type);
  const lineTotal = form.items.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.unitPrice || 0), 0);

  async function submit(force = false) {
    const payload = {
      type: form.type,
      partnerId: Number(form.partnerId),
      transactionDate: form.transactionDate,
      bookkeepingDate: form.bookkeepingDate,
      amount: Number(form.amount || (lineTotal > 0 ? lineTotal : 0)),
      computedAmount: lineTotal > 0 ? lineTotal : 0,
      remark: form.remark || null,
      slipBook: form.slipBook || null,
      slipNo: form.slipNo ? Number(form.slipNo) : null,
      force
    };

    if (isStockType) {
      payload.items = form.items
        .filter((r) => Number(r.productId) > 0)
        .map((r) => ({
          productId: Number(r.productId),
          quantity: Number(r.quantity),
          unitPrice: Number(r.unitPrice),
          lineAmount: Number(r.quantity) * Number(r.unitPrice)
        }));
    }

    try {
      await createMutation.mutateAsync(payload);
    } catch (error) {
      if (error.status === 409 && Array.isArray(error.body?.warnings)) {
        const text = `系统提示以下风险：\n- ${error.body.warnings.join("\n- ")}\n\n是否继续保存？`;
        if (window.confirm(text)) {
          await submit(true);
        }
      } else {
        window.alert(error.message || "保存失败");
      }
    }
  }

  function setItem(index, patch) {
    setForm((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], ...patch };
      return { ...prev, items };
    });
  }

  return (
    <section>
      <h1>记账登记</h1>
      <div className="card">
        <div className="grid-4">
          <label>
            交易类型
            <select value={form.type} onChange={(e) => setForm((v) => ({ ...v, type: e.target.value, partnerId: "" }))}>
              <option value="out">出库</option>
              <option value="in">入库</option>
              <option value="sale_return">销售退货</option>
              <option value="purchase_return">采购退货</option>
              <option value="receive">收款</option>
              <option value="pay">付款</option>
            </select>
          </label>
          <label>
            对象
            <select value={form.partnerId} onChange={(e) => setForm((v) => ({ ...v, partnerId: e.target.value }))}>
              <option value="">请选择</option>
              {filteredPartners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.type === "customer" ? "客户" : "供应商"}）
                </option>
              ))}
            </select>
          </label>
          <label>
            交易日期
            <input
              type="date"
              value={form.transactionDate}
              onChange={(e) => setForm((v) => ({ ...v, transactionDate: e.target.value }))}
            />
          </label>
          <label>
            记账日期
            <input
              type="date"
              value={form.bookkeepingDate}
              onChange={(e) => setForm((v) => ({ ...v, bookkeepingDate: e.target.value }))}
            />
          </label>
        </div>

        {(form.type === "out" || form.type === "in") && (
          <div className="grid-4">
            <label>
              单据簿号
              <input value={form.slipBook} onChange={(e) => setForm((v) => ({ ...v, slipBook: e.target.value }))} />
            </label>
            <label>
              单据号
              <input
                type="number"
                min="1"
                value={form.slipNo}
                onChange={(e) => setForm((v) => ({ ...v, slipNo: e.target.value }))}
              />
            </label>
          </div>
        )}

        {isStockType && (
          <div className="card-inner">
            <h4>产品明细</h4>
            {form.items.map((row, idx) => (
              <div key={idx} className="grid-4">
                <select value={row.productId} onChange={(e) => setItem(idx, { productId: e.target.value })}>
                  <option value="">请选择产品</option>
                  {(productsQuery.data || [])
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}（{p.sku || "无编码"}）
                      </option>
                    ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={row.quantity}
                  onChange={(e) => setItem(idx, { quantity: Number(e.target.value || 1) })}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.unitPrice}
                  onChange={(e) => setItem(idx, { unitPrice: Number(e.target.value || 0) })}
                />
                <div className="line-total">{(Number(row.quantity) * Number(row.unitPrice)).toFixed(2)}</div>
              </div>
            ))}
            <div className="row">
              <button
                className="btn btn-outline"
                onClick={() => setForm((v) => ({ ...v, items: [...v.items, { productId: "", quantity: 1, unitPrice: 0 }] }))}
              >
                + 添加一行
              </button>
              <div>明细汇总：¥{lineTotal.toFixed(2)}</div>
            </div>
          </div>
        )}

        <div className="grid-3">
          <label>
            金额
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((v) => ({ ...v, amount: e.target.value }))}
            />
          </label>
          <label className="grow-2">
            备注
            <input value={form.remark} onChange={(e) => setForm((v) => ({ ...v, remark: e.target.value }))} />
          </label>
        </div>

        <button className="btn btn-primary" onClick={() => submit(false)} disabled={createMutation.isPending}>
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
