import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/AuthContext";

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
  if (type === "sale_return") return "badge bg-return-in";
  if (type === "purchase_return") return "badge bg-return-out";
  if (type === "receive" || type === "receive_diff") return "badge bg-pay";
  if (type === "pay" || type === "pay_diff") return "badge bg-in";
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

function compareTxAsc(a, b) {
  const aDate = String(a.transactionDate || "");
  const bDate = String(b.transactionDate || "");
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;

  const aRecorded = new Date(a.recordedAt || 0).getTime();
  const bRecorded = new Date(b.recordedAt || 0).getTime();
  if (aRecorded !== bRecorded) return aRecorded - bRecorded;

  return Number(a.id || 0) - Number(b.id || 0);
}

const LEDGER_TX_TYPE_SORT_ORDER = {
  out: 1,
  in: 2,
  sale_return: 3,
  purchase_return: 4,
  receive: 5,
  pay: 6,
  receive_diff: 7,
  pay_diff: 8
};
const LEDGER_RECORDED_BY_UNSET = "__UNSET__";

function toMillis(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function compareLedgerFallbackDesc(a, b) {
  const aRecorded = toMillis(a?.recordedAt);
  const bRecorded = toMillis(b?.recordedAt);
  if (aRecorded !== bRecorded) return bRecorded - aRecorded;
  return Number(b?.id || 0) - Number(a?.id || 0);
}

function compareLedgerBySort(a, b, sortBy, sortDir) {
  const direction = sortDir === "asc" ? 1 : -1;
  let compareValue = 0;
  if (sortBy === "recordedAt") {
    compareValue = toMillis(a?.recordedAt) - toMillis(b?.recordedAt);
  } else if (sortBy === "id") {
    compareValue = Number(a?.id || 0) - Number(b?.id || 0);
  } else if (sortBy === "bookkeepingDate") {
    compareValue = String(a?.bookkeepingDate || "").localeCompare(String(b?.bookkeepingDate || ""));
  } else if (sortBy === "transactionDate") {
    compareValue = String(a?.transactionDate || "").localeCompare(String(b?.transactionDate || ""));
  } else if (sortBy === "amount") {
    compareValue = Number(a?.amount || 0) - Number(b?.amount || 0);
  } else if (sortBy === "type") {
    compareValue =
      Number(LEDGER_TX_TYPE_SORT_ORDER[a?.type] || 999) - Number(LEDGER_TX_TYPE_SORT_ORDER[b?.type] || 999);
  }

  if (compareValue === 0) {
    return compareLedgerFallbackDesc(a, b);
  }

  return compareValue * direction;
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
    else if (t.type === "receive" || t.type === "receive_diff") balance -= amount;
    else if (t.type === "pay" || t.type === "pay_diff") balance += amount;
  }

  return balance;
}

function calculateTradeTotalAmount(partnerId, transactions) {
  let total = 0;
  for (const t of transactions || []) {
    if (Number(t.partnerId) !== Number(partnerId)) continue;
    const amount = Math.abs(Number(t.amount || 0));
    if (t.type === "receive" || t.type === "pay" || t.type === "receive_diff" || t.type === "pay_diff") continue;
    if (t.type === "sale_return" || t.type === "purchase_return") {
      total -= amount;
    } else {
      total += amount;
    }
  }
  return total;
}

function needsWarehouseSlip(type) {
  return type === "out" || type === "in" || type === "sale_return" || type === "purchase_return";
}

function slipSequenceTypes(type) {
  if (type === "out" || type === "sale_return") return ["out", "sale_return"];
  if (type === "in" || type === "purchase_return") return ["in", "purchase_return"];
  return [type];
}

function normalizeSlipBook(book) {
  return String(book || "").trim();
}

function slipNoDisplay(tx) {
  const slipNo = Number(tx?.slipNo || 0);
  if (Number.isInteger(slipNo) && slipNo > 0) return String(slipNo);

  // Backward compatibility: old return records may only have sourceRef.
  if (tx?.type === "sale_return" || tx?.type === "purchase_return") {
    const legacyRef = String(tx?.sourceRef || "").trim();
    if (legacyRef) return legacyRef;
  }

  return "-";
}

function formatQtyWithUnit(quantity, unit) {
  const qty = Number(quantity);
  const qtyText = Number.isFinite(qty) ? String(qty) : String(quantity ?? "");
  const unitText = String(unit || "").trim();
  return unitText ? `${qtyText}${unitText}` : qtyText;
}

function formatItemSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return "-";
  const parts = items.slice(0, 2).map((item) => {
    const name = item?.productSnapshot?.name || "产品";
    return `${name} x${formatQtyWithUnit(item.quantity, item?.productSnapshot?.unit)}`;
  });
  const moreCount = items.length - parts.length;
  return moreCount > 0 ? `${parts.join("，")} 等${items.length}项` : parts.join("，");
}

function formatInboundSummary(inboundLines) {
  if (!Array.isArray(inboundLines) || inboundLines.length === 0) return "-";
  const parts = inboundLines.slice(0, 2).map((line) => {
    const typeText = line?.lineType === "processing" ? "加工" : "物料";
    const name = String(line?.name || "").trim() || typeText;
    return `${typeText}:${name} x${formatQtyWithUnit(line.quantity, line?.unit)}`;
  });
  if (inboundLines.length > 2) return `${parts.join("，")} 等${inboundLines.length}项`;
  return parts.join("，");
}

function formatTransactionSummary(tx) {
  if (tx?.type === "in" || tx?.type === "purchase_return") return formatInboundSummary(tx.inboundLines);
  return formatItemSummary(tx?.items);
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

function isWithinDateRange(dateText, startDate, endDate) {
  const date = String(dateText || "");
  const start = String(startDate || "").trim();
  const end = String(endDate || "").trim();
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function partnerTypeLabel(type) {
  return type === "customer" ? "客户" : "供应商";
}

function formatSignedAmountForExport(tx) {
  const amount = Math.abs(Number(tx?.amount || 0));
  if (
    tx?.type === "sale_return" ||
    tx?.type === "purchase_return" ||
    tx?.type === "receive" ||
    tx?.type === "pay" ||
    tx?.type === "receive_diff" ||
    tx?.type === "pay_diff"
  ) {
    return (-amount).toFixed(2);
  }
  return amount.toFixed(2);
}

function formatSignedQuantityForExport(quantity, isReturn) {
  const raw = Number(quantity || 0);
  const absQty = Math.abs(raw);
  const finalQty = isReturn ? -absQty : absQty;
  if (!Number.isFinite(finalQty)) return "";
  if (Number.isInteger(finalQty)) return String(finalQty);
  return finalQty.toFixed(2).replace(/\.?0+$/, "");
}

function buildNameSpec(name, spec) {
  const nameText = String(name || "").trim();
  const specText = String(spec || "").trim();
  if (!nameText && !specText) return "";
  if (!specText) return nameText;
  if (!nameText) return specText;
  return `${nameText} ${specText}`;
}

function buildExportDetailEntries(tx) {
  if (tx?.type === "receive" || tx?.type === "pay" || tx?.type === "receive_diff" || tx?.type === "pay_diff")
    return [];
  const isReturn = tx?.type === "sale_return" || tx?.type === "purchase_return";

  function resolveSignedDetailAmount(line) {
    const qty = Math.abs(Number(line?.quantity || 0));
    const unitPrice = Number(line?.unitPrice || 0);
    const rawLineAmount = Number(line?.lineAmount);
    const baseAmount = Number.isFinite(rawLineAmount) ? Math.abs(rawLineAmount) : Math.abs(qty * unitPrice);
    if (!Number.isFinite(baseAmount)) return 0;
    return isReturn ? -baseAmount : baseAmount;
  }

  if (tx?.type === "in" || tx?.type === "purchase_return") {
    return (tx?.inboundLines || []).map((line) => ({
      nameSpec: buildNameSpec(line?.name, line?.spec),
      unit: String(line?.unit || "").trim(),
      quantity: formatSignedQuantityForExport(line?.quantity, isReturn),
      unitPrice: Number(line?.unitPrice || 0).toFixed(2),
      unitPriceNumber: Math.abs(Number(line?.unitPrice || 0)),
      amountNumber: resolveSignedDetailAmount(line)
    }));
  }

  return (tx?.items || []).map((item) => ({
    nameSpec: buildNameSpec(item?.productSnapshot?.name, item?.productSnapshot?.spec),
    unit: String(item?.productSnapshot?.unit || "").trim(),
    quantity: formatSignedQuantityForExport(item?.quantity, isReturn),
    unitPrice: Number(item?.unitPrice || 0).toFixed(2),
    unitPriceNumber: Math.abs(Number(item?.unitPrice || 0)),
    amountNumber: resolveSignedDetailAmount(item)
  }));
}

function buildLedgerExcelHtml({ partner, rows, startDate, endDate, exportedAt }) {
  const safeName = escapeHtml(partner?.name || "");
  const partnerType = escapeHtml(partnerTypeLabel(partner?.type));
  const contactName = escapeHtml(partner?.contactName || "");
  const phone = escapeHtml(partner?.phone || "");
  const address = escapeHtml(partner?.address || "");
  const profileRemark = escapeHtml(partner?.profileRemark || "");
  const rangeText = `${startDate || "不限"} 至 ${endDate || "不限"}`;
  const exportTimeText = new Date(exportedAt).toLocaleString("zh-CN", { hour12: false });

  const headerHtml = `
    <tr>
      <th>交易日期</th>
      <th>单号</th>
      <th>类型</th>
      <th>名称规格</th>
      <th>单位</th>
      <th>数量</th>
      <th>单价</th>
      <th>金额</th>
      <th>备注</th>
    </tr>
  `;

  const bodyHtml =
    rows.length > 0
      ? rows
          .map((row) => {
            const rowClass = row.highlightRed ? " class=\"pay-row\"" : "";
            return `
              <tr${rowClass}>
                <td>${escapeHtml(row.transactionDate)}</td>
                <td>${escapeHtml(row.slipNo)}</td>
                <td>${escapeHtml(row.typeLabel)}</td>
                <td>${escapeHtml(row.nameSpec)}</td>
                <td>${escapeHtml(row.unit)}</td>
                <td>${escapeHtml(row.quantity)}</td>
                <td>${escapeHtml(row.unitPrice)}</td>
                <td>${escapeHtml(row.amount)}</td>
                <td>${escapeHtml(row.remark)}</td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td colspan="9">当前时间范围无流水记录</td>
        </tr>
      `;

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 12px; color: #111827; }
      h2 { margin: 0 0 10px; }
      .meta { margin-bottom: 14px; border-collapse: collapse; }
      .meta td { padding: 4px 8px 4px 0; border: none; vertical-align: top; }
      .meta .label { color: #374151; font-weight: 600; width: 100px; }
      .data { border-collapse: collapse; width: 100%; }
      .data th, .data td { border: 1px solid #d1d5db; padding: 6px 8px; vertical-align: middle; word-break: break-word; }
      .data th { background: #f3f4f6; font-weight: 700; }
      .data td:nth-child(6), .data td:nth-child(7), .data td:nth-child(8) { text-align: right; }
      .pay-row td { color: #c62828; }
    </style>
  </head>
  <body>
    <h2>客户流水明细</h2>
    <table class="meta">
      <tr><td class="label">客户名称</td><td>${safeName}</td></tr>
      <tr><td class="label">对象类型</td><td>${partnerType}</td></tr>
      <tr><td class="label">联系人</td><td>${contactName}</td></tr>
      <tr><td class="label">联系电话</td><td>${phone}</td></tr>
      <tr><td class="label">地址</td><td>${address}</td></tr>
      <tr><td class="label">资料备注</td><td>${profileRemark}</td></tr>
      <tr><td class="label">时间范围</td><td>${escapeHtml(rangeText)}</td></tr>
      <tr><td class="label">导出时间</td><td>${escapeHtml(exportTimeText)}</td></tr>
    </table>
    <table class="data">
      <thead>
        ${headerHtml}
      </thead>
      <tbody>
        ${bodyHtml}
      </tbody>
    </table>
  </body>
</html>
  `;
}

function buildPartnerExportRows(transactions, partner, startDate = "", endDate = "") {
  const start = String(startDate || "").trim();
  const end = String(endDate || "").trim();

  return (transactions || [])
    .filter((t) => Number(t.partnerId) === Number(partner.id))
    .filter((t) => isWithinDateRange(t.transactionDate, start, end))
    .sort(compareTxAsc)
    .flatMap((t) => {
      const detailEntries = buildExportDetailEntries(t);
      const remarkText = getTransactionDisplayRemark(t);
      const signedTxAmount =
        t.type === "sale_return" ||
        t.type === "purchase_return" ||
        t.type === "receive" ||
        t.type === "pay" ||
        t.type === "receive_diff" ||
        t.type === "pay_diff"
          ? -Math.abs(Number(t.amount || 0))
          : Math.abs(Number(t.amount || 0));

      const baseRow = {
        transactionDate: t.transactionDate || "",
        slipNo: (() => {
          const slipNoOnly = slipNoDisplay(t);
          return slipNoOnly === "-" ? "" : slipNoOnly;
        })(),
        typeLabel: typeLabel(t.type),
        remark: remarkText === "-" ? "" : remarkText,
        highlightRed: t.type === "receive" || t.type === "pay" || t.type === "receive_diff" || t.type === "pay_diff"
      };

      if (detailEntries.length > 0) {
        return detailEntries.map((entry) => {
          const detailAmount = Number(entry?.amountNumber || 0);
          return {
            ...baseRow,
            nameSpec: String(entry?.nameSpec || ""),
            unit: String(entry?.unit || ""),
            quantity: String(entry?.quantity || ""),
            unitPrice: String(entry?.unitPrice || ""),
            unitPriceNumber: Number(entry?.unitPriceNumber || 0),
            amount: detailAmount.toFixed(2),
            amountNumber: detailAmount
          };
        });
      }

      return [
        {
          ...baseRow,
          nameSpec: "",
          unit: "",
          quantity: "",
          unitPrice: "",
          unitPriceNumber: null,
          amount: signedTxAmount.toFixed(2),
          amountNumber: signedTxAmount
        }
      ];
    });
}

const LEDGER_SHEET_COLUMNS = [{ width: 14 }, { width: 18 }, { width: 12 }, { width: 30 }, { width: 10 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 28 }];

function fillLedgerWorksheet(sheet, { partner, rows, startDate, endDate, exportedAt }) {
  sheet.columns = LEDGER_SHEET_COLUMNS;
  sheet.mergeCells("A1:I1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = "客户流水明细";
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };

  const rangeText = `${startDate || "不限"} 至 ${endDate || "不限"}`;
  const exportTimeText = new Date(exportedAt).toLocaleString("zh-CN", { hour12: false });
  const metaRows = [
    ["客户名称", String(partner?.name || "")],
    ["对象类型", partnerTypeLabel(partner?.type)],
    ["联系人", String(partner?.contactName || "")],
    ["联系电话", String(partner?.phone || "")],
    ["地址", String(partner?.address || "")],
    ["资料备注", String(partner?.profileRemark || "")],
    ["时间范围", rangeText],
    ["导出时间", exportTimeText]
  ];

  for (const [label, value] of metaRows) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true, color: { argb: "FF374151" } };
    sheet.mergeCells(`B${row.number}:I${row.number}`);
  }

  sheet.addRow([]);

  const headerRow = sheet.addRow(["交易日期", "单号", "类型", "名称规格", "单位", "数量", "单价", "金额", "备注"]);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF3F4F6" }
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD1D5DB" } },
      left: { style: "thin", color: { argb: "FFD1D5DB" } },
      bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
      right: { style: "thin", color: { argb: "FFD1D5DB" } }
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  if (rows.length === 0) {
    const noDataRow = sheet.addRow(["当前时间范围无流水记录", "", "", "", "", "", "", "", ""]);
    sheet.mergeCells(`A${noDataRow.number}:I${noDataRow.number}`);
    noDataRow.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
    noDataRow.getCell(1).font = { color: { argb: "FF6B7280" } };
    return;
  }

  for (const rowItem of rows) {
    const row = sheet.addRow([
      rowItem.transactionDate,
      rowItem.slipNo,
      rowItem.typeLabel,
      rowItem.nameSpec,
      rowItem.unit,
      rowItem.quantity,
      rowItem.unitPriceNumber == null ? null : Number(rowItem.unitPriceNumber || 0),
      Number(rowItem.amountNumber || 0),
      rowItem.remark
    ]);

    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD1D5DB" } },
        left: { style: "thin", color: { argb: "FFD1D5DB" } },
        bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
        right: { style: "thin", color: { argb: "FFD1D5DB" } }
      };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    });

    row.getCell(6).alignment = { vertical: "middle", horizontal: "right", wrapText: true };
    row.getCell(7).alignment = { vertical: "middle", horizontal: "right", wrapText: true };
    row.getCell(8).alignment = { vertical: "middle", horizontal: "right", wrapText: true };
    row.getCell(7).numFmt = "0.00";
    row.getCell(8).numFmt = "0.00";

    if (rowItem.highlightRed) {
      row.eachCell((cell) => {
        cell.font = { color: { argb: "FFC62828" } };
      });
    }
  }
}

function normalizeWorksheetName(text) {
  const cleaned = String(text || "")
    .replace(/[\\/*?:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "工作表";
  return cleaned.slice(0, 31);
}

function buildUniqueWorksheetName(baseName, usedNames) {
  const base = normalizeWorksheetName(baseName);
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }

  let index = 2;
  while (index < 10_000) {
    const suffix = `_${index}`;
    const candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    index += 1;
  }

  const fallback = `${Date.now()}`.slice(-6);
  const candidate = `${base.slice(0, Math.max(1, 31 - fallback.length - 1))}_${fallback}`;
  usedNames.add(candidate);
  return candidate;
}

async function buildLedgerXlsxBuffer({ partner, rows, startDate, endDate, exportedAt }) {
  const ExcelJSImport = await import("exceljs");
  const ExcelJS = ExcelJSImport.default || ExcelJSImport;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("客户流水");
  fillLedgerWorksheet(sheet, { partner, rows, startDate, endDate, exportedAt });

  return workbook.xlsx.writeBuffer();
}

async function buildTotalLedgerXlsxBuffer({ partners, transactions, selectedPartnerIds, startDate, endDate, exportedAt }) {
  const ExcelJSImport = await import("exceljs");
  const ExcelJS = ExcelJSImport.default || ExcelJSImport;
  const workbook = new ExcelJS.Workbook();
  const usedSheetNames = new Set();

  const selectedSet = new Set((selectedPartnerIds || []).map((id) => Number(id)));
  const selectedPartners = (partners || []).filter((partner) => selectedSet.has(Number(partner.id)));
  if (selectedPartners.length === 0) {
    throw new Error("请至少勾选 1 个客户/供应商");
  }

  for (const partner of selectedPartners) {
    const suffix = partner?.type === "supplier" ? "采购" : "出库";
    const baseSheetName = `${String(partner?.name || "对象").trim() || "对象"}-${suffix}`;
    const sheetName = buildUniqueWorksheetName(baseSheetName, usedSheetNames);
    const sheet = workbook.addWorksheet(sheetName);
    const rows = buildPartnerExportRows(transactions, partner, startDate, endDate);
    fillLedgerWorksheet(sheet, {
      partner,
      rows,
      startDate,
      endDate,
      exportedAt
    });
  }

  return workbook.xlsx.writeBuffer();
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

function downloadBlobFile(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  downloadBlobFile(filename, blob);
}

export default function PartnersPage() {
  const { user } = useAuth();
  const canExportFiles = ["admin", "super_admin"].includes(String(user?.role || ""));
  const canSeeLedgerAmounts = ["admin", "super_admin"].includes(String(user?.role || ""));
  const hideDebtStatus = String(user?.role || "user") === "user";
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [currentPartnerId, setCurrentPartnerId] = useState(null);
  const [profileEditMode, setProfileEditMode] = useState(false);
  const [exportRangeModal, setExportRangeModal] = useState({
    open: false,
    partnerId: null,
    startDate: "",
    endDate: ""
  });
  const [exportingFormat, setExportingFormat] = useState("");
  const [totalExportModal, setTotalExportModal] = useState({
    open: false,
    startDate: "",
    endDate: "",
    selectedPartnerIds: []
  });
  const [totalExporting, setTotalExporting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "customer"
  });
  const [nameKeyword, setNameKeyword] = useState("");
  const [pendingDeleteTxId, setPendingDeleteTxId] = useState(null);
  const [profileDraft, setProfileDraft] = useState({
    contactName: "",
    phone: "",
    address: "",
    profileRemark: ""
  });
  const [ledgerFilter, setLedgerFilter] = useState({
    startDate: "",
    endDate: "",
    type: "all",
    keyword: "",
    slipBook: "",
    recordedBy: "all"
  });
  const [ledgerSortBy, setLedgerSortBy] = useState("transactionDate");
  const [ledgerSortDir, setLedgerSortDir] = useState("desc");

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

  const deleteTransactionMutation = useMutation({
    mutationFn: async (id) =>
      apiRequest(`/transactions/${id}`, {
        method: "DELETE"
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["materials"] }),
        queryClient.invalidateQueries({ queryKey: ["processings"] })
      ]);
    }
  });

  const partners = partnersQuery.data || [];
  const transactions = transactionsQuery.data || [];
  const filteredPartners = useMemo(() => {
    const keyword = String(nameKeyword || "").trim().toLowerCase();
    if (!keyword) return partners;
    return partners.filter((p) => String(p.name || "").toLowerCase().includes(keyword));
  }, [partners, nameKeyword]);

  const currentPartner = useMemo(() => {
    if (!currentPartnerId) return null;
    return partners.find((p) => Number(p.id) === Number(currentPartnerId)) || null;
  }, [currentPartnerId, partners]);

  const exportTargetPartner = useMemo(() => {
    if (!exportRangeModal.partnerId) return null;
    return partners.find((p) => Number(p.id) === Number(exportRangeModal.partnerId)) || null;
  }, [exportRangeModal.partnerId, partners]);

  const totalExportCandidates = useMemo(() => {
    return [...partners].sort((a, b) => {
      const typeA = a.type === "customer" ? 0 : 1;
      const typeB = b.type === "customer" ? 0 : 1;
      if (typeA !== typeB) return typeA - typeB;
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
    });
  }, [partners]);

  const totalExportSelectedSet = useMemo(() => {
    return new Set((totalExportModal.selectedPartnerIds || []).map((id) => Number(id)));
  }, [totalExportModal.selectedPartnerIds]);

  const partnerLedgerBaseRows = useMemo(() => {
    if (!currentPartner) return [];
    return transactions
      .filter((t) => Number(t.partnerId) === Number(currentPartner.id))
      .slice()
      .sort(compareTxDesc);
  }, [currentPartner, transactions]);

  const ledgerRecordedByOptions = useMemo(() => {
    const rows = [];
    const nameSet = new Set();
    let hasUnset = false;
    for (const tx of partnerLedgerBaseRows) {
      const username = String(tx?.recordedByUsername || "").trim();
      if (!username) {
        hasUnset = true;
        continue;
      }
      if (nameSet.has(username)) continue;
      nameSet.add(username);
      rows.push(username);
    }
    rows.sort((a, b) => a.localeCompare(b, "zh-CN"));
    return {
      names: rows,
      hasUnset
    };
  }, [partnerLedgerBaseRows]);

  const filteredLedgerRows = useMemo(() => {
    const start = String(ledgerFilter.startDate || "").trim();
    const end = String(ledgerFilter.endDate || "").trim();
    const type = String(ledgerFilter.type || "all");
    const keyword = String(ledgerFilter.keyword || "").trim().toLowerCase();
    const slipBook = normalizeSlipBook(ledgerFilter.slipBook).toLowerCase();
    const recordedBy = String(ledgerFilter.recordedBy || "all");

    return partnerLedgerBaseRows.filter((tx) => {
      if (!isWithinDateRange(tx.transactionDate, start, end)) return false;
      if (type !== "all" && tx.type !== type) return false;

      if (slipBook) {
        const currentSlipBook = normalizeSlipBook(tx.slipBook).toLowerCase();
        if (!currentSlipBook.includes(slipBook)) return false;
      }

      if (recordedBy === LEDGER_RECORDED_BY_UNSET) {
        if (String(tx.recordedByUsername || "").trim()) return false;
      } else if (recordedBy !== "all") {
        if (String(tx.recordedByUsername || "").trim() !== recordedBy) return false;
      }

      if (!keyword) return true;
      const keywordText = [
        slipNoDisplay(tx),
        normalizeSlipBook(tx.slipBook),
        formatTransactionSummary(tx),
        getTransactionDisplayRemark(tx),
        String(tx.transactionDate || ""),
        String(tx.bookkeepingDate || "")
      ]
        .join(" ")
        .toLowerCase();
      return keywordText.includes(keyword);
    });
  }, [partnerLedgerBaseRows, ledgerFilter]);

  const displayLedgerRows = useMemo(() => {
    const rows = [...filteredLedgerRows];
    rows.sort((a, b) => compareLedgerBySort(a, b, ledgerSortBy, ledgerSortDir));
    return rows;
  }, [filteredLedgerRows, ledgerSortBy, ledgerSortDir]);

  const ledgerSummary = useMemo(() => {
    if (!currentPartner) {
      return {
        count: 0,
        totalAmount: 0,
        balance: 0
      };
    }
    return {
      count: partnerLedgerBaseRows.length,
      totalAmount: calculateTradeTotalAmount(currentPartner.id, transactions),
      balance: calculateBalance(currentPartner.id, transactions)
    };
  }, [currentPartner, partnerLedgerBaseRows, transactions]);

  function openLedger(partner) {
    setCurrentPartnerId(partner.id);
    setProfileEditMode(false);
    setLedgerFilter({
      startDate: "",
      endDate: "",
      type: "all",
      keyword: "",
      slipBook: "",
      recordedBy: "all"
    });
    setLedgerSortBy("transactionDate");
    setLedgerSortDir("desc");
    setProfileDraft({
      contactName: String(partner.contactName || ""),
      phone: String(partner.phone || ""),
      address: String(partner.address || ""),
      profileRemark: String(partner.profileRemark || "")
    });
  }

  function setLedgerDateField(field, value) {
    const nextValue = String(value || "").trim();
    const nextStart = field === "startDate" ? nextValue : String(ledgerFilter.startDate || "").trim();
    const nextEnd = field === "endDate" ? nextValue : String(ledgerFilter.endDate || "").trim();
    if (nextStart && nextEnd && nextStart > nextEnd) {
      window.alert("开始日期不能晚于结束日期");
      return;
    }
    setLedgerFilter((prev) => ({ ...prev, [field]: nextValue }));
  }

  function resetLedgerFilterAndSort() {
    setLedgerFilter({
      startDate: "",
      endDate: "",
      type: "all",
      keyword: "",
      slipBook: "",
      recordedBy: "all"
    });
    setLedgerSortBy("transactionDate");
    setLedgerSortDir("desc");
  }

  function exportPartnerTransactionsXls(partner, startDate = "", endDate = "") {
    const start = String(startDate || "").trim();
    const end = String(endDate || "").trim();
    const exportRows = buildPartnerExportRows(transactions, partner, start, end);
    const content = `\uFEFF${buildLedgerExcelHtml({
      partner,
      rows: exportRows,
      startDate: start,
      endDate: end,
      exportedAt: new Date().toISOString()
    })}`;
    const day = new Date().toISOString().slice(0, 10);
    const safeName = String(partner.name || "partner").replace(/[\\/:*?"<>|]/g, "_");
    downloadTextFile(`${safeName}_ledger_${day}.xls`, content, "application/vnd.ms-excel;charset=utf-8;");
  }

  async function exportPartnerTransactionsXlsx(partner, startDate = "", endDate = "") {
    const start = String(startDate || "").trim();
    const end = String(endDate || "").trim();
    const exportRows = buildPartnerExportRows(transactions, partner, start, end);
    const buffer = await buildLedgerXlsxBuffer({
      partner,
      rows: exportRows,
      startDate: start,
      endDate: end,
      exportedAt: new Date().toISOString()
    });
    const day = new Date().toISOString().slice(0, 10);
    const safeName = String(partner.name || "partner").replace(/[\\/:*?"<>|]/g, "_");
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    downloadBlobFile(`${safeName}_ledger_${day}.xlsx`, blob);
  }

  function openExportRangeModal(partner = currentPartner) {
    if (!canExportFiles) {
      window.alert("普通用户无导出权限");
      return;
    }
    if (!partner) return;
    setExportRangeModal({
      open: true,
      partnerId: Number(partner.id),
      startDate: "",
      endDate: ""
    });
  }

  function closeExportRangeModal() {
    setExportingFormat("");
    setExportRangeModal((prev) => ({
      ...prev,
      open: false,
      partnerId: null
    }));
  }

  function clearExportRangeSelection() {
    setExportRangeModal((prev) => ({
      ...prev,
      startDate: "",
      endDate: ""
    }));
  }

  async function confirmExportRangeSelection(format) {
    if (!canExportFiles) {
      window.alert("普通用户无导出权限");
      return;
    }
    const partner = exportTargetPartner;
    if (!partner) return;
    const start = String(exportRangeModal.startDate || "").trim();
    const end = String(exportRangeModal.endDate || "").trim();
    if (start && end && start > end) {
      window.alert("开始日期不能晚于结束日期");
      return;
    }

    try {
      setExportingFormat(format);
      if (format === "xlsx") {
        await exportPartnerTransactionsXlsx(partner, start, end);
      } else {
        exportPartnerTransactionsXls(partner, start, end);
      }
      closeExportRangeModal();
    } catch (error) {
      window.alert(error?.message || "导出失败，请稍后重试");
    } finally {
      setExportingFormat("");
    }
  }

  function openTotalExportModal() {
    if (!canExportFiles) {
      window.alert("普通用户无导出权限");
      return;
    }
    setTotalExportModal({
      open: true,
      startDate: "",
      endDate: "",
      selectedPartnerIds: totalExportCandidates.map((partner) => Number(partner.id))
    });
  }

  function closeTotalExportModal() {
    setTotalExportModal((prev) => ({ ...prev, open: false }));
  }

  function setTotalExportAllSelected() {
    setTotalExportModal((prev) => ({
      ...prev,
      selectedPartnerIds: totalExportCandidates.map((partner) => Number(partner.id))
    }));
  }

  function clearTotalExportSelection() {
    setTotalExportModal((prev) => ({ ...prev, selectedPartnerIds: [] }));
  }

  function toggleTotalExportPartner(partnerId) {
    const id = Number(partnerId);
    setTotalExportModal((prev) => {
      const current = new Set((prev.selectedPartnerIds || []).map((value) => Number(value)));
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return {
        ...prev,
        selectedPartnerIds: [...current]
      };
    });
  }

  async function exportAllLedgersXlsx() {
    if (!canExportFiles) {
      window.alert("普通用户无导出权限");
      return;
    }
    const selectedIds = (totalExportModal.selectedPartnerIds || []).map((id) => Number(id));
    if (selectedIds.length === 0) {
      window.alert("请至少勾选 1 个客户/供应商");
      return;
    }
    const start = String(totalExportModal.startDate || "").trim();
    const end = String(totalExportModal.endDate || "").trim();
    if (start && end && start > end) {
      window.alert("开始日期不能晚于结束日期");
      return;
    }

    try {
      setTotalExporting(true);
      const buffer = await buildTotalLedgerXlsxBuffer({
        partners: totalExportCandidates,
        transactions,
        selectedPartnerIds: selectedIds,
        startDate: start,
        endDate: end,
        exportedAt: new Date().toISOString()
      });

      const day = new Date().toISOString().slice(0, 10);
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      downloadBlobFile(`all_partners_ledger_${day}.xlsx`, blob);
      closeTotalExportModal();
    } catch (error) {
      window.alert(error?.message || "总流水导出失败，请稍后重试");
    } finally {
      setTotalExporting(false);
    }
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
      window.alert("仅出库/入库/销售退货/采购退货记录支持补填单号");
      return;
    }

    const currentBook = normalizeSlipBook(tx.slipBook);
    const currentNo = Number(tx.slipNo || 0);
    const sequenceTypeSet = new Set(slipSequenceTypes(tx.type));
    const sameTypeRows = transactions.filter(
      (item) => sequenceTypeSet.has(item.type) && Number(item.id) !== Number(tx.id)
    );

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

  async function deleteTransaction(tx) {
    const slipText =
      normalizeSlipBook(tx?.slipBook) && Number.isInteger(Number(tx?.slipNo)) && Number(tx?.slipNo) > 0
        ? `${normalizeSlipBook(tx.slipBook)}-${Number(tx.slipNo)}`
        : "-";
    const confirmText = `确认删除该流水吗？\n类型：${typeLabel(tx?.type)}\n交易日期：${tx?.transactionDate || "-"}\n金额：${formatCurrency(
      tx?.amount
    )}\n单号：${slipText}\nID：${tx?.id}\n\n删除后不可恢复。`;
    if (!window.confirm(confirmText)) return;

    try {
      setPendingDeleteTxId(Number(tx.id));
      await deleteTransactionMutation.mutateAsync(Number(tx.id));
      window.alert("流水已删除");
    } catch (error) {
      window.alert(error.message || "删除流水失败");
    } finally {
      setPendingDeleteTxId(null);
    }
  }

  const exportRangeModalView = canExportFiles ? (
    <div
      className={`modal${exportRangeModal.open ? "" : " hidden"}`}
      onClick={(e) => e.target === e.currentTarget && closeExportRangeModal()}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="export-range-title">
        <h3 id="export-range-title">选择导出时间范围</h3>
        <small className="muted-text">
          导出对象：{exportTargetPartner?.name || "未选择"}（支持 .xlsx 主格式与 .xls 备用格式）
        </small>
        <div className="modal-grid">
          <div className="form-group">
            <label>开始日期</label>
            <input
              type="date"
              value={exportRangeModal.startDate}
              onChange={(e) => setExportRangeModal((prev) => ({ ...prev, startDate: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label>结束日期</label>
            <input
              type="date"
              value={exportRangeModal.endDate}
              onChange={(e) => setExportRangeModal((prev) => ({ ...prev, endDate: e.target.value }))}
            />
          </div>
        </div>
        <small className="muted-text">不填开始表示不限制起始，不填结束表示不限制结束。</small>
        <div className="modal-actions">
          <button className="btn btn-outline" onClick={clearExportRangeSelection} disabled={Boolean(exportingFormat)}>
            清空
          </button>
          <button className="btn" onClick={closeExportRangeModal} disabled={Boolean(exportingFormat)}>
            取消
          </button>
          <button
            className="btn btn-outline"
            onClick={() => confirmExportRangeSelection("xls")}
            disabled={Boolean(exportingFormat)}
          >
            {exportingFormat === "xls" ? "导出中..." : "导出 .xls（备用）"}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => confirmExportRangeSelection("xlsx")}
            disabled={Boolean(exportingFormat)}
          >
            {exportingFormat === "xlsx" ? "导出中..." : "导出 .xlsx（推荐）"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const totalExportModalView = canExportFiles ? (
    <div
      className={`modal${totalExportModal.open ? "" : " hidden"}`}
      onClick={(e) => e.target === e.currentTarget && !totalExporting && closeTotalExportModal()}
    >
      <div className="modal-card modal-card-total-ledger" role="dialog" aria-modal="true" aria-labelledby="total-ledger-export-title">
        <h3 id="total-ledger-export-title">总流水导出</h3>
        <small className="muted-text">导出为单个 .xlsx 文件，每个客户/供应商单独一张工作表。</small>
        <div className="modal-grid">
          <div className="form-group">
            <label>开始日期</label>
            <input
              type="date"
              value={totalExportModal.startDate}
              onChange={(e) => setTotalExportModal((prev) => ({ ...prev, startDate: e.target.value }))}
              disabled={totalExporting}
            />
          </div>
          <div className="form-group">
            <label>结束日期</label>
            <input
              type="date"
              value={totalExportModal.endDate}
              onChange={(e) => setTotalExportModal((prev) => ({ ...prev, endDate: e.target.value }))}
              disabled={totalExporting}
            />
          </div>
        </div>
        <small className="muted-text">不填开始表示不限制起始，不填结束表示不限制结束。</small>

        <div className="partner-total-export-toolbar">
          <button className="btn btn-outline btn-compact" type="button" onClick={setTotalExportAllSelected} disabled={totalExporting}>
            全选
          </button>
          <button className="btn btn-outline btn-compact" type="button" onClick={clearTotalExportSelection} disabled={totalExporting}>
            取消全选
          </button>
          <span className="muted-text">
            已勾选 {totalExportSelectedSet.size} / {totalExportCandidates.length} 个对象
          </span>
        </div>

        <div className="partner-total-export-list">
          {totalExportCandidates.length === 0 ? (
            <div className="muted-text">暂无可导出的客户/供应商。</div>
          ) : (
            <div className="partner-total-export-grid">
              {totalExportCandidates.map((partner) => (
                <label key={partner.id} className="partner-total-export-item">
                  <input
                    type="checkbox"
                    checked={totalExportSelectedSet.has(Number(partner.id))}
                    onChange={() => toggleTotalExportPartner(partner.id)}
                    disabled={totalExporting}
                  />
                  <span className="partner-total-export-item-name">{partner.name}</span>
                  <span className="partner-total-export-item-type">
                    {partner.type === "customer" ? "客户（出库）" : "供应商（采购）"}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" type="button" onClick={closeTotalExportModal} disabled={totalExporting}>
            取消
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={exportAllLedgersXlsx}
            disabled={totalExporting || totalExportSelectedSet.size === 0}
          >
            {totalExporting ? "导出中..." : "导出 .xlsx（总流水）"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

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
          <div className="header-actions">
            {canExportFiles ? (
              <button className="btn btn-outline" type="button" onClick={openTotalExportModal}>
                📦 总流水导出
              </button>
            ) : null}
            <button className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)}>
              + 新增客户
            </button>
          </div>
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
          <div className="inline-row">
            <input
              type="text"
              placeholder="按名称检索客户/供应商"
              value={nameKeyword}
              onChange={(e) => setNameKeyword(e.target.value)}
            />
            <span className="muted-text">匹配 {filteredPartners.length} / {partners.length} 条</span>
          </div>
          <table className="fixed-table partners-list-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                {hideDebtStatus ? null : <th>当前欠款状态 (正数=欠我们)</th>}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredPartners.map((p) => {
                let statusText = "两清";
                let statusClass = "status-clear";

                if (!hideDebtStatus) {
                  const balance = calculateBalance(p.id, transactions);
                  if (balance > 0) {
                    statusText = `对方欠我们 ${formatCurrency(balance)}`;
                    statusClass = "status-receivable";
                  } else if (balance < 0) {
                    statusText = `我们欠对方 ${formatCurrency(Math.abs(balance))}`;
                    statusClass = "status-payable";
                  }
                }

                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>{p.type === "customer" ? "客户" : "供应商"}</td>
                    {hideDebtStatus ? null : <td className={`status-cell ${statusClass}`}>{statusText}</td>}
                    <td>
                      <div className="client-actions">
                        <button className="btn btn-small-outline" onClick={() => openLedger(p)}>
                          查看流水
                        </button>
                        {canExportFiles ? (
                          <button className="btn btn-small-outline" onClick={() => openExportRangeModal(p)}>
                            导出流水
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {exportRangeModalView}
        {totalExportModalView}
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
          {canExportFiles ? (
            <button className="btn btn-primary" onClick={() => openExportRangeModal(currentPartner)}>
              📊 导出当前对象流水（xlsx/xls）
            </button>
          ) : null}
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
        {canSeeLedgerAmounts ? (
          <>
            <div className="stat-card stat-card-primary">
              <h3>交易总金额</h3>
              <div className="value">{formatCurrency(ledgerSummary.totalAmount)}</div>
            </div>
            <div className="stat-card stat-card-primary">
              <h3>当前往来余额</h3>
              <div className="value">{formatCurrency(ledgerSummary.balance)}</div>
            </div>
          </>
        ) : null}
      </div>

      <div className="card">
        <div className="recent-bookkeeping-header">
          <h3>流水明细</h3>
          <div className="header-actions">
            <button type="button" className="btn btn-outline btn-compact" onClick={resetLedgerFilterAndSort}>
              重置筛选
            </button>
          </div>
        </div>
        <div className="partner-ledger-toolbar">
          <div className="partner-ledger-filter-grid">
            <div className="form-group">
              <label>开始日期</label>
              <input
                type="date"
                value={ledgerFilter.startDate}
                onChange={(e) => setLedgerDateField("startDate", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>结束日期</label>
              <input type="date" value={ledgerFilter.endDate} onChange={(e) => setLedgerDateField("endDate", e.target.value)} />
            </div>
            <div className="form-group">
              <label>交易类型</label>
              <select value={ledgerFilter.type} onChange={(e) => setLedgerFilter((prev) => ({ ...prev, type: e.target.value }))}>
                <option value="all">全部类型</option>
                <option value="out">出库</option>
                <option value="in">入库</option>
                <option value="sale_return">销售退货</option>
                <option value="purchase_return">采购退货</option>
                <option value="receive">收款</option>
                <option value="pay">付款</option>
                <option value="receive_diff">收款差额</option>
                <option value="pay_diff">付款差额</option>
              </select>
            </div>
            <div className="form-group">
              <label>簿号</label>
              <input
                type="text"
                placeholder="按单据簿号筛选"
                value={ledgerFilter.slipBook}
                onChange={(e) => setLedgerFilter((prev) => ({ ...prev, slipBook: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>记账人</label>
              <select
                value={ledgerFilter.recordedBy}
                onChange={(e) => setLedgerFilter((prev) => ({ ...prev, recordedBy: e.target.value }))}
              >
                <option value="all">全部记账人</option>
                {ledgerRecordedByOptions.hasUnset ? <option value={LEDGER_RECORDED_BY_UNSET}>未标记</option> : null}
                {ledgerRecordedByOptions.names.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group partner-ledger-keyword">
              <label>关键词</label>
              <input
                type="text"
                placeholder="搜索单号/交易明细/备注"
                value={ledgerFilter.keyword}
                onChange={(e) => setLedgerFilter((prev) => ({ ...prev, keyword: e.target.value }))}
              />
            </div>
          </div>
          <div className="partner-ledger-sort-row">
            <small className="muted-text">
              筛选结果 {displayLedgerRows.length} / 总计 {partnerLedgerBaseRows.length} 条
            </small>
            <div className="partner-ledger-sort-actions">
              <label className="recent-bookkeeping-sort">
                <span>排序依据</span>
                <select value={ledgerSortBy} onChange={(e) => setLedgerSortBy(e.target.value)}>
                  <option value="recordedAt">记账时间</option>
                  <option value="id">ID</option>
                  <option value="bookkeepingDate">记账日期</option>
                  <option value="transactionDate">交易日期</option>
                  <option value="amount">金额</option>
                  <option value="type">类型</option>
                </select>
              </label>
              <button
                type="button"
                className="btn btn-outline btn-compact"
                onClick={() => setLedgerSortDir((prev) => (prev === "desc" ? "asc" : "desc"))}
              >
                {ledgerSortDir === "desc" ? "降序" : "升序"}
              </button>
            </div>
          </div>
        </div>
        <table className="fixed-table partner-ledger-table">
          <thead>
            <tr>
              <th>单号</th>
              <th>交易日期</th>
              <th>类型</th>
              <th>金额</th>
              <th>交易明细</th>
              <th>备注</th>
              <th>操作</th>
              <th>单据簿号</th>
              <th>记账人</th>
            </tr>
          </thead>
          <tbody>
            {displayLedgerRows.map((tx) => (
              <tr key={tx.id}>
                <td>{slipNoDisplay(tx)}</td>
                <td>{tx.transactionDate}</td>
                <td>
                  <span className={typeBadgeClass(tx.type)}>{typeLabel(tx.type)}</span>
                </td>
                <td>{formatCurrency(tx.amount)}</td>
                <td>{formatTransactionSummary(tx)}</td>
                <td>{getTransactionDisplayRemark(tx)}</td>
                <td>
                  <div className="client-actions">
                    {needsWarehouseSlip(tx.type) ? (
                      <button className="btn btn-small-outline" onClick={() => editTransactionSlipInfo(tx)}>
                        补填/修改单号
                      </button>
                    ) : null}
                    <button
                      className="btn btn-small-outline"
                      onClick={() => deleteTransaction(tx)}
                      disabled={deleteTransactionMutation.isPending && pendingDeleteTxId === Number(tx.id)}
                    >
                      {deleteTransactionMutation.isPending && pendingDeleteTxId === Number(tx.id) ? "删除中..." : "删除"}
                    </button>
                  </div>
                </td>
                <td>{normalizeSlipBook(tx.slipBook) || "-"}</td>
                <td>{tx.recordedByUsername || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {displayLedgerRows.length === 0 ? <div className="muted-text">当前筛选条件下无流水记录。</div> : null}
      </div>

      {exportRangeModalView}
    </section>
  );
}
