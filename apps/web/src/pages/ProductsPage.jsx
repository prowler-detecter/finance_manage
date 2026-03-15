import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    sku: "",
    spec: "",
    unit: "",
    defaultUnitPrice: 0
  });

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await apiRequest("/products")).data
  });

  const createMutation = useMutation({
    mutationFn: async (payload) =>
      apiRequest("/products", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      setForm({ name: "", sku: "", spec: "", unit: "", defaultUnitPrice: 0 });
      queryClient.invalidateQueries({ queryKey: ["products"] });
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
    }
  });

  return (
    <section>
      <h1>产品管理</h1>
      <div className="card">
        <h3>新增产品</h3>
        <div className="grid-5">
          <input
            placeholder="名称"
            value={form.name}
            onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
          />
          <input placeholder="编码" value={form.sku} onChange={(e) => setForm((v) => ({ ...v, sku: e.target.value }))} />
          <input placeholder="规格" value={form.spec} onChange={(e) => setForm((v) => ({ ...v, spec: e.target.value }))} />
          <input placeholder="单位" value={form.unit} onChange={(e) => setForm((v) => ({ ...v, unit: e.target.value }))} />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="默认单价"
            value={form.defaultUnitPrice}
            onChange={(e) => setForm((v) => ({ ...v, defaultUnitPrice: Number(e.target.value) }))}
          />
        </div>
        <button
          className="btn btn-primary"
          onClick={() => createMutation.mutate(form)}
          disabled={!form.name || !form.unit || createMutation.isPending}
        >
          保存
        </button>
      </div>

      <div className="card">
        <h3>产品列表</h3>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th>编码</th>
              <th>规格</th>
              <th>单位</th>
              <th>默认单价</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {(productsQuery.data || []).map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.name}</td>
                <td>{p.sku || "-"}</td>
                <td>{p.spec || "-"}</td>
                <td>{p.unit}</td>
                <td>{Number(p.defaultUnitPrice || 0).toFixed(2)}</td>
                <td>{p.active ? "启用" : "停用"}</td>
                <td>
                  <button
                    className="btn btn-outline"
                    onClick={() => toggleMutation.mutate({ id: p.id, active: !p.active })}
                  >
                    {p.active ? "停用" : "启用"}
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
