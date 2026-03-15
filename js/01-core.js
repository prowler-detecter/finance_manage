console.log("系统开始加载...");

const TX_STATE = {
    items: [],
    amountManualOverride: false
};

const VIEW_STATE = {
    currentLedgerPartnerId: null,
    profileEditMode: false,
    profileDraft: null
};

const EXPORT_RANGE_STATE = {
    resolver: null,
    lastStartDate: "",
    lastEndDate: ""
};

const STOCK_ADJUST_STATE = {
    productId: null
};

const SLIP_STATE = {
    lastAutoContext: ""
};

let lastTransactionType = null;

const DB = {
    partners: [],
    products: [],
    transactions: [],
    stockAdjustments: [],
    hasLoadIssue: false,
    hasExistingStorageData: false,
    load() {
        const partnerRaw = localStorage.getItem("partners");
        const productRaw = localStorage.getItem("products");
        const transactionRaw = localStorage.getItem("transactions");
        const stockAdjustRaw = localStorage.getItem("stockAdjustments");

        this.hasExistingStorageData = !!(partnerRaw || productRaw || transactionRaw || stockAdjustRaw);
        this.hasLoadIssue = false;

        const safeParseArray = (raw, keyName) => {
            if (!raw) return [];
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                this.hasLoadIssue = true;
                console.error(`${keyName} 读取失败，已跳过该数据段`, error);
                return [];
            }
        };

        const partners = safeParseArray(partnerRaw, "partners");
        const products = safeParseArray(productRaw, "products");
        const transactions = safeParseArray(transactionRaw, "transactions");
        const stockAdjustments = safeParseArray(stockAdjustRaw, "stockAdjustments");

        this.partners = partners.map((p, i) => sanitizePartner(p, i));
        this.products = products.map((p, i) => sanitizeProduct(p, i));
        this.transactions = transactions.map((t, i) => sanitizeTransaction(t, i));
        this.stockAdjustments = stockAdjustments.map((a, i) => sanitizeStockAdjustment(a, i)).filter(Boolean);
        console.log("数据已加载");
    },
    save() {
        localStorage.setItem("partners", JSON.stringify(this.partners));
        localStorage.setItem("products", JSON.stringify(this.products));
        localStorage.setItem("transactions", JSON.stringify(this.transactions));
        localStorage.setItem("stockAdjustments", JSON.stringify(this.stockAdjustments));
        refreshUI();
    }
};

function sanitizePartner(partner, fallbackIndex) {
    const id = toNumber(partner && partner.id, Date.now() + fallbackIndex);
    const type = partner && partner.type === "supplier" ? "supplier" : "customer";
    return {
        id: id,
        name: String(partner && partner.name ? partner.name : "").trim() || `未命名对象${fallbackIndex + 1}`,
        type: type,
        contactName: String(partner && partner.contactName ? partner.contactName : "").trim(),
        phone: String(partner && partner.phone ? partner.phone : "").trim(),
        address: String(partner && partner.address ? partner.address : "").trim(),
        profileRemark: String(partner && partner.profileRemark ? partner.profileRemark : "").trim()
    };
}

function sanitizeProduct(product, fallbackIndex) {
    const lastUpdatedRaw = String(product && product.lastStockUpdatedAt ? product.lastStockUpdatedAt : "").trim();
    return {
        id: toNumber(product && product.id, Date.now() + fallbackIndex + 1000),
        name: String(product && product.name ? product.name : "").trim() || `未命名产品${fallbackIndex + 1}`,
        sku: String(product && product.sku ? product.sku : "").trim(),
        spec: String(product && product.spec ? product.spec : "").trim(),
        unit: String(product && product.unit ? product.unit : "").trim(),
        defaultUnitPrice: toMoneyNumber(product && product.defaultUnitPrice),
        active: product && product.active === false ? false : true,
        lastStockUpdatedAt: lastUpdatedRaw || null
    };
}

function sanitizeTransaction(transaction, fallbackIndex) {
    const safeType = ["out", "in", "sale_return", "purchase_return", "receive", "pay"].includes(transaction && transaction.type) ? transaction.type : "out";
    const safeAmount = toMoneyNumber(transaction && transaction.amount);
    const safeItems = Array.isArray(transaction && transaction.items) ? transaction.items.map(sanitizeTransactionItem).filter(Boolean) : [];
    const computedFromItems = safeItems.reduce((sum, item) => sum + item.lineAmount, 0);
    let safeComputedAmount = toMoneyNumber(transaction && transaction.computedAmount);
    if (needsProductItems(safeType) && safeItems.length > 0 && safeComputedAmount <= 0) {
        safeComputedAmount = computedFromItems;
    }

    const sourceTransactionId = toNumber(transaction && transaction.sourceTransactionId, 0);
    const slipBook = String(transaction && transaction.slipBook ? transaction.slipBook : "").trim();
    const slipNo = toNumber(transaction && transaction.slipNo, 0);
    const legacyDate = String(transaction && transaction.date ? transaction.date : "").trim();
    const fallbackTxDate = legacyDate || String(transaction && transaction.bookkeepingDate ? transaction.bookkeepingDate : "").trim();
    const transactionDate = normalizeDateOrToday(transaction && transaction.transactionDate, fallbackTxDate);
    const bookkeepingDate = normalizeDateOrToday(transaction && transaction.bookkeepingDate, transactionDate);
    const recordedAt = ensureRecordTime(transaction && transaction.recordedAt, bookkeepingDate);
    const normalized = {
        id: toNumber(transaction && transaction.id, Date.now() + fallbackIndex + 2000),
        transactionDate: transactionDate,
        bookkeepingDate: bookkeepingDate,
        recordedAt: recordedAt,
        type: safeType,
        partnerId: toNumber(transaction && transaction.partnerId, 0),
        amount: safeAmount,
        remark: String(transaction && transaction.remark ? transaction.remark : ""),
        sourceRef: String(transaction && transaction.sourceRef ? transaction.sourceRef : "").trim()
    };

    if (sourceTransactionId > 0) normalized.sourceTransactionId = sourceTransactionId;
    if (needsWarehouseSlip(safeType) && slipBook && slipNo > 0) {
        normalized.slipBook = slipBook;
        normalized.slipNo = toIntegerNumber(slipNo, 0);
    }

    if (needsProductItems(safeType)) {
        normalized.items = safeItems;
        normalized.computedAmount = safeComputedAmount;
    }
    return normalized;
}

function sanitizeStockAdjustment(adjustment, fallbackIndex) {
    if (!adjustment) return null;
    const productId = toNumber(adjustment.productId, 0);
    if (!productId) return null;
    const mode = adjustment.mode === "set" ? "set" : "delta";
    const changeQty = toSignedInteger(adjustment.changeQty, 0);
    const beforeQty = toSignedInteger(adjustment.beforeQty, 0);
    const afterQty = toSignedInteger(adjustment.afterQty, beforeQty + changeQty);
    const updatedAtRaw = String(adjustment.updatedAt || "").trim();
    const fallbackBizDate = extractISODateFromDateTime(updatedAtRaw);
    const bizDate = normalizeDateOrToday(adjustment.bizDate, fallbackBizDate);
    const recordedAt = ensureRecordTime(adjustment.recordedAt || updatedAtRaw, bizDate);
    return {
        id: toNumber(adjustment.id, Date.now() + fallbackIndex + 5000),
        productId: productId,
        mode: mode,
        changeQty: changeQty,
        beforeQty: beforeQty,
        afterQty: afterQty,
        bizDate: bizDate,
        remark: String(adjustment.remark || "").trim(),
        recordedAt: recordedAt,
        // 兼容旧版本备份字段
        updatedAt: recordedAt,
        operator: String(adjustment.operator || "").trim()
    };
}

function sanitizeTransactionItem(item) {
    if (!item) return null;
    const quantity = toIntegerNumber(item.quantity);
    const unitPrice = toMoneyNumber(item.unitPrice);
    const lineAmount = toMoneyNumber(item.lineAmount > 0 ? item.lineAmount : quantity * unitPrice);
    const productSnapshot = item.productSnapshot ? item.productSnapshot : {};
    return {
        productId: toNumber(item.productId, 0),
        productSnapshot: {
            name: String(productSnapshot.name || item.name || "").trim(),
            sku: String(productSnapshot.sku || item.sku || "").trim(),
            spec: String(productSnapshot.spec || item.spec || "").trim(),
            unit: String(productSnapshot.unit || item.unit || "").trim()
        },
        quantity: quantity > 0 ? quantity : 0,
        unitPrice: unitPrice,
        lineAmount: lineAmount
    };
}

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function toMoneyNumber(value, fallback = 0) {
    const num = parseFloat(value);
    if (!Number.isFinite(num) || num < 0) return fallback;
    return parseFloat(num.toFixed(2));
}

function toIntegerNumber(value, fallback = 0) {
    const num = parseInt(value, 10);
    if (!Number.isFinite(num) || num < 0) return fallback;
    return num;
}

function toSignedInteger(value, fallback = 0) {
    const num = parseInt(value, 10);
    if (!Number.isFinite(num)) return fallback;
    return num;
}

function isIntegerText(value) {
    return /^-?\d+$/.test(String(value).trim());
}

function getTodayISODate() {
    return new Date().toISOString().split("T")[0];
}

function normalizeDateOrToday(rawDate, fallbackDate = "") {
    const dateText = String(rawDate || "").trim();
    if (isValidISODate(dateText)) return dateText;
    const fallbackText = String(fallbackDate || "").trim();
    if (isValidISODate(fallbackText)) return fallbackText;
    return getTodayISODate();
}

function ensureRecordTime(rawTime, fallbackDate = "") {
    const text = String(rawTime || "").trim();
    if (text) {
        const parsedMs = new Date(text).getTime();
        if (!Number.isNaN(parsedMs)) return new Date(parsedMs).toISOString();
    }
    const safeDate = normalizeDateOrToday(fallbackDate);
    return `${safeDate}T00:00:00.000Z`;
}

function getRecordTimeMs(rawTime, fallbackDate = "") {
    return new Date(ensureRecordTime(rawTime, fallbackDate)).getTime();
}

function extractISODateFromDateTime(rawTime) {
    const text = String(rawTime || "").trim();
    if (!text) return "";
    const parsedMs = new Date(text).getTime();
    if (Number.isNaN(parsedMs)) return "";
    return new Date(parsedMs).toISOString().split("T")[0];
}

function getTransactionDate(transaction) {
    if (!transaction) return getTodayISODate();
    const legacyDate = String(transaction.date || "").trim();
    return normalizeDateOrToday(transaction.transactionDate, legacyDate || transaction.bookkeepingDate);
}

function getTransactionBookkeepingDate(transaction) {
    if (!transaction) return getTodayISODate();
    const legacyDate = String(transaction.date || "").trim();
    const fallback = getTransactionDate(transaction) || legacyDate;
    return normalizeDateOrToday(transaction.bookkeepingDate, fallback);
}

function getTransactionRecordedAt(transaction) {
    return ensureRecordTime(transaction && transaction.recordedAt, getTransactionBookkeepingDate(transaction));
}

function getAdjustmentBizDate(adjustment) {
    if (!adjustment) return getTodayISODate();
    const fallbackDate = extractISODateFromDateTime(adjustment.updatedAt);
    return normalizeDateOrToday(adjustment.bizDate, fallbackDate);
}

function getAdjustmentRecordedAt(adjustment) {
    return ensureRecordTime(adjustment && (adjustment.recordedAt || adjustment.updatedAt), getAdjustmentBizDate(adjustment));
}

function isReturnType(type) {
    return type === "sale_return" || type === "purchase_return";
}

function getExpectedPartnerType(type) {
    if (type === "out" || type === "sale_return" || type === "receive") return "customer";
    if (type === "in" || type === "purchase_return" || type === "pay") return "supplier";
    return "";
}

function init() {
    const currentDateEl = document.getElementById("current-date");
    const transactionDateInput = document.getElementById("t-transaction-date");
    const bookkeepingDateInput = document.getElementById("t-bookkeeping-date");
    if (currentDateEl) currentDateEl.innerText = new Date().toLocaleDateString();
    if (transactionDateInput) transactionDateInput.valueAsDate = new Date();
    if (bookkeepingDateInput) bookkeepingDateInput.valueAsDate = new Date();

    DB.load();
    if (!DB.hasExistingStorageData && DB.partners.length === 0 && DB.products.length === 0 && DB.transactions.length === 0) {
        DB.partners.push({ id: 1, name: "示例客户A", type: "customer" });
        DB.partners.push({ id: 2, name: "示例供应商B", type: "supplier" });
        DB.save();
    }
    refreshUI();
    updateFormHints();

    if (DB.hasLoadIssue) {
        alert("检测到部分本地数据读取异常，系统已尽量保留可读取数据。若你有备份文件，可用于恢复。");
    }
}

function refreshUI() {
    renderPartnerSelect();
    updateReturnSourceSection();
    updateWarehouseSlipSection(false);
    renderDashboard();
    renderClientList();
    renderPartnerLedgerPage();
    renderInventoryList();
    renderProductList();
    renderProductItemsSection();
}

function renderPartnerSelect() {
    const select = document.getElementById("t-partner");
    if (!select) return;
    const previousValue = toNumber(select.value, 0);
    const expectedType = getExpectedPartnerType(getCurrentTransactionType());
    select.innerHTML = '<option value="">-- 请选择 --</option>';
    DB.partners.forEach((p) => {
        if (expectedType && p.type !== expectedType) return;
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.innerText = `${p.name} (${p.type === "customer" ? "客户" : "供应商"})`;
        select.appendChild(opt);
    });

    if (previousValue && DB.partners.some((p) => p.id === previousValue && (!expectedType || p.type === expectedType))) {
        select.value = String(previousValue);
    }
}

