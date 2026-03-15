import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";

function formatCurrency(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
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

function typeBadgeClass(type) {
  if (type === "out") return "badge bg-out";
  if (type === "in") return "badge bg-in";
  if (type === "pay" || type === "receive") return "badge bg-pay";
  if (type === "sale_return") return "badge bg-return-in";
  if (type === "purchase_return") return "badge bg-return-out";
  return "badge";
}

function computeSummary(transactions) {
  let receivable = 0;
  let payable = 0;

  for (const tx of transactions) {
    const amount = Number(tx.amount || 0);
    if (tx.type === "out") receivable += amount;
    if (tx.type === "receive") receivable -= amount;
    if (tx.type === "sale_return") receivable -= amount;

    if (tx.type === "in") payable += amount;
    if (tx.type === "pay") payable -= amount;
    if (tx.type === "purchase_return") payable -= amount;
  }

  return { receivable, payable };
}

function downloadTextFile(name, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  const header = ["交易日期", "对象", "类型", "金额", "备注"];
  const escaped = [header, ...rows].map((row) =>
    row
      .map((value) => {
        const text = String(value ?? "");
        if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
          return `"${text.replaceAll("\"", "\"\"")}"`;
        }
        return text;
      })
      .join(",")
  );

  return `\uFEFF${escaped.join("\n")}`;
}

export default function DashboardPage() {
  const importInputRef = useRef(null);
  const today = new Date().toISOString().slice(0, 10);

  const transactionsQuery = useQuery({
    queryKey: ["transactions"],
    queryFn: async () => (await apiRequest("/transactions")).data
  });

  const partnersQuery = useQuery({
    queryKey: ["partners"],
    queryFn: async () => (await apiRequest("/partners")).data
  });

  const partnerNameMap = useMemo(() => {
    const map = new Map();
    for (const partner of partnersQuery.data || []) {
      map.set(partner.id, partner.name);
    }
    return map;
  }, [partnersQuery.data]);

  const recentRows = (transactionsQuery.data || []).slice(0, 10);
  const summary = computeSummary(transactionsQuery.data || []);
  const todayCount = (transactionsQuery.data || []).filter((tx) => tx.transactionDate === today).length;

  async function exportCsv() {
    const rows = recentRows.map((tx) => [
      tx.transactionDate,
      partnerNameMap.get(tx.partnerId) || `对象#${tx.partnerId}`,
      typeLabel(tx.type),
      Number(tx.amount || 0).toFixed(2),
      tx.remark || ""
    ]);
    downloadTextFile(`finance_recent_${today}.csv`, toCsv(rows), "text/csv;charset=utf-8;");
  }

  async function backupAll() {
    const [transactionsRes, partnersRes, productsRes, inventoryRes] = await Promise.all([
      apiRequest("/transactions"),
      apiRequest("/partners"),
      apiRequest("/products"),
      apiRequest("/inventory/overview")
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      transactions: transactionsRes.data || [],
      partners: partnersRes.data || [],
      products: productsRes.data || [],
      inventory: inventoryRes.data || []
    };

    downloadTextFile(
      `finance_backup_${today}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8;"
    );
  }

  async function importBackupFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      const ok =
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.transactions) &&
        Array.isArray(parsed.partners) &&
        Array.isArray(parsed.products);

      if (!ok) {
        window.alert("备份文件格式不正确。");
        return;
      }

      window.alert("备份文件校验通过。当前版本暂不支持一键导入，请先保留此文件。");
    } catch {
      window.alert("无法解析备份文件，请确认是 JSON 格式。");
    }
  }

  if (transactionsQuery.isLoading || partnersQuery.isLoading) {
    return <section className="page-section">加载中...</section>;
  }

  if (transactionsQuery.isError) {
    return <section className="page-section error-text">{transactionsQuery.error.message}</section>;
  }

  if (partnersQuery.isError) {
    return <section className="page-section error-text">{partnersQuery.error.message}</section>;
  }

  return (
    <section className="page-section">
      <div className="header-row">
        <h1>财务概览</h1>
        <div className="header-actions">
          <span className="current-date">{today.replaceAll("-", "/")}</span>
          <button className="btn btn-outline" onClick={exportCsv}>
            📊 导出 Excel
          </button>
          <button className="btn btn-outline" onClick={() => importInputRef.current?.click()}>
            📥 导入备份
          </button>
          <button className="btn btn-primary" onClick={backupAll}>
            💾 备份全数据
          </button>
          <input
            ref={importInputRef}
            className="hidden"
            type="file"
            accept=".json,application/json"
            onChange={importBackupFile}
          />
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card stat-card-danger">
          <h3>别人欠我们 (应收)</h3>
          <div className="value text-red">{formatCurrency(summary.receivable)}</div>
        </div>
        <div className="stat-card stat-card-success">
          <h3>我们欠别人 (应付)</h3>
          <div className="value text-green">{formatCurrency(summary.payable)}</div>
        </div>
        <div className="stat-card stat-card-primary">
          <h3>今日交易笔数</h3>
          <div className="value">{todayCount}</div>
        </div>
      </div>

      <div className="card">
        <h3>最近流水</h3>
        <table>
          <thead>
            <tr>
              <th>交易日期</th>
              <th>对象</th>
              <th>类型</th>
              <th>金额</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {recentRows.length === 0 ? (
              <tr>
                <td colSpan="5" className="cell-muted">
                  暂无数据
                </td>
              </tr>
            ) : (
              recentRows.map((tx) => (
                <tr key={tx.id}>
                  <td>{tx.transactionDate}</td>
                  <td>{partnerNameMap.get(tx.partnerId) || `对象#${tx.partnerId}`}</td>
                  <td>
                    <span className={typeBadgeClass(tx.type)}>{typeLabel(tx.type)}</span>
                  </td>
                  <td>{formatCurrency(tx.amount)}</td>
                  <td>{tx.remark || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
