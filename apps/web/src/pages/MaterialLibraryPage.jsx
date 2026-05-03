import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";

function createEmptyForm() {
  return {
    name: "",
    code: "",
    spec: "",
    unit: "",
    defaultUnitPrice: ""
  };
}

function createPayloadFromForm(form) {
  return {
    name: String(form.name || "").trim(),
    code: String(form.code || "").trim() || null,
    spec: String(form.spec || "").trim() || null,
    unit: String(form.unit || "").trim(),
    defaultUnitPrice: Number(form.defaultUnitPrice || 0)
  };
}

function endpointOf(type) {
  return type === "processing" ? "/processings" : "/materials";
}

function queryKeyOf(type) {
  return type === "processing" ? ["processings"] : ["materials"];
}

function labelOf(type) {
  return type === "processing" ? "加工项" : "物料";
}

export default function MaterialLibraryPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("material");
  const [nameKeyword, setNameKeyword] = useState("");
  const [pendingToggle, setPendingToggle] = useState({ type: "", id: null });
  const [pendingDelete, setPendingDelete] = useState({ type: "", id: null });
  const [forms, setForms] = useState({
    material: createEmptyForm(),
    processing: createEmptyForm()
  });
  const [editModal, setEditModal] = useState({
    open: false,
    type: "material",
    id: null,
    form: createEmptyForm()
  });

  const materialsQuery = useQuery({
    queryKey: ["materials"],
    queryFn: async () => (await apiRequest("/materials")).data
  });
  const processingsQuery = useQuery({
    queryKey: ["processings"],
    queryFn: async () => (await apiRequest("/processings")).data
  });

  const activeRows = activeTab === "processing" ? processingsQuery.data || [] : materialsQuery.data || [];
  const filteredRows = useMemo(() => {
    const keyword = String(nameKeyword || "").trim().toLowerCase();
    if (!keyword) return activeRows;
    return activeRows.filter((row) => String(row.name || "").toLowerCase().includes(keyword));
  }, [activeRows, nameKeyword]);

  async function invalidateTab(type) {
    await queryClient.invalidateQueries({ queryKey: queryKeyOf(type) });
  }

  const createMutation = useMutation({
    mutationFn: async ({ type, payload }) =>
      apiRequest(endpointOf(type), {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: async (_res, vars) => {
      setForms((prev) => ({
        ...prev,
        [vars.type]: createEmptyForm()
      }));
      await invalidateTab(vars.type);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ type, id, payload }) =>
      apiRequest(`${endpointOf(type)}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    onSuccess: async (_res, vars) => {
      setEditModal({
        open: false,
        type: "material",
        id: null,
        form: createEmptyForm()
      });
      await invalidateTab(vars.type);
    }
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ type, id, active }) =>
      apiRequest(`${endpointOf(type)}/${id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ active })
      }),
    onSuccess: async (_res, vars) => {
      setPendingToggle({ type: "", id: null });
      await invalidateTab(vars.type);
    },
    onError: () => {
      setPendingToggle({ type: "", id: null });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ type, id }) =>
      apiRequest(`${endpointOf(type)}/${id}`, {
        method: "DELETE"
      }),
    onSuccess: async (_res, vars) => {
      setPendingDelete({ type: "", id: null });
      await invalidateTab(vars.type);
    },
    onError: () => {
      setPendingDelete({ type: "", id: null });
    }
  });

  function setFormField(type, key, value) {
    setForms((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [key]: value
      }
    }));
  }

  async function createEntry(type) {
    const payload = createPayloadFromForm(forms[type]);
    if (!payload.name || !payload.unit) {
      window.alert(`请完整填写${labelOf(type)}名称和单位`);
      return;
    }

    try {
      await createMutation.mutateAsync({
        type,
        payload
      });
      window.alert(`${labelOf(type)}已保存`);
    } catch (error) {
      window.alert(error.message || `保存${labelOf(type)}失败`);
    }
  }

  function openEditModal(type, row) {
    setEditModal({
      open: true,
      type,
      id: row.id,
      form: {
        name: row.name || "",
        code: row.code || "",
        spec: row.spec || "",
        unit: row.unit || "",
        defaultUnitPrice: String(Number(row.defaultUnitPrice || 0))
      }
    });
  }

  function closeEditModal() {
    setEditModal({
      open: false,
      type: "material",
      id: null,
      form: createEmptyForm()
    });
  }

  function setEditField(key, value) {
    setEditModal((prev) => ({
      ...prev,
      form: {
        ...prev.form,
        [key]: value
      }
    }));
  }

  async function saveEdit() {
    const id = Number(editModal.id || 0);
    if (!id) return;

    const payload = createPayloadFromForm(editModal.form);
    if (!payload.name || !payload.unit) {
      window.alert(`请完整填写${labelOf(editModal.type)}名称和单位`);
      return;
    }

    try {
      await updateMutation.mutateAsync({
        type: editModal.type,
        id,
        payload
      });
      window.alert(`${labelOf(editModal.type)}已更新`);
    } catch (error) {
      window.alert(error.message || `更新${labelOf(editModal.type)}失败`);
    }
  }

  async function toggleActive(type, row) {
    setPendingToggle({ type, id: row.id });
    try {
      await toggleMutation.mutateAsync({
        type,
        id: row.id,
        active: !row.active
      });
    } catch (error) {
      window.alert(error.message || "更新状态失败");
    }
  }

  async function deleteEntry(type, row) {
    const ok = window.confirm(`确认删除${labelOf(type)}「${row.name}」？\n无历史明细引用才可删除。`);
    if (!ok) return;

    setPendingDelete({ type, id: row.id });
    try {
      await deleteMutation.mutateAsync({ type, id: row.id });
      window.alert(`${labelOf(type)}已删除`);
    } catch (error) {
      window.alert(error.message || `删除${labelOf(type)}失败`);
    }
  }

  const activeForm = forms[activeTab];
  const isLoading = materialsQuery.isLoading || processingsQuery.isLoading;
  const error = materialsQuery.error || processingsQuery.error;

  return (
    <section>
      <div className="header-row">
        <h1>物料/加工库管理</h1>
      </div>

      <div className="card">
        <div className="library-tabs">
          <button
            type="button"
            className={`btn btn-compact${activeTab === "material" ? " btn-primary" : " btn-outline"}`}
            onClick={() => setActiveTab("material")}
          >
            物料库
          </button>
          <button
            type="button"
            className={`btn btn-compact${activeTab === "processing" ? " btn-primary" : " btn-outline"}`}
            onClick={() => setActiveTab("processing")}
          >
            加工库
          </button>
        </div>

        <h3>新增{labelOf(activeTab)}</h3>
        <div className="product-form-grid">
          <input
            placeholder={`${labelOf(activeTab)}名称`}
            value={activeForm.name}
            onChange={(e) => setFormField(activeTab, "name", e.target.value)}
          />
          <input
            placeholder={`${labelOf(activeTab)}编码 (选填)`}
            value={activeForm.code}
            onChange={(e) => setFormField(activeTab, "code", e.target.value)}
          />
          <input
            placeholder="规格 (选填)"
            value={activeForm.spec}
            onChange={(e) => setFormField(activeTab, "spec", e.target.value)}
          />
          <input
            placeholder="单位 (如: 件/次)"
            value={activeForm.unit}
            onChange={(e) => setFormField(activeTab, "unit", e.target.value)}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="默认单价"
            value={activeForm.defaultUnitPrice}
            onChange={(e) => setFormField(activeTab, "defaultUnitPrice", e.target.value)}
          />
          <button
            className="btn btn-primary"
            onClick={() => createEntry(activeTab)}
            disabled={!activeForm.name.trim() || !activeForm.unit.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "保存中..." : `保存${labelOf(activeTab)}`}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>{activeTab === "material" ? "物料列表" : "加工列表"}</h3>
        <div className="inline-row">
          <input
            type="text"
            placeholder={`按名称检索${activeTab === "material" ? "物料" : "加工项"}`}
            value={nameKeyword}
            onChange={(e) => setNameKeyword(e.target.value)}
          />
          <span className="muted-text">
            匹配 {filteredRows.length} / {activeRows.length} 条
          </span>
        </div>
        {isLoading ? <p>加载中...</p> : null}
        {error ? <p className="error-text">{error.message}</p> : null}

        <table className="fixed-table product-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>编码</th>
              <th>规格</th>
              <th>单位</th>
              <th>默认单价</th>
              <th>状态</th>
              <th>流水明细状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const isToggling = toggleMutation.isPending && pendingToggle.type === activeTab && pendingToggle.id === row.id;
              const isDeleting = deleteMutation.isPending && pendingDelete.type === activeTab && pendingDelete.id === row.id;
              return (
                <tr key={`${activeTab}-${row.id}`}>
                  <td>{row.name}</td>
                  <td>{row.code || <span className="cell-muted">-</span>}</td>
                  <td>{row.spec || <span className="cell-muted">-</span>}</td>
                  <td>{row.unit}</td>
                  <td>¥{Number(row.defaultUnitPrice || 0).toFixed(2)}</td>
                  <td>
                    <span className={row.active ? "status-chip" : "status-chip status-chip-inactive"}>
                      {row.active ? "启用" : "停用"}
                    </span>
                  </td>
                  <td>
                    <span className={row.deletable ? "status-chip" : "status-chip status-chip-inactive"}>
                      {row.deletable ? "可删" : "不可删"}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-small-outline" onClick={() => openEditModal(activeTab, row)}>
                      编辑
                    </button>
                    <button
                      className="btn btn-small-outline"
                      onClick={() => deleteEntry(activeTab, row)}
                      disabled={isDeleting || !row.deletable}
                      title={row.deletable ? `删除${labelOf(activeTab)}` : `${labelOf(activeTab)}已参与流水明细，不可删除`}
                    >
                      {isDeleting ? "删除中..." : "删除"}
                    </button>
                    <button className="btn btn-small-outline" onClick={() => toggleActive(activeTab, row)} disabled={isToggling}>
                      {isToggling ? "处理中..." : row.active ? "停用" : "启用"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={`modal${editModal.open ? "" : " hidden"}`} onClick={(e) => e.target === e.currentTarget && closeEditModal()}>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="library-edit-title">
          <h3 id="library-edit-title">编辑{labelOf(editModal.type)}</h3>
          <div className="modal-grid">
            <div className="form-group">
              <label>{labelOf(editModal.type)}名称</label>
              <input value={editModal.form.name} onChange={(e) => setEditField("name", e.target.value)} />
            </div>
            <div className="form-group">
              <label>{labelOf(editModal.type)}编码 (选填)</label>
              <input value={editModal.form.code} onChange={(e) => setEditField("code", e.target.value)} />
            </div>
            <div className="form-group">
              <label>规格 (选填)</label>
              <input value={editModal.form.spec} onChange={(e) => setEditField("spec", e.target.value)} />
            </div>
            <div className="form-group">
              <label>单位</label>
              <input value={editModal.form.unit} onChange={(e) => setEditField("unit", e.target.value)} />
            </div>
            <div className="form-group">
              <label>默认单价</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={editModal.form.defaultUnitPrice}
                onChange={(e) => setEditField("defaultUnitPrice", e.target.value)}
              />
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn" onClick={closeEditModal}>
              取消
            </button>
            <button className="btn btn-primary" onClick={saveEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "保存中..." : "保存修改"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
