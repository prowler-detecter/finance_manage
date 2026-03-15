import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    productId: "",
    mode: "set",
    quantity: "",
    bizDate: today(),
    remark: ""
  });

  const inventoryQuery = useQuery({
    queryKey: ["inventory"],
    queryFn: async () => (await apiRequest("/inventory/overview")).data
  });

  const saveMutation = useMutation({
    mutationFn: async (payload) =>
      apiRequest("/stock-adjustments", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setForm((v) => ({
        ...v,
        quantity: "",
        remark: ""
      }));
    }
  });

  return (
    <section>
      <h1>库存管理</h1>

      <div className="card">
        <h3>盘点/调整</h3>
        <div className="grid-5">
          <select value={form.productId} onChange={(e) => setForm((v) => ({ ...v, productId: e.target.value }))}>
            <option value="">请选择产品</option>
            {(inventoryQuery.data || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（当前 {p.stock}）
              </option>
            ))}
          </select>
          <select value={form.mode} onChange={(e) => setForm((v) => ({ ...v, mode: e.target.value }))}>
            <option value="set">实盘覆写</option>
            <option value="delta">增减调整</option>
          </select>
          <input
            type="number"
            step="1"
            value={form.quantity}
            placeholder={form.mode === "set" ? "实盘数量" : "增减数量"}
            onChange={(e) => setForm((v) => ({ ...v, quantity: e.target.value }))}
          />
          <input type="date" value={form.bizDate} onChange={(e) => setForm((v) => ({ ...v, bizDate: e.target.value }))} />
          <input value={form.remark} placeholder="备注" onChange={(e) => setForm((v) => ({ ...v, remark: e.target.value }))} />
        </div>
        <button
          className="btn btn-primary"
          onClick={() =>
            saveMutation.mutate({
              productId: Number(form.productId),
              mode: form.mode,
              quantity: Number(form.quantity),
              bizDate: form.bizDate,
              remark: form.remark
            })
          }
          disabled={!form.productId || form.quantity === "" || saveMutation.isPending}
        >
          {saveMutation.isPending ? "提交中..." : "保存调整"}
        </button>
      </div>

      <div className="card">
        <h3>库存总览</h3>
        {inventoryQuery.isLoading ? <p>加载中...</p> : null}
        {inventoryQuery.isError ? <p className="error-text">{inventoryQuery.error.message}</p> : null}
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>编码</th>
              <th>库存</th>
              <th>最近业务日期</th>
              <th>类型备注</th>
              <th>依据摘要</th>
            </tr>
          </thead>
          <tbody>
            {(inventoryQuery.data || []).map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.sku || "-"}</td>
                <td>{p.stock}</td>
                <td>{p.latestBusinessDate || "-"}</td>
                <td>{p.latestBusinessType || "-"}</td>
                <td>{p.basisSummary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
