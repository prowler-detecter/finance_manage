import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";

function typeLabel(type) {
  if (type === "out") return "出库";
  if (type === "in") return "入库";
  if (type === "sale_return") return "销售退货";
  if (type === "purchase_return") return "采购退货";
  if (type === "receive") return "收款";
  if (type === "pay") return "付款";
  return "未知";
}

function typeBadgeClass(type) {
  if (type === "out") return "badge bg-out";
  if (type === "in") return "badge bg-in";
  if (type === "sale_return") return "badge bg-return-in";
  if (type === "purchase_return") return "badge bg-return-out";
  if (type === "receive") return "badge bg-pay";
  if (type === "pay") return "badge bg-in";
  return "badge bg-in";
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

function calculateBalance(partnerId, transactions) {
  let balance = 0;

  for (const t of transactions || []) {
    if (Number(t.partnerId) !== Number(partnerId)) continue;
    const amount = Number(t.amount || 0);
    if (t.type === "out") balance += amount;
    else if (t.type === "in") balance -= amount;
    else if (t.type === "sale_return") balance -= amount;
    else if (t.type === "purchase_return") balance += amount;
    else if (t.type === "receive") balance -= amount;
    else if (t.type === "pay") balance += amount;
  }

  return balance;
}

function needsWarehouseSlip(type) {
  return type === "out" || type === "in";
}

function normalizeSlipBook(book) {
  return String(book || "").trim();
}

function formatItemSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return "-";
  const parts = items.slice(0, 2).map((item) => {
    const name = item?.productSnapshot?.name || "产品";
    return `${name} x${Number(item.quantity || 0)}`;
  });
  const moreCount = items.length - parts.length;
  return moreCount > 0 ? `${parts.join("，")} 等${items.length}项` : parts.join("，");
}

function getTransactionDisplayRemark(tx) {
  const remark = String(tx?.remark || "").trim();
  const refs = [];
  if (tx?.sourceTransactionId) refs.push(`原交易ID:${tx.sourceTransactionId}`);
  if (String(tx?.sourceRef || "").trim()) refs.push(`原单号:${String(tx.sourceRef).trim()}`);
  const refText = refs.join("；");
  const parts = [remark, refText].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "-";
}

function formatCurrency(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "");
          if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
            return `\"${text.replaceAll("\"", "\"\"")}\"`;
          }
          return text;
        })
        .join(",")
    )
    .join("\n");
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PartnersPage() {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [currentPartnerId, setCurrentPartnerId] = useState(null);
  const [profileEditMode, setProfileEditMode] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "customer"
  });
  const [profileDraft, setProfileDraft] = useState({
    contactName: "",
    phone: "",
    address: "",
    profileRemark: ""
  });

  const partnersQuery = useQuery({
    queryKey: ["partners"],
    queryFn: async () => (await apiRequest("/partners")).data
  });

  const transactionsQuery = useQuery({
    queryKey: ["transactions"],
    queryFn: async () => (await apiRequest("/transactions")).data
  });

  const createMutation = useMutation({
    mutationFn: async (payload) =>
      apiRequest("/partners", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      setForm({ name: "", type: "customer" });
      setShowAddForm(false);
      queryClient.invalidateQueries({ queryKey: ["partners"] });
    }
  });

  const updateProfileMutation = useMutation({
    mutationFn: async ({ id, payload }) =>
      apiRequest(`/partners/${id}/profile`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
    }
  });

  const updateSlipMutation = useMutation({
    mutationFn: async ({ id, payload }) =>
      apiRequest(`/transactions/${id}/slip`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    }
  });

  const partners = partnersQuery.data || [];
  const transactions = transactionsQuery.data || [];

  const currentPartner = useMemo(() => {
    if (!currentPartnerId) return null;
    return partners.find((p) => Number(p.id) === Number(currentPartnerId)) || null;
  }, [currentPartnerId, partners]);

  const ledgerRows = useMemo(() => {
    if (!currentPartner) return [];
    return transactions
      .filter((t) => Number(t.partnerId) === Number(currentPartner.id))
      .slice()
      .sort(compareTxDesc);
  }, [currentPartner, transactions]);

  const ledgerSummary = useMemo(() => {
    if (!currentPartner) {
      return {
        count: 0,
        totalAmount: 0,
        balance: 0
      };
    }
    return {
      count: ledgerRows.length,
      totalAmount: ledgerRows.reduce((sum, t) => sum + Number(t.amount || 0), 0),
      balance: calculateBalance(currentPartner.id, transactions)
    };
  }, [currentPartner, ledgerRows, transactions]);

  function openLedger(partner) {
    setCurrentPartnerId(partner.id);
    setProfileEditMode(false);
    setProfileDraft({
      contactName: String(partner.contactName || ""),
      phone: String(partner.phone || ""),
      address: String(partner.address || ""),
      profileRemark: String(partner.profileRemark || "")
    });
  }

  function exportPartnerTransactions(partner) {
    const rows = [
      ["单号", "交易日期", "类型", "金额", "产品明细", "备注", "单据簿号"],
      ...transactions
        .filter((t) => Number(t.partnerId) === Number(partner.id))
        .sort(compareTxDesc)
        .map((t) => [
          t.slipNo || "-",
          t.transactionDate || "",
          typeLabel(t.type),
          Number(t.amount || 0).toFixed(2),
          formatItemSummary(t.items),
          getTransactionDisplayRemark(t),
          normalizeSlipBook(t.slipBook) || "-"
        ])
    ];

    const content = `\uFEFF${toCsv(rows)}`;
    const day = new Date().toISOString().slice(0, 10);
    const safeName = String(partner.name || "partner").replace(/[\\/:*?"<>|]/g, "_");
    downloadTextFile(`${safeName}_ledger_${day}.csv`, content, "text/csv;charset=utf-8;");
  }

  async function saveProfile() {
    if (!currentPartner) return;

    const phone = String(profileDraft.phone || "").trim();
    if (phone && !/^[0-9+\-()\s]*$/.test(phone)) {
      window.alert("联系电话格式不正确，仅允许数字、空格、+、-、括号");
      return;
    }

    try {
      await updateProfileMutation.mutateAsync({
        id: currentPartner.id,
        payload: {
          contactName: String(profileDraft.contactName || "").trim() || null,
          phone: phone || null,
          address: String(profileDraft.address || "").trim() || null,
          profileRemark: String(profileDraft.profileRemark || "").trim() || null
        }
      });
      setProfileEditMode(false);
      window.alert("资料已保存");
    } catch (error) {
      window.alert(error.message || "资料保存失败");
    }
  }

  async function editTransactionSlipInfo(tx) {
    if (!needsWarehouseSlip(tx.type)) {
      window.alert("仅出库/入库记录支持补填单号");
      return;
    }

    const currentBook = normalizeSlipBook(tx.slipBook);
    const currentNo = Number(tx.slipNo || 0);
    const sameTypeRows = transactions.filter((item) => item.type === tx.type && Number(item.id) !== Number(tx.id));

    const maxNo = sameTypeRows
      .filter((item) => normalizeSlipBook(item.slipBook).toLowerCase() === currentBook.toLowerCase())
      .reduce((max, item) => Math.max(max, Number(item.slipNo || 0)), 0);

    const defaultNoText = currentNo > 0 ? String(currentNo) : currentBook ? String(maxNo > 0 ? maxNo + 1 : 1) : "";

    const bookInput = window.prompt("请输入单据簿号（可留空表示清空单号）", currentBook);
    if (bookInput === null) return;

    const targetBook = normalizeSlipBook(bookInput);
    const noInput = window.prompt("请输入单据号（正整数，可留空）", defaultNoText);
    if (noInput === null) return;

    const noText = String(noInput || "").trim();

    if (!targetBook && !noText) {
      try {
        await updateSlipMutation.mutateAsync({
          id: tx.id,
          payload: {
            slipBook: null,
            slipNo: null,
            force: false
          }
        });
        window.alert("已清空该记录的单据号");
      } catch (error) {
        window.alert(error.message || "清空单据号失败");
      }
      return;
    }

    if (!targetBook || !noText) {
      window.alert("如需填写单号，请同时填写单据簿号和单据号");
      return;
    }

    const slipNo = Number(noText);
    if (!Number.isInteger(slipNo) || slipNo <= 0) {
      window.alert("单据号必须为正整数");
      return;
    }

    async function save(force) {
      await updateSlipMutation.mutateAsync({
        id: tx.id,
        payload: {
          slipBook: targetBook,
          slipNo,
          force
        }
      });
    }

    try {
      await save(false);
      window.alert("单据号更新成功");
    } catch (error) {
      if (error.status === 409 && Array.isArray(error.body?.warnings)) {
        const text = `系统提示以下风险：\n- ${error.body.warnings.join("\n- ")}\n\n是否继续保存？`;
        if (window.confirm(text)) {
          try {
            await save(true);
            window.alert("单据号更新成功");
          } catch (retryError) {
            window.alert(retryError.message || "单据号更新失败");
          }
        }
      } else {
        window.alert(error.message || "单据号更新失败");
      }
    }
  }

  if (partnersQuery.isLoading || transactionsQuery.isLoading) {
    return (
      <section>
        <h1>客户与欠款管理</h1>
        <div className="card">加载中...</div>
      </section>
    );
  }

  if (partnersQuery.isError) {
    return (
      <section>
        <h1>客户与欠款管理</h1>
        <div className="card error-text">{partnersQuery.error.message}</div>
      </section>
    );
  }

  if (transactionsQuery.isError) {
    return (
      <section>
        <h1>客户与欠款管理</h1>
        <div className="card error-text">{transactionsQuery.error.message}</div>
      </section>
    );
  }

  if (!currentPartner) {
    return (
      <section>
        <div className="header-row">
          <h1>客户与欠款管理</h1>
          <button className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)}>
            + 新增客户
          </button>
        </div>

        {showAddForm ? (
          <div className="card add-client-form-card">
            <h3>添加新客户/供应商</h3>
            <div className="inline-row">
              <input
                type="text"
                placeholder="名称"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
              <select value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}>
                <option value="customer">客户 (买方)</option>
                <option value="supplier">供应商 (卖方)</option>
              </select>
              <button
                className="btn btn-primary"
                onClick={() => createMutation.mutate(form)}
                disabled={!String(form.name || "").trim() || createMutation.isPending}
              >
                保存
              </button>
              <button className="btn" onClick={() => setShowAddForm(false)}>
                取消
              </button>
            </div>
          </div>
        ) : null}

        <div className="card">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>当前欠款状态 (正数=欠我们)</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => {
                const balance = calculateBalance(p.id, transactions);
                let statusText = "两清";
                let statusClass = "status-clear";

                if (balance > 0) {
                  statusText = `对方欠我们 ${formatCurrency(balance)}`;
                  statusClass = "status-receivable";
                } else if (balance < 0) {
                  statusText = `我们欠对方 ${formatCurrency(Math.abs(balance))}`;
                  statusClass = "status-payable";
                }

                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>{p.type === "customer" ? "客户" : "供应商"}</td>
                    <td className={`status-cell ${statusClass}`}>{statusText}</td>
                    <td>
                      <div className="client-actions">
                        <button className="btn btn-small-outline" onClick={() => openLedger(p)}>
                          查看流水
                        </button>
                        <button className="btn btn-small-outline" onClick={() => exportPartnerTransactions(p)}>
                          导出流水
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="header-row">
        <div>
          <h1>{currentPartner.name} - 流水详情</h1>
          <div className="muted-text">对象类型：{currentPartner.type === "customer" ? "客户" : "供应商"}</div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-outline"
            onClick={() => {
              setCurrentPartnerId(null);
              setProfileEditMode(false);
            }}
          >
            ← 返回客户列表
          </button>
          <button className="btn btn-primary" onClick={() => exportPartnerTransactions(currentPartner)}>
            📊 导出当前对象流水
          </button>
        </div>
      </div>

      <div className="card partner-profile-card">
        <div className="section-title-row">
          <label>基础资料</label>
          {!profileEditMode ? (
            <div className="section-actions">
              <button
                className="btn btn-small-outline"
                type="button"
                onClick={() => {
                  setProfileEditMode(true);
                  setProfileDraft({
                    contactName: String(currentPartner.contactName || ""),
                    phone: String(currentPartner.phone || ""),
                    address: String(currentPartner.address || ""),
                    profileRemark: String(currentPartner.profileRemark || "")
                  });
                }}
              >
                编辑资料
              </button>
            </div>
          ) : (
            <div className="section-actions">
              <button className="btn btn-primary btn-compact" type="button" onClick={saveProfile}>
                保存资料
              </button>
              <button className="btn btn-compact" type="button" onClick={() => setProfileEditMode(false)}>
                取消
              </button>
            </div>
          )}
        </div>

        {!profileEditMode ? (
          <div className="profile-grid">
            <div className="profile-item">
              <span className="profile-label">联系人</span>
              <span className="profile-value">{currentPartner.contactName || "-"}</span>
            </div>
            <div className="profile-item">
              <span className="profile-label">联系电话</span>
              <span className="profile-value">{currentPartner.phone || "-"}</span>
            </div>
            <div className="profile-item profile-item-full">
              <span className="profile-label">地址</span>
              <span className="profile-value">{currentPartner.address || "-"}</span>
            </div>
            <div className="profile-item profile-item-full">
              <span className="profile-label">备注</span>
              <span className="profile-value">{currentPartner.profileRemark || "-"}</span>
            </div>
          </div>
        ) : (
          <div className="profile-grid">
            <div className="form-group">
              <label>联系人</label>
              <input
                type="text"
                placeholder="联系人姓名"
                value={profileDraft.contactName}
                onChange={(e) => setProfileDraft((prev) => ({ ...prev, contactName: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>联系电话</label>
              <input
                type="text"
                placeholder="手机号/座机"
                value={profileDraft.phone}
                onChange={(e) => setProfileDraft((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </div>
            <div className="form-group profile-item-full">
              <label>地址</label>
              <input
                type="text"
                placeholder="联系地址"
                value={profileDraft.address}
                onChange={(e) => setProfileDraft((prev) => ({ ...prev, address: e.target.value }))}
              />
            </div>
            <div className="form-group profile-item-full">
              <label>备注</label>
              <textarea
                rows="3"
                placeholder="客户/供应商资料备注"
                value={profileDraft.profileRemark}
                onChange={(e) => setProfileDraft((prev) => ({ ...prev, profileRemark: e.target.value }))}
              />
            </div>
          </div>
        )}
      </div>

      <div className="stats-grid ledger-stats">
        <div className="stat-card stat-card-primary">
          <h3>流水笔数</h3>
          <div className="value">{ledgerSummary.count}</div>
        </div>
        <div className="stat-card stat-card-primary">
          <h3>交易总金额</h3>
          <div className="value">{formatCurrency(ledgerSummary.totalAmount)}</div>
        </div>
        <div className="stat-card stat-card-primary">
          <h3>当前往来余额</h3>
          <div className="value">{formatCurrency(ledgerSummary.balance)}</div>
        </div>
      </div>

      <div className="card">
        <h3>流水明细</h3>
        <table>
          <thead>
            <tr>
              <th>单号</th>
              <th>交易日期</th>
              <th>类型</th>
              <th>金额</th>
              <th>产品明细</th>
              <th>备注</th>
              <th>操作</th>
              <th>单据簿号</th>
            </tr>
          </thead>
          <tbody>
            {ledgerRows.map((tx) => (
              <tr key={tx.id}>
                <td>{tx.slipNo || "-"}</td>
                <td>{tx.transactionDate}</td>
                <td>
                  <span className={typeBadgeClass(tx.type)}>{typeLabel(tx.type)}</span>
                </td>
                <td>{formatCurrency(tx.amount)}</td>
                <td>{formatItemSummary(tx.items)}</td>
                <td>{getTransactionDisplayRemark(tx)}</td>
                <td>
                  {needsWarehouseSlip(tx.type) ? (
                    <button className="btn btn-small-outline" onClick={() => editTransactionSlipInfo(tx)}>
                      补填/修改单号
                    </button>
                  ) : (
                    "-"
                  )}
                </td>
                <td>{normalizeSlipBook(tx.slipBook) || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {ledgerRows.length === 0 ? <div className="muted-text">当前对象暂无流水记录。</div> : null}
      </div>
    </section>
  );
}
