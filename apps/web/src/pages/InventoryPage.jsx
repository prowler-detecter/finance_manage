import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isValidISODate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text || ""))) return false;
  const dt = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.toISOString().slice(0, 10) === text;
}

function isIntegerText(text) {
  return /^-?\d+$/.test(String(text || "").trim());
}

function formatDateTimeDisplay(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
}

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const previewReqIdRef = useRef(0);

  const [modal, setModal] = useState({
    open: false,
    product: null,
    mode: "set",
    quantity: "",
    bizDate: today(),
    remark: ""
  });
  const [previewText, setPreviewText] = useState("");

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
    }
  });

  function openStockAdjustModal(product) {
    setModal({
      open: true,
      product,
      mode: "set",
      quantity: String(Number(product.stock || 0)),
      bizDate: today(),
      remark: ""
    });
  }

  function closeStockAdjustModal() {
    setModal((prev) => ({
      ...prev,
      open: false,
      product: null
    }));
    setPreviewText("");
  }

  useEffect(() => {
    if (!modal.open || !modal.product) return;

    const mode = modal.mode === "delta" ? "delta" : "set";
    const bizDate = String(modal.bizDate || "").trim();
    const quantityRaw = String(modal.quantity || "").trim();
    const currentStock = Number(modal.product.stock || 0);

    if (!isValidISODate(bizDate)) {
      setPreviewText("业务日期格式不正确。");
      return;
    }

    if (quantityRaw === "") {
      setPreviewText(`当前库存：${currentStock}，请填写${mode === "set" ? "实盘数量" : "增减数量"}。`);
      return;
    }

    if (!isIntegerText(quantityRaw)) {
      setPreviewText("数量必须为整数。");
      return;
    }

    const quantity = Number(quantityRaw);
    if (!Number.isInteger(quantity)) {
      setPreviewText("数量必须为整数。");
      return;
    }

    if (mode === "set" && quantity < 0) {
      setPreviewText("实盘数量不能为负数。");
      return;
    }

    if (mode === "delta" && quantity === 0) {
      setPreviewText("增减数量不能为 0。");
      return;
    }

    const reqId = ++previewReqIdRef.current;
    setPreviewText("库存预演中...");

    (async () => {
      try {
        const res = await apiRequest("/stock-adjustments/preview", {
          method: "POST",
          body: JSON.stringify({
            productId: Number(modal.product.id),
            mode,
            quantity,
            bizDate
          })
        });

        if (reqId !== previewReqIdRef.current) return;
        const data = res.data;
        const changeText = Number(data.changeQty || 0) > 0 ? `+${data.changeQty}` : `${data.changeQty}`;
        setPreviewText(
          `当前库存：${currentStock}；事件前库存：${data.beforeQty}；事件后库存：${data.afterQty}；变化：${changeText}；应用后当前库存：${data.currentStock}`
        );
      } catch (error) {
        if (reqId !== previewReqIdRef.current) return;
        setPreviewText(error.message || "库存预演失败，请检查输入。");
      }
    })();
  }, [modal.open, modal.product, modal.mode, modal.quantity, modal.bizDate]);

  async function saveStockAdjustment() {
    if (!modal.product) {
      window.alert("请选择要调整的产品");
      return;
    }

    const mode = modal.mode === "delta" ? "delta" : "set";
    const bizDate = String(modal.bizDate || "").trim();
    const quantityRaw = String(modal.quantity || "").trim();

    if (!isValidISODate(bizDate)) {
      window.alert("请填写有效的业务日期");
      return;
    }
    if (!quantityRaw) {
      window.alert("请填写库存数量");
      return;
    }
    if (!isIntegerText(quantityRaw)) {
      window.alert("数量必须为整数");
      return;
    }

    const quantity = Number(quantityRaw);
    if (!Number.isInteger(quantity)) {
      window.alert("数量必须为整数");
      return;
    }

    if (mode === "set" && quantity < 0) {
      window.alert("实盘数量不能为负数");
      return;
    }

    if (mode === "delta" && quantity === 0) {
      window.alert("增减调整不能为 0");
      return;
    }

    try {
      await saveMutation.mutateAsync({
        productId: Number(modal.product.id),
        mode,
        quantity,
        bizDate,
        remark: String(modal.remark || "").trim() || null
      });
      closeStockAdjustModal();
      window.alert("库存调整已保存");
    } catch (error) {
      window.alert(error.message || "库存调整保存失败");
    }
  }

  return (
    <section>
      <div className="header-row">
        <h1>库存管理</h1>
      </div>

      <div className="card">
        <h3>库存总览与盘点调整</h3>
        {inventoryQuery.isLoading ? <p>加载中...</p> : null}
        {inventoryQuery.isError ? <p className="error-text">{inventoryQuery.error.message}</p> : null}

        <table id="inventory-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>编码</th>
              <th>规格</th>
              <th>单位</th>
              <th>当前库存</th>
              <th>最近业务日期</th>
              <th>最近一次更新时间</th>
              <th>库存依据摘要</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {(inventoryQuery.data || []).map((p) => {
              const stock = Number(p.stock || 0);
              const stockClass = stock < 0 ? "negative-stock" : stock > 0 ? "positive-stock" : "";
              const latestBizText = p.latestBusinessDate
                ? `${p.latestBusinessDate}（${p.latestBusinessType || "未知"}）`
                : "-";

              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.sku || "-"}</td>
                  <td>{p.spec || "-"}</td>
                  <td>{p.unit || "-"}</td>
                  <td className={stockClass}>{stock}</td>
                  <td>{latestBizText}</td>
                  <td>{formatDateTimeDisplay(p.lastStockUpdatedAt)}</td>
                  <td>{p.basisSummary || "暂无库存事件"}</td>
                  <td>
                    <button className="btn btn-small-outline" onClick={() => openStockAdjustModal(p)}>
                      盘点/调整
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={`modal${modal.open ? "" : " hidden"}`} onClick={(e) => e.target === e.currentTarget && closeStockAdjustModal()}>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="stock-adjust-title">
          <h3 id="stock-adjust-title">库存盘点/调整</h3>
          <div id="stock-adjust-product-info" className="muted-text">
            {modal.product
              ? `${modal.product.name} (${modal.product.sku || "无编码"}) 当前库存：${Number(modal.product.stock || 0)}`
              : ""}
          </div>

          <div className="modal-grid">
            <div className="form-group">
              <label>调整方式</label>
              <select value={modal.mode} onChange={(e) => setModal((prev) => ({ ...prev, mode: e.target.value }))}>
                <option value="set">实盘覆写</option>
                <option value="delta">增减调整</option>
              </select>
            </div>
            <div className="form-group">
              <label>{modal.mode === "set" ? "实盘数量" : "增减数量 (+/-)"}</label>
              <input
                type="number"
                step="1"
                value={modal.quantity}
                onChange={(e) => setModal((prev) => ({ ...prev, quantity: e.target.value }))}
              />
            </div>
          </div>

          <div className="form-group">
            <label>业务日期</label>
            <input type="date" value={modal.bizDate} onChange={(e) => setModal((prev) => ({ ...prev, bizDate: e.target.value }))} />
          </div>

          <div className="form-group">
            <label>备注</label>
            <input
              type="text"
              placeholder="例如：月度盘点差异修正"
              value={modal.remark}
              onChange={(e) => setModal((prev) => ({ ...prev, remark: e.target.value }))}
            />
          </div>

          <small id="stock-adjust-preview" className="muted-text">
            {previewText}
          </small>

          <div className="modal-actions">
            <button className="btn" onClick={closeStockAdjustModal}>
              取消
            </button>
            <button className="btn btn-primary" onClick={saveStockAdjustment} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "保存中..." : "确认保存"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
