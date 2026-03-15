function triggerImportJSON() {
    const fileInput = document.getElementById("import-json-input");
    if (!fileInput) {
        alert("导入控件未初始化");
        return;
    }
    fileInput.value = "";
    fileInput.click();
}

async function handleImportJSONFile(event) {
    const input = event && event.target ? event.target : null;
    const file = input && input.files && input.files[0] ? input.files[0] : null;
    if (!file) return;

    try {
        const content = await file.text();
        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== "object") {
            alert("备份文件格式不正确");
            return;
        }

        const partnersRaw = Array.isArray(parsed.partners) ? parsed.partners : [];
        const productsRaw = Array.isArray(parsed.products) ? parsed.products : [];
        const transactionsRaw = Array.isArray(parsed.transactions) ? parsed.transactions : [];
        const stockAdjustmentsRaw = Array.isArray(parsed.stockAdjustments) ? parsed.stockAdjustments : [];

        const confirmRestore = window.confirm(`将恢复数据：客户/供应商 ${partnersRaw.length} 条，产品 ${productsRaw.length} 条，交易 ${transactionsRaw.length} 条，库存调整 ${stockAdjustmentsRaw.length} 条。\n此操作会覆盖当前页面数据，是否继续？`);
        if (!confirmRestore) return;

        DB.partners = partnersRaw.map((p, i) => sanitizePartner(p, i));
        DB.products = productsRaw.map((p, i) => sanitizeProduct(p, i));
        DB.transactions = transactionsRaw.map((t, i) => sanitizeTransaction(t, i));
        DB.stockAdjustments = stockAdjustmentsRaw.map((a, i) => sanitizeStockAdjustment(a, i)).filter(Boolean);
        DB.save();
        alert("备份导入完成");
    } catch (error) {
        console.error("导入备份失败", error);
        alert("导入失败：文件不是有效的 JSON 备份或内容损坏");
    }
}

function exportJSON() {
    const backupData = {
        partners: DB.partners,
        products: DB.products,
        transactions: DB.transactions,
        stockAdjustments: DB.stockAdjustments
    };
    const dataStr = JSON.stringify(backupData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `财务系统完整备份_${getExportDateString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function getTypeLabel(type) {
    if (type === "out") return "出库";
    if (type === "in") return "入库";
    if (type === "sale_return") return "销售退货";
    if (type === "purchase_return") return "采购退货";
    if (type === "receive") return "收款";
    if (type === "pay") return "付款";
    return "未知";
}

function getTypeBadgeClass(type) {
    if (type === "out") return "bg-out";
    if (type === "in") return "bg-in";
    if (type === "sale_return") return "bg-return-in";
    if (type === "purchase_return") return "bg-return-out";
    if (type === "receive") return "bg-pay";
    if (type === "pay") return "bg-in";
    return "bg-in";
}

function getTransactionReferenceText(transaction) {
    const parts = [];
    const sourceTxId = toNumber(transaction && transaction.sourceTransactionId, 0);
    const sourceRef = String(transaction && transaction.sourceRef ? transaction.sourceRef : "").trim();
    if (sourceTxId > 0) parts.push(`原交易ID:${sourceTxId}`);
    if (sourceRef) parts.push(`原单号:${sourceRef}`);
    return parts.join("；");
}

function getTransactionSlipText(transaction) {
    const slipBook = normalizeSlipBook(transaction && transaction.slipBook);
    const slipNo = toIntegerNumber(transaction && transaction.slipNo, 0);
    if (!slipBook || slipNo <= 0) return "";
    return `单据:${slipBook}-${slipNo}`;
}

function getTransactionSlipNoDisplay(transaction) {
    const slipNo = toIntegerNumber(transaction && transaction.slipNo, 0);
    return slipNo > 0 ? String(slipNo) : "-";
}

function getTransactionSlipBookDisplay(transaction) {
    const slipBook = normalizeSlipBook(transaction && transaction.slipBook);
    return slipBook || "-";
}

function getTransactionDisplayRemark(transaction) {
    const remark = String(transaction && transaction.remark ? transaction.remark : "").trim();
    const refText = getTransactionReferenceText(transaction);
    const parts = [remark, refText].filter((part) => part);
    return parts.length > 0 ? parts.join(" | ") : "-";
}

function getTransactionPreviewRemark(transaction) {
    const displayRemark = getTransactionDisplayRemark(transaction);
    if (displayRemark !== "-") return displayRemark;
    return formatItemSummary(transaction.items) || "-";
}

function formatItemSummary(items) {
    if (!Array.isArray(items) || items.length === 0) return "";
    const parts = items.slice(0, 2).map((item) => {
        const snapshot = item.productSnapshot || {};
        return `${snapshot.name || "产品"} x${item.quantity || 0}`;
    });
    const moreCount = items.length - parts.length;
    return moreCount > 0 ? `${parts.join("，")} 等${items.length}项` : parts.join("，");
}

function findProductById(productId) {
    const targetId = toNumber(productId, 0);
    return DB.products.find((p) => p.id === targetId);
}

function showPage(pageId) {
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    const target = document.getElementById("page-" + pageId);
    if (target) target.classList.add("active");
    document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
    const navId = pageId === "partner-ledger" ? "clients" : pageId;
    const navBtn = document.getElementById("nav-" + navId);
    if (navBtn) navBtn.classList.add("active");
}

function filterTransactions(partnerId) {
    showPartnerLedgerPage(partnerId);
}

init();
