import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [pendingToggleId, setPendingToggleId] = useState(null);
  const [form, setForm] = useState({
    name: "",
    sku: "",
    spec: "",
    unit: "",
    defaultUnitPrice: ""
  });

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await apiRequest("/products")).data
  });
  const inventoryQuery = useQuery({
    queryKey: ["inventory"],
    queryFn: async () => (await apiRequest("/inventory/overview")).data
  });

  const stockByProductId = useMemo(() => {
    const map = new Map();
    for (const row of inventoryQuery.data || []) {
      map.set(Number(row.id), Number(row.stock || 0));
    }
    return map;
  }, [inventoryQuery.data]);

  const createMutation = useMutation({
    mutationFn: async (payload) =>
      apiRequest("/products", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      setForm({ name: "", sku: "", spec: "", unit: "", defaultUnitPrice: "" });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    }
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }) =>
      apiRequest(`/products/${id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ active })
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setPendingToggleId(null);
    },
    onError: () => {
      setPendingToggleId(null);
    }
  });

  async function addProduct() {
    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      spec: form.spec.trim() || null,
      unit: form.unit.trim(),
      defaultUnitPrice: Number(form.defaultUnitPrice || 0)
    };

    if (!payload.name || !payload.unit) {
      window.alert("请完整填写产品名称和单位");
      return;
    }

    try {
      await createMutation.mutateAsync(payload);
    } catch (error) {
      window.alert(error.message || "保存产品失败");
    }
  }

  async function toggleProductActive(product) {
    setPendingToggleId(product.id);
    try {
      await toggleMutation.mutateAsync({ id: product.id, active: !product.active });
    } catch (error) {
      window.alert(error.message || "更新产品状态失败");
    }
  }

  return (
    <section>
      <div className="header-row">
        <h1>产品管理</h1>
      </div>

      <div className="card">
        <h3>新增产品</h3>
        <div className="product-form-grid">
          <input
            placeholder="产品名称"
            value={form.name}
            onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
          />
          <input
            placeholder="产品编码 (选填)"
            value={form.sku}
            onChange={(e) => setForm((v) => ({ ...v, sku: e.target.value }))}
          />
          <input
            placeholder="规格 (选填)"
            value={form.spec}
            onChange={(e) => setForm((v) => ({ ...v, spec: e.target.value }))}
          />
          <input placeholder="单位 (如: 件)" value={form.unit} onChange={(e) => setForm((v) => ({ ...v, unit: e.target.value }))} />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="默认单价"
            value={form.defaultUnitPrice}
            onChange={(e) => setForm((v) => ({ ...v, defaultUnitPrice: e.target.value }))}
          />
          <button
            className="btn btn-primary"
            onClick={addProduct}
            disabled={!form.name.trim() || !form.unit.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "保存中..." : "保存产品"}
          </button>
        </div>
      </div>

      <div className="card">
        {productsQuery.isLoading || inventoryQuery.isLoading ? <p>加载中...</p> : null}
        {productsQuery.isError ? <p className="error-text">{productsQuery.error.message}</p> : null}
        {inventoryQuery.isError ? <p className="error-text">{inventoryQuery.error.message}</p> : null}

        <table id="product-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>编码</th>
              <th>规格</th>
              <th>单位</th>
              <th>默认单价</th>
              <th>当前库存</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {(productsQuery.data || []).map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.sku || <span className="cell-muted">-</span>}</td>
                <td>{p.spec || <span className="cell-muted">-</span>}</td>
                <td>{p.unit}</td>
                <td>¥{Number(p.defaultUnitPrice || 0).toFixed(2)}</td>
                <td className={Number(stockByProductId.get(Number(p.id)) || 0) < 0 ? "negative-stock" : Number(stockByProductId.get(Number(p.id)) || 0) > 0 ? "positive-stock" : ""}>
                  {Number(stockByProductId.get(Number(p.id)) || 0)}
                </td>
                <td>
                  <span className={p.active ? "status-chip" : "status-chip status-chip-inactive"}>
                    {p.active ? "启用" : "停用"}
                  </span>
                </td>
                <td>
                  <button
                    className="btn btn-small-outline"
                    onClick={() => toggleProductActive(p)}
                    disabled={toggleMutation.isPending && pendingToggleId === p.id}
                  >
                    {toggleMutation.isPending && pendingToggleId === p.id ? "处理中..." : p.active ? "停用" : "启用"}
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
