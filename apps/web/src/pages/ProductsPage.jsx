import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";

function createEmptyProductForm() {
  return {
    name: "",
    sku: "",
    spec: "",
    unit: "",
    defaultUnitPrice: ""
  };
}

function createPayloadFromForm(form) {
  return {
    name: String(form.name || "").trim(),
    sku: String(form.sku || "").trim() || null,
    spec: String(form.spec || "").trim() || null,
    unit: String(form.unit || "").trim(),
    defaultUnitPrice: Number(form.defaultUnitPrice || 0)
  };
}

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [pendingToggleId, setPendingToggleId] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [nameKeyword, setNameKeyword] = useState("");
  const [form, setForm] = useState(createEmptyProductForm());
  const [editModal, setEditModal] = useState({
    open: false,
    form: createEmptyProductForm(),
    id: null
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

  const filteredProducts = useMemo(() => {
    const rows = productsQuery.data || [];
    const keyword = String(nameKeyword || "").trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((p) => String(p.name || "").toLowerCase().includes(keyword));
  }, [productsQuery.data, nameKeyword]);

  const createMutation = useMutation({
    mutationFn: async (payload) =>
      apiRequest("/products", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      setForm(createEmptyProductForm());
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }) =>
      apiRequest(`/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      setEditModal({
        open: false,
        form: createEmptyProductForm(),
        id: null
      });
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

  const deleteMutation = useMutation({
    mutationFn: async (id) =>
      apiRequest(`/products/${id}`, {
        method: "DELETE"
      }),
    onSuccess: () => {
      setPendingDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: () => {
      setPendingDeleteId(null);
    }
  });

  async function addProduct() {
    const payload = createPayloadFromForm(form);

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

  function openEditModal(product) {
    setEditModal({
      open: true,
      id: product.id,
      form: {
        name: product.name || "",
        sku: product.sku || "",
        spec: product.spec || "",
        unit: product.unit || "",
        defaultUnitPrice: String(Number(product.defaultUnitPrice || 0))
      }
    });
  }

  function closeEditModal() {
    setEditModal({
      open: false,
      form: createEmptyProductForm(),
      id: null
    });
  }

  function setEditFormField(key, value) {
    setEditModal((prev) => ({
      ...prev,
      form: {
        ...prev.form,
        [key]: value
      }
    }));
  }

  async function saveEditProduct() {
    const productId = Number(editModal.id || 0);
    if (!productId) return;

    const payload = createPayloadFromForm(editModal.form);
    if (!payload.name || !payload.unit) {
      window.alert("请完整填写产品名称和单位");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: productId,
        payload
      });
      window.alert("产品已更新");
    } catch (error) {
      window.alert(error.message || "更新产品失败");
    }
  }

  async function deleteProduct(product) {
    const ok = window.confirm(`确认删除产品「${product.name}」？\n无历史记录才可删除。`);
    if (!ok) return;
    setPendingDeleteId(product.id);
    try {
      await deleteMutation.mutateAsync(product.id);
      window.alert("产品已删除");
    } catch (error) {
      window.alert(error.message || "删除产品失败");
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
        <div className="section-title-row">
          <h3>产品列表</h3>
        </div>
        <div className="inline-row">
          <input
            type="text"
            placeholder="按名称检索产品"
            value={nameKeyword}
            onChange={(e) => setNameKeyword(e.target.value)}
          />
          <span className="muted-text">匹配 {filteredProducts.length} / {(productsQuery.data || []).length} 条</span>
        </div>
        {productsQuery.isLoading || inventoryQuery.isLoading ? <p>加载中...</p> : null}
        {productsQuery.isError ? <p className="error-text">{productsQuery.error.message}</p> : null}
        {inventoryQuery.isError ? <p className="error-text">{inventoryQuery.error.message}</p> : null}

        <table id="product-table" className="fixed-table product-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>编码</th>
              <th>规格</th>
              <th>单位</th>
              <th>默认单价</th>
              <th>当前库存</th>
              <th>状态</th>
              <th>流水明细状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p) => (
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
                  <span className={p.deletable ? "status-chip" : "status-chip status-chip-inactive"}>
                    {p.deletable ? "可删" : "不可删"}
                  </span>
                </td>
                <td>
                  <button className="btn btn-small-outline" onClick={() => openEditModal(p)}>
                    编辑
                  </button>
                  <button
                    className="btn btn-small-outline"
                    onClick={() => deleteProduct(p)}
                    disabled={(deleteMutation.isPending && pendingDeleteId === p.id) || !p.deletable}
                    title={p.deletable ? "删除产品" : "该产品已参与流水明细，不可删除"}
                  >
                    {deleteMutation.isPending && pendingDeleteId === p.id ? "删除中..." : "删除"}
                  </button>
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

      <div className={`modal${editModal.open ? "" : " hidden"}`} onClick={(e) => e.target === e.currentTarget && closeEditModal()}>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="product-edit-title">
          <h3 id="product-edit-title">编辑产品</h3>
          <div className="modal-grid">
            <div className="form-group">
              <label>产品名称</label>
              <input value={editModal.form.name} onChange={(e) => setEditFormField("name", e.target.value)} />
            </div>
            <div className="form-group">
              <label>产品编码 (选填)</label>
              <input value={editModal.form.sku} onChange={(e) => setEditFormField("sku", e.target.value)} />
            </div>
            <div className="form-group">
              <label>规格 (选填)</label>
              <input value={editModal.form.spec} onChange={(e) => setEditFormField("spec", e.target.value)} />
            </div>
            <div className="form-group">
              <label>单位</label>
              <input value={editModal.form.unit} onChange={(e) => setEditFormField("unit", e.target.value)} />
            </div>
            <div className="form-group">
              <label>默认单价</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={editModal.form.defaultUnitPrice}
                onChange={(e) => setEditFormField("defaultUnitPrice", e.target.value)}
              />
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn" onClick={closeEditModal}>
              取消
            </button>
            <button className="btn btn-primary" onClick={saveEditProduct} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "保存中..." : "保存修改"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
