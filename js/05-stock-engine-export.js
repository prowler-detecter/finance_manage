function getStockDeltaByTransactionType(type, quantity) {
    if (type === "in" || type === "sale_return") return quantity;
    if (type === "out" || type === "purchase_return") return -quantity;
    return 0;
}

function compareStockEventsByTimeline(a, b) {
    if (a.businessDate !== b.businessDate) return a.businessDate < b.businessDate ? -1 : 1;

    const aMs = getRecordTimeMs(a.recordedAt, a.businessDate);
    const bMs = getRecordTimeMs(b.recordedAt, b.businessDate);
    if (aMs !== bMs) return aMs - bMs;

    const aId = toNumber(a.sortId, 0);
    const bId = toNumber(b.sortId, 0);
    if (aId !== bId) return aId - bId;

    const aType = String(a.eventType || "");
    const bType = String(b.eventType || "");
    if (aType === bType) return 0;
    return aType < bType ? -1 : 1;
}

function buildProductStockEvents(productId, pendingEvents = []) {
    const events = [];
    const targetProductId = toNumber(productId, 0);
    if (!targetProductId) return events;

    DB.transactions.forEach((transaction) => {
        if (!hasStockImpact(transaction.type) || !Array.isArray(transaction.items)) return;
        const businessDate = getTransactionDate(transaction);
        const recordedAt = getTransactionRecordedAt(transaction);
        transaction.items.forEach((item) => {
            if (toNumber(item.productId, 0) !== targetProductId) return;
            const quantity = toIntegerNumber(item.quantity, 0);
            if (quantity <= 0) return;
            const delta = getStockDeltaByTransactionType(transaction.type, quantity);
            if (delta === 0) return;
            events.push({
                eventType: "tx",
                businessDate: businessDate,
                recordedAt: recordedAt,
                sortId: transaction.id,
                transactionType: transaction.type,
                delta: delta
            });
        });
    });

    DB.stockAdjustments.forEach((adjustment) => {
        if (toNumber(adjustment.productId, 0) !== targetProductId) return;
        const businessDate = getAdjustmentBizDate(adjustment);
        const recordedAt = getAdjustmentRecordedAt(adjustment);
        if (adjustment.mode === "set") {
            events.push({
                eventType: "adjust-set",
                businessDate: businessDate,
                recordedAt: recordedAt,
                sortId: adjustment.id,
                setQty: toSignedInteger(adjustment.afterQty, 0)
            });
            return;
        }
        events.push({
            eventType: "adjust-delta",
            businessDate: businessDate,
            recordedAt: recordedAt,
            sortId: adjustment.id,
            delta: toSignedInteger(adjustment.changeQty, 0)
        });
    });

    if (Array.isArray(pendingEvents) && pendingEvents.length > 0) {
        pendingEvents.forEach((event) => events.push(event));
    }

    return events.sort(compareStockEventsByTimeline);
}

function computeStockFromEvents(events, markerKey = "") {
    let stock = 0;
    let markerBefore = null;
    let markerAfter = null;

    events.forEach((event) => {
        if (markerKey && event.markerKey === markerKey) {
            markerBefore = stock;
        }

        if (event.eventType === "adjust-set") {
            stock = toSignedInteger(event.setQty, stock);
        } else {
            stock += toSignedInteger(event.delta, 0);
        }

        if (markerKey && event.markerKey === markerKey) {
            markerAfter = stock;
        }
    });

    return {
        stock: stock,
        markerBefore: markerBefore,
        markerAfter: markerAfter
    };
}

function previewStockWithPendingAdjustment(productId, pendingAdjustment) {
    if (!pendingAdjustment) return null;
    const mode = pendingAdjustment.mode === "set" ? "set" : "delta";
    const markerKey = `pending|${Date.now()}|${Math.random()}`;
    const pendingEvent = {
        markerKey: markerKey,
        eventType: mode === "set" ? "adjust-set" : "adjust-delta",
        businessDate: normalizeDateOrToday(pendingAdjustment.bizDate),
        recordedAt: ensureRecordTime(pendingAdjustment.recordedAt, pendingAdjustment.bizDate),
        sortId: toNumber(pendingAdjustment.id, Date.now()),
        setQty: mode === "set" ? toSignedInteger(pendingAdjustment.quantity, 0) : undefined,
        delta: mode === "delta" ? toSignedInteger(pendingAdjustment.quantity, 0) : undefined
    };

    const events = buildProductStockEvents(productId, [pendingEvent]);
    const result = computeStockFromEvents(events, markerKey);
    if (result.markerBefore === null || result.markerAfter === null) return null;

    return {
        before: result.markerBefore,
        after: result.markerAfter,
        change: result.markerAfter - result.markerBefore,
        current: result.stock
    };
}

function calculateProductStock(productId) {
    const events = buildProductStockEvents(productId);
    return computeStockFromEvents(events).stock;
}

function getExportDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function sanitizeFileName(name) {
    const safeName = String(name || "未知对象").replace(/[\\/:*?"<>|]/g, "_").trim();
    return safeName || "未知对象";
}

function normalizeSheetName(name) {
    const safeName = String(name || "流水").replace(/[\\/?*[\]:]/g, " ").trim();
    if (!safeName) return "流水";
    return safeName.slice(0, 31);
}

function isValidISODate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const parts = dateStr.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;

    const dt = new Date(Date.UTC(year, month - 1, day));
    return dt.getUTCFullYear() === year && dt.getUTCMonth() + 1 === month && dt.getUTCDate() === day;
}

function getExportRangeModalElements() {
    return {
        modal: document.getElementById("export-range-modal"),
        startInput: document.getElementById("export-start-date"),
        endInput: document.getElementById("export-end-date")
    };
}

function openExportRangeModal() {
    const els = getExportRangeModalElements();
    if (!els.modal || !els.startInput || !els.endInput) {
        alert("导出日期选择器未初始化");
        return Promise.resolve({ ok: false, canceled: true });
    }
    if (EXPORT_RANGE_STATE.resolver) {
        alert("请先完成当前导出日期选择");
        return Promise.resolve({ ok: false, canceled: true });
    }

    els.startInput.value = EXPORT_RANGE_STATE.lastStartDate || "";
    els.endInput.value = EXPORT_RANGE_STATE.lastEndDate || "";
    els.modal.classList.remove("hidden");

    return new Promise((resolve) => {
        EXPORT_RANGE_STATE.resolver = resolve;
    });
}

function resolveExportRangeSelection(result) {
    const { modal } = getExportRangeModalElements();
    if (modal) modal.classList.add("hidden");

    if (!EXPORT_RANGE_STATE.resolver) return;
    const resolver = EXPORT_RANGE_STATE.resolver;
    EXPORT_RANGE_STATE.resolver = null;
    resolver(result);
}

function clearExportRangeSelection() {
    const { startInput, endInput } = getExportRangeModalElements();
    if (startInput) startInput.value = "";
    if (endInput) endInput.value = "";
}

function cancelExportRangeSelection() {
    resolveExportRangeSelection({ ok: false, canceled: true });
}

function confirmExportRangeSelection() {
    const { startInput, endInput } = getExportRangeModalElements();
    if (!startInput || !endInput) {
        resolveExportRangeSelection({ ok: false, canceled: true });
        return;
    }

    const startDate = String(startInput.value || "").trim();
    const endDate = String(endInput.value || "").trim();

    if (startDate && !isValidISODate(startDate)) {
        alert("开始日期格式不正确，请使用 YYYY-MM-DD");
        return;
    }
    if (endDate && !isValidISODate(endDate)) {
        alert("结束日期格式不正确，请使用 YYYY-MM-DD");
        return;
    }
    if (startDate && endDate && startDate > endDate) {
        alert("日期范围无效：开始日期不能晚于结束日期");
        return;
    }

    EXPORT_RANGE_STATE.lastStartDate = startDate;
    EXPORT_RANGE_STATE.lastEndDate = endDate;
    resolveExportRangeSelection({
        ok: true,
        canceled: false,
        startDate: startDate,
        endDate: endDate
    });
}

function handleExportRangeModalBackdrop(event) {
    if (!event || !event.target) return;
    if (event.target.id === "export-range-modal") cancelExportRangeSelection();
}

async function promptExportDateRange() {
    return openExportRangeModal();
}

function filterTransactionsByDateRange(transactions, startDate, endDate) {
    return transactions.filter((transaction) => {
        const txDate = getTransactionDate(transaction);
        if (startDate && txDate < startDate) return false;
        if (endDate && txDate > endDate) return false;
        return true;
    });
}

function getDateRangeSuffix(startDate, endDate) {
    if (startDate && endDate) return `_${startDate}_${endDate}`;
    if (startDate) return `_from_${startDate}`;
    if (endDate) return `_to_${endDate}`;
    return "";
}

function buildRangeAwareExportFileName(baseName, startDate, endDate, extension) {
    const rangeSuffix = getDateRangeSuffix(startDate, endDate);
    if (rangeSuffix) return `${baseName}${rangeSuffix}.${extension}`;
    return `${baseName}_${getExportDateString()}.${extension}`;
}

function buildTransactionExportRows(transactions) {
    const rows = [[
        "日期",
        "类型",
        "对象",
        "单据簿号",
        "单据号",
        "产品名称",
        "产品编码",
        "规格",
        "单位",
        "数量",
        "单价",
        "小计",
        "明细汇总金额",
        "交易总金额",
        "备注"
    ]];

    transactions.forEach((transaction) => {
        const partner = DB.partners.find((p) => p.id === transaction.partnerId);
        const partnerName = partner ? partner.name : "未知";
        const typeLabel = getTypeLabel(transaction.type);
        const items = Array.isArray(transaction.items) ? transaction.items : [];
        const computedAmount = toMoneyNumber(transaction.computedAmount || items.reduce((sum, item) => sum + toMoneyNumber(item.lineAmount), 0));
        const remarkText = getTransactionDisplayRemark(transaction);
        const slipBook = normalizeSlipBook(transaction.slipBook);
        const slipNo = toIntegerNumber(transaction.slipNo, 0);

        if (needsProductItems(transaction.type) && items.length > 0) {
            items.forEach((item) => {
                const snapshot = item.productSnapshot || {};
                rows.push([
                    getTransactionDate(transaction),
                    typeLabel,
                    partnerName,
                    slipBook,
                    slipNo > 0 ? slipNo : "",
                    snapshot.name || "",
                    snapshot.sku || "",
                    snapshot.spec || "",
                    snapshot.unit || "",
                    item.quantity,
                    toMoneyNumber(item.unitPrice),
                    toMoneyNumber(item.lineAmount),
                    computedAmount,
                    toMoneyNumber(transaction.amount),
                    remarkText === "-" ? "" : remarkText
                ]);
            });
            return;
        }

        rows.push([
            getTransactionDate(transaction),
            typeLabel,
            partnerName,
            slipBook,
            slipNo > 0 ? slipNo : "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            toMoneyNumber(transaction.amount),
            remarkText === "-" ? "" : remarkText
        ]);
    });

    return rows;
}

async function exportExcel() {
    if (typeof XLSX === "undefined") {
        alert("Excel 库加载中，请稍后...");
        return;
    }
    if (DB.transactions.length === 0) return alert("没有数据可导出");

    const dateRange = await promptExportDateRange();
    if (!dateRange.ok) return;

    const filteredTransactions = filterTransactionsByDateRange(DB.transactions, dateRange.startDate, dateRange.endDate);
    if (filteredTransactions.length === 0) {
        alert("该时间范围内无可导出流水");
        return;
    }

    const data = buildTransactionExportRows(filteredTransactions);
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "财务流水");
    const fileName = buildRangeAwareExportFileName("财务流水", dateRange.startDate, dateRange.endDate, "xlsx");
    XLSX.writeFile(workbook, fileName);
}

async function exportPartnerTransactions(partnerId) {
    if (typeof XLSX === "undefined") {
        alert("Excel 库加载中，请稍后...");
        return;
    }

    const targetPartnerId = toNumber(partnerId, 0);
    const partner = DB.partners.find((p) => p.id === targetPartnerId);
    if (!partner) {
        alert("未找到该客户/供应商");
        return;
    }

    const partnerTransactions = DB.transactions.filter((t) => t.partnerId === targetPartnerId);
    if (partnerTransactions.length === 0) {
        alert(`[${partner.name}] 暂无流水可导出`);
        return;
    }

    const dateRange = await promptExportDateRange();
    if (!dateRange.ok) return;

    const filteredTransactions = filterTransactionsByDateRange(partnerTransactions, dateRange.startDate, dateRange.endDate);
    if (filteredTransactions.length === 0) {
        alert("该时间范围内无可导出流水");
        return;
    }

    const data = buildTransactionExportRows(filteredTransactions);
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    const sheetName = normalizeSheetName(`${partner.name}流水`);
    const safePartnerName = sanitizeFileName(partner.name);
    const roleLabel = partner.type === "customer" ? "客户" : "供应商";
    const fileBaseName = `${roleLabel}流水_${safePartnerName}`;

    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    const fileName = buildRangeAwareExportFileName(fileBaseName, dateRange.startDate, dateRange.endDate, "xlsx");
    XLSX.writeFile(workbook, fileName);
}

