function renderProductList() {
    const tbody = document.querySelector("#product-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    DB.products.forEach((product) => {
        const tr = document.createElement("tr");
        const stock = calculateProductStock(product.id);
        const statusClass = product.active ? "status-chip" : "status-chip status-chip-inactive";
        const statusText = product.active ? "启用" : "停用";
        const stockClass = stock < 0 ? "negative-stock" : (stock > 0 ? "positive-stock" : "");
        tr.innerHTML = `<td>${product.name}</td><td>${product.sku || "-"}</td><td>${product.spec || "-"}</td><td>${product.unit || "-"}</td><td>¥${toMoneyNumber(product.defaultUnitPrice).toFixed(2)}</td><td class="${stockClass}">${stock}</td><td><span class="${statusClass}">${statusText}</span></td><td><button class="btn btn-small-outline" onclick="toggleProductActive(${product.id})">${product.active ? "停用" : "启用"}</button></td>`;
        tbody.appendChild(tr);
    });
}

function formatDateTimeDisplay(value) {
    if (!value) return "-";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "-";
    return dt.toLocaleString();
}

function pickLaterTime(currentValue, candidateValue) {
    if (!candidateValue) return currentValue;
    const candidateTime = new Date(candidateValue).getTime();
    if (Number.isNaN(candidateTime)) return currentValue;
    const currentTime = currentValue ? new Date(currentValue).getTime() : 0;
    if (Number.isNaN(currentTime) || candidateTime > currentTime) return candidateValue;
    return currentValue;
}

function getProductLastStockUpdatedAt(productId) {
    const product = findProductById(productId);
    let latest = product && product.lastStockUpdatedAt ? product.lastStockUpdatedAt : "";

    DB.stockAdjustments.forEach((adjustment) => {
        if (adjustment.productId !== productId) return;
        latest = pickLaterTime(latest, getAdjustmentRecordedAt(adjustment));
    });

    DB.transactions.forEach((transaction) => {
        if (!hasStockImpact(transaction.type) || !Array.isArray(transaction.items)) return;
        const hit = transaction.items.some((item) => item.productId === productId);
        if (!hit) return;
        latest = pickLaterTime(latest, getTransactionRecordedAt(transaction));
    });

    return latest || null;
}

function getLatestStockAdjustment(productId) {
    const adjustments = DB.stockAdjustments.filter((item) => item.productId === productId);
    if (adjustments.length === 0) return null;
    return adjustments.sort((a, b) => {
        const aBizDate = getAdjustmentBizDate(a);
        const bBizDate = getAdjustmentBizDate(b);
        if (aBizDate !== bBizDate) return aBizDate < bBizDate ? 1 : -1;
        const aMs = getRecordTimeMs(getAdjustmentRecordedAt(a), aBizDate);
        const bMs = getRecordTimeMs(getAdjustmentRecordedAt(b), bBizDate);
        if (aMs !== bMs) return bMs - aMs;
        return toNumber(b.id, 0) - toNumber(a.id, 0);
    })[0];
}

function getAdjustmentSummary(adjustment) {
    if (!adjustment) return "-";
    const modeText = adjustment.mode === "set" ? "实盘覆写" : "增减调整";
    const changeText = adjustment.changeQty > 0 ? `+${adjustment.changeQty}` : `${adjustment.changeQty}`;
    const remarkText = adjustment.remark || "无备注";
    const bizDate = getAdjustmentBizDate(adjustment);
    const timeText = formatDateTimeDisplay(getAdjustmentRecordedAt(adjustment));
    return `${modeText} ${changeText} | 业务日:${bizDate} | 录入:${timeText} | ${remarkText}`;
}

function getStockEventTypeLabel(event) {
    if (!event) return "未知";
    if (event.eventType === "tx") {
        return getTypeLabel(event.transactionType);
    }
    if (event.eventType === "adjust-set") return "盘点覆写";
    if (event.eventType === "adjust-delta") return "增减调整";
    return "未知";
}

function getProductLatestBusinessDate(productId) {
    const events = buildProductStockEvents(productId);
    if (events.length === 0) return "-";
    const latest = events[events.length - 1];
    if (!latest || !latest.businessDate) return "-";
    const typeLabel = getStockEventTypeLabel(latest);
    return `${latest.businessDate}（${typeLabel}）`;
}

function getProductStockBasisSummary(productId) {
    const events = buildProductStockEvents(productId);
    if (events.length === 0) return "暂无库存事件";

    let anchorIndex = -1;
    for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i].eventType === "adjust-set") {
            anchorIndex = i;
            break;
        }
    }

    if (anchorIndex < 0) {
        return `无盘点基准，按全部业务累计（事件 ${events.length} 条）`;
    }

    const anchor = events[anchorIndex];
    const postEvents = events.length - anchorIndex - 1;
    return `盘点基准 ${anchor.businessDate} 设为 ${toSignedInteger(anchor.setQty, 0)}，其后事件 ${postEvents} 条`;
}

function renderInventoryList() {
    const tbody = document.querySelector("#inventory-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    DB.products.forEach((product) => {
        const stock = calculateProductStock(product.id);
        const stockClass = stock < 0 ? "negative-stock" : (stock > 0 ? "positive-stock" : "");
        const latestBusinessDate = getProductLatestBusinessDate(product.id);
        const lastUpdated = formatDateTimeDisplay(getProductLastStockUpdatedAt(product.id));
        const stockBasisSummary = getProductStockBasisSummary(product.id);

        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${product.name}</td><td>${product.sku || "-"}</td><td>${product.spec || "-"}</td><td>${product.unit || "-"}</td><td class="${stockClass}">${stock}</td><td>${latestBusinessDate}</td><td>${lastUpdated}</td><td>${stockBasisSummary}</td><td><button class="btn btn-small-outline" onclick="openStockAdjustModal(${product.id})">盘点/调整</button></td>`;
        tbody.appendChild(tr);
    });
}

function getStockAdjustModalElements() {
    return {
        modal: document.getElementById("stock-adjust-modal"),
        productInfo: document.getElementById("stock-adjust-product-info"),
        mode: document.getElementById("stock-adjust-mode"),
        quantity: document.getElementById("stock-adjust-quantity"),
        quantityLabel: document.getElementById("stock-adjust-quantity-label"),
        bizDate: document.getElementById("stock-adjust-biz-date"),
        remark: document.getElementById("stock-adjust-remark"),
        preview: document.getElementById("stock-adjust-preview")
    };
}

function openStockAdjustModal(productId) {
    const targetProduct = findProductById(productId);
    if (!targetProduct) {
        alert("产品不存在");
        return;
    }

    const els = getStockAdjustModalElements();
    if (!els.modal || !els.mode || !els.quantity || !els.bizDate || !els.remark || !els.preview || !els.quantityLabel || !els.productInfo) {
        alert("库存调整弹窗未初始化");
        return;
    }

    STOCK_ADJUST_STATE.productId = targetProduct.id;
    const currentStock = calculateProductStock(targetProduct.id);
    els.productInfo.innerText = `${targetProduct.name} (${targetProduct.sku || "无编码"}) 当前库存：${currentStock}`;
    els.mode.value = "set";
    els.quantity.value = String(currentStock);
    els.bizDate.value = getTodayISODate();
    els.remark.value = "";
    els.modal.classList.remove("hidden");
    updateStockAdjustPreview();
}

function closeStockAdjustModal() {
    const { modal } = getStockAdjustModalElements();
    if (modal) modal.classList.add("hidden");
    STOCK_ADJUST_STATE.productId = null;
}

function handleStockAdjustModalBackdrop(event) {
    if (!event || !event.target) return;
    if (event.target.id === "stock-adjust-modal") closeStockAdjustModal();
}

function updateStockAdjustPreview() {
    const els = getStockAdjustModalElements();
    if (!els.mode || !els.quantity || !els.bizDate || !els.preview || !els.quantityLabel) return;

    const mode = els.mode.value === "delta" ? "delta" : "set";
    els.quantityLabel.innerText = mode === "set" ? "实盘数量" : "增减数量 (+/-)";

    const productId = toNumber(STOCK_ADJUST_STATE.productId, 0);
    if (!productId) {
        els.preview.innerText = "";
        return;
    }
    const bizDate = String(els.bizDate.value || "").trim();
    if (!isValidISODate(bizDate)) {
        els.preview.innerText = "业务日期格式不正确。";
        return;
    }
    const currentStock = calculateProductStock(productId);
    const quantityRaw = String(els.quantity.value || "").trim();
    if (quantityRaw === "") {
        els.preview.innerText = `当前库存：${currentStock}，请填写${mode === "set" ? "实盘数量" : "增减数量"}。`;
        return;
    }

    if (!isIntegerText(quantityRaw)) {
        els.preview.innerText = "数量必须为整数。";
        return;
    }

    const quantity = toSignedInteger(quantityRaw, NaN);
    if (!Number.isFinite(quantity)) {
        els.preview.innerText = "数量必须为整数。";
        return;
    }
    if (mode === "set" && quantity < 0) {
        els.preview.innerText = "实盘数量不能为负数。";
        return;
    }
    if (mode === "delta" && quantity === 0) {
        els.preview.innerText = "增减数量不能为 0。";
        return;
    }

    const previewResult = previewStockWithPendingAdjustment(productId, {
        id: Date.now(),
        mode: mode,
        bizDate: bizDate,
        recordedAt: new Date().toISOString(),
        quantity: quantity
    });
    if (!previewResult) {
        els.preview.innerText = "库存预演失败，请检查输入。";
        return;
    }

    const changeText = previewResult.change > 0 ? `+${previewResult.change}` : `${previewResult.change}`;
    els.preview.innerText = `当前库存：${currentStock}；事件前库存：${previewResult.before}；事件后库存：${previewResult.after}；变化：${changeText}；应用后当前库存：${previewResult.current}`;
}

function updateProductStockTimestamp(productId, updatedAt) {
    const product = findProductById(productId);
    if (!product) return;
    product.lastStockUpdatedAt = updatedAt;
}

function touchProductsStockUpdatedAt(items, updatedAt) {
    if (!Array.isArray(items)) return;
    const touched = {};
    items.forEach((item) => {
        const productId = toNumber(item.productId, 0);
        if (!productId || touched[productId]) return;
        touched[productId] = true;
        updateProductStockTimestamp(productId, updatedAt);
    });
}

function saveStockAdjustment() {
    const productId = toNumber(STOCK_ADJUST_STATE.productId, 0);
    const product = findProductById(productId);
    if (!product) {
        alert("请选择要调整的产品");
        return;
    }

    const els = getStockAdjustModalElements();
    if (!els.mode || !els.quantity || !els.bizDate || !els.remark) return;
    const mode = els.mode.value === "delta" ? "delta" : "set";
    const bizDate = String(els.bizDate.value || "").trim();
    const rawQuantity = String(els.quantity.value || "").trim();
    if (!isValidISODate(bizDate)) {
        alert("请填写有效的业务日期");
        return;
    }
    if (!rawQuantity) {
        alert("请填写库存数量");
        return;
    }
    if (!isIntegerText(rawQuantity)) {
        alert("数量必须为整数");
        return;
    }

    const parsedQuantity = toSignedInteger(rawQuantity, NaN);
    if (!Number.isFinite(parsedQuantity)) {
        alert("数量必须为整数");
        return;
    }

    if (mode === "set" && parsedQuantity < 0) {
        alert("实盘数量不能为负数");
        return;
    }
    if (mode === "delta" && parsedQuantity === 0) {
        alert("增减调整不能为 0");
        return;
    }

    const nowIso = new Date().toISOString();
    const previewAdjustment = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        productId: product.id,
        mode: mode,
        bizDate: bizDate,
        recordedAt: nowIso,
        quantity: parsedQuantity
    };
    const previewResult = previewStockWithPendingAdjustment(product.id, previewAdjustment);
    if (!previewResult) {
        alert("库存预演失败，请重试");
        return;
    }

    const beforeQty = previewResult.before;
    const afterQty = previewResult.after;
    const changeQty = previewResult.change;

    if (changeQty === 0) {
        alert("库存无变化，无需保存");
        return;
    }

    DB.stockAdjustments.unshift({
        id: previewAdjustment.id,
        productId: product.id,
        mode: mode,
        changeQty: changeQty,
        beforeQty: beforeQty,
        afterQty: afterQty,
        bizDate: bizDate,
        remark: String(els.remark.value || "").trim(),
        recordedAt: nowIso,
        updatedAt: nowIso,
        operator: ""
    });
    updateProductStockTimestamp(product.id, nowIso);
    DB.save();
    closeStockAdjustModal();
    alert("库存调整已保存");
}

