import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/AuthContext";

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
  if (type === "receive_diff") return "收款差额";
  if (type === "pay_diff") return "付款差额";
  return "未知";
}

function typeBadgeClass(type) {
  if (type === "out") return "badge bg-out";
  if (type === "in") return "badge bg-in";
  if (type === "pay" || type === "receive" || type === "receive_diff" || type === "pay_diff") return "badge bg-pay";
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
    if (tx.type === "receive" || tx.type === "receive_diff") receivable -= amount;
    if (tx.type === "sale_return") receivable -= amount;

    if (tx.type === "in") payable += amount;
    if (tx.type === "pay" || tx.type === "pay_diff") payable -= amount;
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
  const header = ["交易日期", "交易对象", "类型", "金额", "备注"];
  const escaped = [header, ...rows].map((row) =>
    row
      .map((value) => {
        const text = String(value ?? "");
        if (text.includes(",") || text.includes('"') || text.includes("\n")) {
          return `"${text.replaceAll('"', '""')}"`;
        }
        return text;
      })
      .join(",")
  );

  return `\uFEFF${escaped.join("\n")}`;
}

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyReport() {
  return null;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const canManageDataExports = ["admin", "super_admin"].includes(String(user?.role || ""));
  const importInputRef = useRef(null);
  const today = todayLocal();

  const [backupScope, setBackupScope] = useState(canManageDataExports ? "system" : "business");
  const [restoreScope, setRestoreScope] = useState(canManageDataExports ? "system" : "business");
  const [restoreStrategy, setRestoreStrategy] = useState("merge");
  const [conflictMode, setConflictMode] = useState("skip");
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [previewState, setPreviewState] = useState(null);
  const [pendingBackup, setPendingBackup] = useState(null);
  const [restoreReport, setRestoreReport] = useState(emptyReport());
  const [working, setWorking] = useState(false);

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
    if (!canManageDataExports) {
      window.alert("普通用户无导出权限");
      return;
    }
    const rows = recentRows.map((tx) => [
      tx.transactionDate,
      partnerNameMap.get(tx.partnerId) || `对象#${tx.partnerId}`,
      typeLabel(tx.type),
      Number(tx.amount || 0).toFixed(2),
      tx.remark || ""
    ]);
    downloadTextFile(`finance_recent_${today}.csv`, toCsv(rows), "text/csv;charset=utf-8;");
  }

  async function backupJson() {
    if (!canManageDataExports) {
      window.alert("普通用户无备份权限");
      return;
    }
    setWorking(true);
    try {
      const res = await apiRequest(`/backup/json?scope=${backupScope}`);
      downloadTextFile(
        `finance_backup_${backupScope}_${today}.json`,
        JSON.stringify(res.data, null, 2),
        "application/json;charset=utf-8;"
      );
      window.alert("备份导出完成。");
    } catch (error) {
      window.alert(error.message || "备份导出失败");
    } finally {
      setWorking(false);
    }
  }

  async function runPreview(backupObj) {
    if (!canManageDataExports) {
      window.alert("普通用户无备份权限");
      return;
    }
    const res = await apiRequest("/backup/json/preview", {
      method: "POST",
      body: JSON.stringify({
        backup: backupObj,
        scope: restoreScope,
        strategy: restoreStrategy
      })
    });
    setBackupModalOpen(false);
    setPreviewState(res.data);
  }

  async function importBackupFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!canManageDataExports) {
      window.alert("普通用户无备份权限");
      return;
    }

    setWorking(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setPendingBackup(parsed);
      await runPreview(parsed);
    } catch (error) {
      window.alert(error.message || "无法解析备份文件，请确认 JSON 格式正确");
    } finally {
      setWorking(false);
    }
  }

  async function executeRestore() {
    if (!pendingBackup) return;
    if (!canManageDataExports) {
      window.alert("普通用户无备份权限");
      return;
    }
    setWorking(true);
    try {
      const res = await apiRequest("/backup/json/restore", {
        method: "POST",
        body: JSON.stringify({
          backup: pendingBackup,
          scope: restoreScope,
          strategy: restoreStrategy,
          onConflict: conflictMode
        })
      });
      setRestoreReport(res.data?.report || null);
      setPreviewState(null);
      setPendingBackup(null);
      setBackupModalOpen(true);
      window.alert("导入恢复执行完成。");
    } catch (error) {
      window.alert(error.message || "导入恢复失败");
    } finally {
      setWorking(false);
    }
  }

  const scopeOptions = canManageDataExports
    ? [
        { value: "system", label: "整系统（业务+账号）" },
        { value: "business", label: "仅业务数据" },
        { value: "accounts", label: "仅账号" }
      ]
    : [{ value: "business", label: "仅业务数据" }];

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
          {canManageDataExports ? (
            <>
              <button className="btn btn-outline" onClick={() => setBackupModalOpen(true)} disabled={working}>
                🗂️ 备份与恢复
              </button>
              <button className="btn btn-outline" onClick={exportCsv} disabled={working}>
                📊 导出 Excel
              </button>
            </>
          ) : null}
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
        {canManageDataExports ? (
          <>
            <div className="stat-card stat-card-danger">
              <h3>别人欠我们 (应收)</h3>
              <div className="value text-red">{formatCurrency(summary.receivable)}</div>
            </div>
            <div className="stat-card stat-card-success">
              <h3>我们欠别人 (应付)</h3>
              <div className="value text-green">{formatCurrency(summary.payable)}</div>
            </div>
          </>
        ) : null}
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
              <th>交易对象</th>
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

      {canManageDataExports && backupModalOpen ? (
        <div className="modal" onClick={(event) => event.target === event.currentTarget && setBackupModalOpen(false)}>
          <div className="modal-card modal-card-backup" role="dialog" aria-modal="true" aria-labelledby="backup-restore-title">
            <h3 id="backup-restore-title">备份与恢复</h3>
            <div className="backup-grid">
              <label>
                备份作用域
                <select value={backupScope} onChange={(e) => setBackupScope(e.target.value)}>
                  {scopeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                恢复作用域
                <select value={restoreScope} onChange={(e) => setRestoreScope(e.target.value)}>
                  {scopeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                恢复策略
                <select value={restoreStrategy} onChange={(e) => setRestoreStrategy(e.target.value)}>
                  <option value="replace">全量替换</option>
                  <option value="empty_only">仅空库导入</option>
                  <option value="merge">增量合并</option>
                </select>
              </label>
              <label>
                重复冲突处理
                <select
                  value={conflictMode}
                  onChange={(e) => setConflictMode(e.target.value)}
                  disabled={restoreStrategy !== "merge"}
                >
                  <option value="skip">跳过重复</option>
                  <option value="overwrite">覆盖重复</option>
                </select>
              </label>
            </div>

            <div className="section-actions">
              <button className="btn btn-primary" onClick={backupJson} disabled={working}>
                💾 导出 JSON 可恢复备份
              </button>
              <button className="btn btn-outline" onClick={() => importInputRef.current?.click()} disabled={working}>
                📥 导入备份（预检查）
              </button>
              <button
                className="btn btn-outline"
                disabled={working || !pendingBackup}
                onClick={() => pendingBackup && runPreview(pendingBackup).catch((e) => window.alert(e.message))}
              >
                重新预检查
              </button>
            </div>

            <h4 className="backup-modal-section-title">最近一次导入报告</h4>
            {restoreReport ? (
              <>
                <p className="muted-text">
                  新增 {restoreReport.summary?.created || 0}，覆盖 {restoreReport.summary?.overwritten || 0}，跳过{" "}
                  {restoreReport.summary?.skipped || 0}，失败 {restoreReport.summary?.failed || 0}
                </p>
                <div className="table-scroll">
                  <table className="fixed-table">
                    <thead>
                      <tr>
                        <th>实体</th>
                        <th>总量</th>
                        <th>新增</th>
                        <th>覆盖</th>
                        <th>跳过</th>
                        <th>失败</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(restoreReport.entities || {}).map(([entity, stat]) => (
                        <tr key={entity}>
                          <td>{entity}</td>
                          <td>{stat.total || 0}</td>
                          <td>{stat.created || 0}</td>
                          <td>{stat.overwritten || 0}</td>
                          <td>{stat.skipped || 0}</td>
                          <td>{stat.failed || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="muted-text">暂无导入报告。</p>
            )}

            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setBackupModalOpen(false)} disabled={working}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {canManageDataExports && previewState ? (
        <div className="modal">
          <div className="modal-card">
            <h3>导入预检查结果</h3>
            <p className="muted-text">
              策略：{previewState.strategy}，作用域：{previewState.scope}
            </p>
            {previewState.warnings?.length ? (
              <div className="warning-text">{previewState.warnings.join("；")}</div>
            ) : null}
            {!previewState.canExecute ? (
              <p className="error-text">当前条件下不可执行恢复。</p>
            ) : null}

            {previewState.preview?.entities ? (
              <div className="table-scroll">
                <table className="fixed-table">
                  <thead>
                    <tr>
                      <th>实体</th>
                      <th>总量</th>
                      <th>可新增</th>
                      <th>冲突</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(previewState.preview.entities).map(([entity, stat]) => (
                      <tr key={entity}>
                        <td>{entity}</td>
                        <td>{stat.total || 0}</td>
                        <td>{stat.canCreate || 0}</td>
                        <td>{stat.conflicts || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted-text">将导入 {Object.values(previewState.incomingCounts || {}).reduce((a, b) => a + Number(b || 0), 0)} 条记录。</p>
            )}

            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setPreviewState(null)} disabled={working}>
                关闭
              </button>
              <button className="btn btn-primary" onClick={executeRestore} disabled={working || !previewState.canExecute}>
                执行恢复
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
