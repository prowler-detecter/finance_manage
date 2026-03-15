function needsProductItems(type) {
    return type === "out" || type === "in" || type === "sale_return" || type === "purchase_return";
}

function needsWarehouseSlip(type) {
    return type === "out" || type === "in";
}

function getCurrentTransactionType() {
    const typeEl = document.getElementById("t-type");
    return typeEl ? typeEl.value : "out";
}

function normalizeSlipBook(book) {
    return String(book || "").trim();
}

function normalizeSlipBookKey(book) {
    return normalizeSlipBook(book).toLowerCase();
}

function getMaxUsedSlipNo(type, slipBook, excludeTransactionId = 0) {
    const targetBookKey = normalizeSlipBookKey(slipBook);
    let maxNo = 0;
    DB.transactions.forEach((transaction) => {
        if (transaction.type !== type) return;
        if (excludeTransactionId && transaction.id === excludeTransactionId) return;
        if (normalizeSlipBookKey(transaction.slipBook) !== targetBookKey) return;
        const slipNo = toIntegerNumber(transaction.slipNo, 0);
        if (slipNo > maxNo) maxNo = slipNo;
    });
    return maxNo;
}

function hasSameSlipNo(type, slipBook, slipNo, excludeTransactionId = 0) {
    const targetBookKey = normalizeSlipBookKey(slipBook);
    const targetSlipNo = toIntegerNumber(slipNo, 0);
    if (!targetBookKey || targetSlipNo <= 0) return false;

    return DB.transactions.some((transaction) => {
        if (transaction.type !== type) return false;
        if (excludeTransactionId && transaction.id === excludeTransactionId) return false;
        if (normalizeSlipBookKey(transaction.slipBook) !== targetBookKey) return false;
        return toIntegerNumber(transaction.slipNo, 0) === targetSlipNo;
    });
}

function getNextSlipNo(type, slipBook) {
    const maxNo = getMaxUsedSlipNo(type, slipBook);
    return maxNo > 0 ? maxNo + 1 : 1;
}

function getPreferredSlipBook(type, partnerId) {
    const targetPartnerId = toNumber(partnerId, 0);
    if (!targetPartnerId) return "";

    const candidate = DB.transactions
        .filter((transaction) => transaction.type === type && transaction.partnerId === targetPartnerId && normalizeSlipBook(transaction.slipBook))
        .sort(compareTransactionsByBusinessTimeDesc)[0];

    return candidate ? normalizeSlipBook(candidate.slipBook) : "";
}

function fillNextWarehouseSlipNo() {
    const type = getCurrentTransactionType();
    if (!needsWarehouseSlip(type)) return;
    const slipBookInput = document.getElementById("t-slip-book");
    const slipNoInput = document.getElementById("t-slip-no");
    if (!slipBookInput || !slipNoInput) return;

    const slipBook = normalizeSlipBook(slipBookInput.value);
    if (!slipBook) {
        alert("请先填写单据簿号");
        return;
    }
    slipNoInput.value = String(getNextSlipNo(type, slipBook));
    updateWarehouseSlipSection(false);
}

function updateWarehouseSlipSection(forceAutoFill = false) {
    const section = document.getElementById("warehouse-slip-section");
    const partnerSelect = document.getElementById("t-partner");
    const slipBookInput = document.getElementById("t-slip-book");
    const slipNoInput = document.getElementById("t-slip-no");
    const hint = document.getElementById("t-slip-hint");
    if (!section || !partnerSelect || !slipBookInput || !slipNoInput || !hint) return;

    const type = getCurrentTransactionType();
    if (!needsWarehouseSlip(type)) {
        section.classList.add("hidden");
        slipBookInput.value = "";
        slipNoInput.value = "";
        hint.innerText = "";
        SLIP_STATE.lastAutoContext = "";
        return;
    }

    section.classList.remove("hidden");
    const partnerId = toNumber(partnerSelect.value, 0);
    const slipNoTextBeforeAuto = String(slipNoInput.value || "").trim();
    if (forceAutoFill && partnerId > 0 && !normalizeSlipBook(slipBookInput.value)) {
        const preferredBook = getPreferredSlipBook(type, partnerId);
        if (preferredBook) {
            slipBookInput.value = preferredBook;
            if (!slipNoTextBeforeAuto) {
                slipNoInput.value = String(getNextSlipNo(type, preferredBook));
            }
            const contextKey = `${type}|${partnerId}|${preferredBook}`;
            if (SLIP_STATE.lastAutoContext !== contextKey) {
                alert(`已自动带入该客户常用单据簿号：${preferredBook}`);
            }
            SLIP_STATE.lastAutoContext = contextKey;
        }
    }

    const slipBook = normalizeSlipBook(slipBookInput.value);
    const slipNoText = String(slipNoInput.value || "").trim();
    if (!slipBook && !slipNoText) {
        hint.innerText = "出库/入库单号可选填；填写后系统可提示顺号。";
        return;
    }

    if (!slipBook && slipNoText) {
        hint.innerText = "如填写单据号，请同时填写单据簿号。";
        return;
    }

    const nextNo = getNextSlipNo(type, slipBook);
    if (!slipNoText) {
        hint.innerText = `当前簿号 [${slipBook}] 建议下一号：${nextNo}。`;
        return;
    }

    if (!isIntegerText(slipNoText) || Number(slipNoText) <= 0) {
        hint.innerText = "单据号需为正整数。";
        return;
    }

    const slipNo = Number(slipNoText);
    if (slipNo === nextNo) {
        hint.innerText = `单据号顺序正常，当前为建议下一号 ${nextNo}。`;
        return;
    }

    if (slipNo > nextNo) {
        hint.innerText = `当前输入 ${slipNo}，跳过了建议下一号 ${nextNo}（允许，但请确认）。`;
        return;
    }

    hint.innerText = `当前输入 ${slipNo} 小于已使用最大号，若继续使用可能重复。`;
}

function buildSourceTransactionLabel(transaction) {
    const itemText = formatItemSummary(transaction.items) || "无产品明细";
    const slipText = getTransactionSlipText(transaction);
    const prefix = slipText ? `${slipText} | ` : "";
    return `${prefix}${getTransactionDate(transaction)} | ${itemText} | ¥${toMoneyNumber(transaction.amount).toFixed(2)} | ID:${transaction.id}`;
}

function updateReturnSourceSection() {
    const section = document.getElementById("return-source-section");
    const select = document.getElementById("t-source-transaction");
    const hint = document.getElementById("t-source-hint");
    const sourceRefInput = document.getElementById("t-source-ref");
    if (!section || !select || !hint) return;

    const type = getCurrentTransactionType();
    if (!isReturnType(type)) {
        section.classList.add("hidden");
        select.innerHTML = '<option value="">-- 无需关联 --</option>';
        if (sourceRefInput) sourceRefInput.value = "";
        hint.innerText = "";
        return;
    }

    section.classList.remove("hidden");
    const sourceType = type === "sale_return" ? "out" : "in";
    const partnerId = toNumber(document.getElementById("t-partner").value, 0);
    const previousValue = toNumber(select.value, 0);

    select.innerHTML = '<option value="">-- 不关联原交易 --</option>';
    if (!partnerId) {
        hint.innerText = "请先选择客户/供应商，再选择可关联的历史交易。";
        return;
    }

    const sourceTransactions = DB.transactions
        .filter((t) => t.partnerId === partnerId && t.type === sourceType)
        .sort(compareTransactionsByBusinessTimeDesc);
    sourceTransactions.forEach((transaction) => {
        const option = document.createElement("option");
        option.value = transaction.id;
        option.innerText = buildSourceTransactionLabel(transaction);
        select.appendChild(option);
    });

    if (previousValue && sourceTransactions.some((t) => t.id === previousValue)) {
        select.value = String(previousValue);
    }

    hint.innerText = sourceTransactions.length > 0
        ? `可选 ${sourceTransactions.length} 条历史${sourceType === "out" ? "出库" : "入库"}记录作为退货来源。`
        : "当前对象暂无可关联的历史交易，可直接填写原单号。";
}

function updateFormHints() {
    const type = getCurrentTransactionType();
    const amountHintEl = document.getElementById("amount-mode-hint");
    if (amountHintEl) {
        if (needsWarehouseSlip(type)) {
            amountHintEl.innerText = "出库/入库可选登记单据簿号与单据号，金额默认由产品明细汇总。";
        } else if (isReturnType(type)) {
            amountHintEl.innerText = "退货金额默认由产品明细汇总，可选关联原交易并填写原单号。";
        } else if (needsProductItems(type)) {
            amountHintEl.innerText = "金额默认由产品明细自动汇总，可手工修改覆盖。";
        } else {
            amountHintEl.innerText = "收款/付款无需录入产品明细。";
        }
    }

    if (lastTransactionType !== type) {
        TX_STATE.amountManualOverride = false;
    }
    lastTransactionType = type;

    renderPartnerSelect();
    updateReturnSourceSection();
    updateWarehouseSlipSection(true);
    renderProductItemsSection();
}

function renderProductItemsSection() {
    const section = document.getElementById("product-items-section");
    if (!section) return;

    const type = getCurrentTransactionType();
    if (!needsProductItems(type)) {
        section.classList.add("hidden");
        hideInventoryWarning();
        updateAmountOverrideHint();
        return;
    }

    section.classList.remove("hidden");
    if (TX_STATE.items.length === 0) {
        TX_STATE.items.push(createTransactionItemRow());
    }
    renderItemRows();
    recalculateTransactionAmountFromItems();
}

function createTransactionItemRow(productId = "") {
    const row = {
        rowId: Date.now() + Math.floor(Math.random() * 10000),
        productId: productId || "",
        quantity: "",
        unitPrice: ""
    };
    const product = findProductById(productId);
    if (product) {
        row.unitPrice = toMoneyNumber(product.defaultUnitPrice).toFixed(2);
        row.quantity = "1";
    }
    return row;
}

function renderProductOptions(selectedProductId) {
    const selectedIdNum = toNumber(selectedProductId, 0);
    let options = '<option value="">-- 选择产品 --</option>';
    const activeProducts = DB.products.filter((p) => p.active);
    activeProducts.forEach((product) => {
        const isSelected = selectedIdNum === product.id ? "selected" : "";
        options += `<option value="${product.id}" ${isSelected}>${product.name} (${product.sku || "无编码"})</option>`;
    });

    if (selectedIdNum) {
        const selectedProduct = findProductById(selectedIdNum);
        if (selectedProduct && !selectedProduct.active) {
            options += `<option value="${selectedProduct.id}" selected>${selectedProduct.name} (${selectedProduct.sku || "无编码"}, 已停用)</option>`;
        }
    }
    return options;
}

function renderItemRows() {
    const tbody = document.querySelector("#item-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    TX_STATE.items.forEach((row) => {
        const tr = document.createElement("tr");
        tr.setAttribute("data-row-id", String(row.rowId));
        const product = findProductById(row.productId);
        const quantity = toIntegerNumber(row.quantity);
        const unitPrice = toMoneyNumber(row.unitPrice);
        const lineAmount = quantity * unitPrice;
        const optionsHtml = renderProductOptions(row.productId);

        tr.innerHTML = `
            <td><select onchange="setItemProduct(${row.rowId}, this.value)">${optionsHtml}</select></td>
            <td>${product ? product.sku || "-" : '<span class="cell-muted">-</span>'}</td>
            <td>${product ? product.spec || "-" : '<span class="cell-muted">-</span>'}</td>
            <td>${product ? product.unit || "-" : '<span class="cell-muted">-</span>'}</td>
            <td><input type="number" min="1" step="1" value="${row.quantity}" oninput="setItemQuantity(${row.rowId}, this.value)"></td>
            <td><input type="number" min="0" step="0.01" value="${row.unitPrice}" oninput="setItemUnitPrice(${row.rowId}, this.value)"></td>
            <td class="line-amount-cell">¥${lineAmount.toFixed(2)}</td>
            <td><button type="button" class="btn btn-small-outline" onclick="removeItemRow(${row.rowId})">删除</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function addItemRow() {
    TX_STATE.items.push(createTransactionItemRow());
    renderProductItemsSection();
}

function removeItemRow(rowId) {
    TX_STATE.items = TX_STATE.items.filter((row) => row.rowId !== rowId);
    renderProductItemsSection();
}

function setItemProduct(rowId, productId) {
    const row = TX_STATE.items.find((item) => item.rowId === rowId);
    if (!row) return;
    row.productId = productId ? toNumber(productId) : "";

    const product = findProductById(row.productId);
    if (product && (!row.unitPrice || toMoneyNumber(row.unitPrice) === 0)) {
        row.unitPrice = toMoneyNumber(product.defaultUnitPrice).toFixed(2);
    }
    if (product && !row.quantity) {
        row.quantity = "1";
    }
    renderProductItemsSection();
}

function setItemQuantity(rowId, quantity) {
    const row = TX_STATE.items.find((item) => item.rowId === rowId);
    if (!row) return;
    row.quantity = quantity;
    updateItemRowAmountDisplay(rowId);
    recalculateTransactionAmountFromItems();
}

function setItemUnitPrice(rowId, unitPrice) {
    const row = TX_STATE.items.find((item) => item.rowId === rowId);
    if (!row) return;
    row.unitPrice = unitPrice;
    updateItemRowAmountDisplay(rowId);
    recalculateTransactionAmountFromItems();
}

function updateItemRowAmountDisplay(rowId) {
    const row = TX_STATE.items.find((item) => item.rowId === rowId);
    if (!row) return;
    const rowEl = document.querySelector(`#item-table tbody tr[data-row-id="${rowId}"]`);
    if (!rowEl) return;
    const lineAmountCell = rowEl.querySelector(".line-amount-cell");
    if (!lineAmountCell) return;
    const quantity = toIntegerNumber(row.quantity);
    const unitPrice = toMoneyNumber(row.unitPrice);
    const lineAmount = quantity * unitPrice;
    lineAmountCell.innerText = `¥${lineAmount.toFixed(2)}`;
}

function recalculateTransactionAmountFromItems() {
    const type = getCurrentTransactionType();
    if (!needsProductItems(type)) return 0;

    let computedAmount = 0;
    TX_STATE.items.forEach((row) => {
        const quantity = toIntegerNumber(row.quantity);
        const unitPrice = toMoneyNumber(row.unitPrice);
        if (quantity > 0 && unitPrice >= 0 && row.productId) {
            computedAmount += quantity * unitPrice;
        }
    });

    const computedEl = document.getElementById("item-computed-amount");
    if (computedEl) computedEl.innerText = `¥${computedAmount.toFixed(2)}`;

    const amountInput = document.getElementById("t-amount");
    if (amountInput && !TX_STATE.amountManualOverride) {
        amountInput.value = computedAmount.toFixed(2);
    }

    updateAmountOverrideHint();
    updateInventoryWarning();
    return computedAmount;
}

function markAmountManualOverride() {
    if (!needsProductItems(getCurrentTransactionType())) return;
    TX_STATE.amountManualOverride = true;
    updateAmountOverrideHint();
}

function updateAmountOverrideHint() {
    const hintEl = document.getElementById("amount-override-hint");
    if (!hintEl) return;
    if (needsProductItems(getCurrentTransactionType()) && TX_STATE.amountManualOverride) {
        hintEl.classList.remove("hidden");
    } else {
        hintEl.classList.add("hidden");
    }
}

function hasStockImpact(type) {
    return type === "out" || type === "in" || type === "sale_return" || type === "purchase_return";
}

function isStockDecreaseType(type) {
    return type === "out" || type === "purchase_return";
}

function updateInventoryWarning() {
    const warningEl = document.getElementById("item-stock-warning");
    if (!warningEl) return;

    const type = getCurrentTransactionType();
    if (!isStockDecreaseType(type)) {
        hideInventoryWarning();
        return;
    }

    const outMap = {};
    TX_STATE.items.forEach((row) => {
        const productId = toNumber(row.productId, 0);
        const quantity = toIntegerNumber(row.quantity);
        if (!productId || quantity <= 0) return;
        outMap[productId] = (outMap[productId] || 0) + quantity;
    });

    const warnings = [];
    Object.keys(outMap).forEach((idKey) => {
        const productId = toNumber(idKey, 0);
        const product = findProductById(productId);
        if (!product) return;
        const currentStock = calculateProductStock(productId);
        const projectedStock = currentStock - outMap[productId];
        if (projectedStock < 0) {
            warnings.push(`${product.name} 预计库存 ${projectedStock}`);
        }
    });

    if (warnings.length === 0) {
        hideInventoryWarning();
        return;
    }

    warningEl.innerText = `库存预警（不拦截提交）：${warnings.join("；")}`;
    warningEl.classList.remove("hidden");
}

function hideInventoryWarning() {
    const warningEl = document.getElementById("item-stock-warning");
    if (!warningEl) return;
    warningEl.classList.add("hidden");
    warningEl.innerText = "";
}

function addTransaction() {
    const type = getCurrentTransactionType();
    const partnerId = toNumber(document.getElementById("t-partner").value, 0);
    const transactionDate = String(document.getElementById("t-transaction-date").value || "").trim();
    const bookkeepingDate = String(document.getElementById("t-bookkeeping-date").value || "").trim();
    const remark = document.getElementById("t-remark").value.trim();
    const amountInput = document.getElementById("t-amount");
    const sourceTransactionSelect = document.getElementById("t-source-transaction");
    const sourceRefInput = document.getElementById("t-source-ref");
    const slipBookInput = document.getElementById("t-slip-book");
    const slipNoInput = document.getElementById("t-slip-no");
    let amount = toMoneyNumber(amountInput ? amountInput.value : 0);

    if (!partnerId || !transactionDate || !bookkeepingDate) return alert("请填写完整信息");
    if (!isValidISODate(transactionDate)) return alert("交易日期格式不正确，请使用 YYYY-MM-DD");
    if (!isValidISODate(bookkeepingDate)) return alert("记账日期格式不正确，请使用 YYYY-MM-DD");

    const partner = DB.partners.find((p) => p.id === partnerId);
    if (!partner) return alert("未找到客户/供应商");
    const expectedType = getExpectedPartnerType(type);
    if (expectedType && partner.type !== expectedType) {
        return alert(`当前交易类型仅支持${expectedType === "customer" ? "客户" : "供应商"}对象`);
    }

    let slipBook = "";
    let slipNo = 0;
    if (needsWarehouseSlip(type)) {
        slipBook = normalizeSlipBook(slipBookInput ? slipBookInput.value : "");
        const slipNoText = String(slipNoInput ? slipNoInput.value : "").trim();
        if (slipBook || slipNoText) {
            if (!slipBook || !slipNoText) {
                return alert("如需填写单号，请同时填写单据簿号和单据号");
            }
            if (!isIntegerText(slipNoText) || Number(slipNoText) <= 0) return alert("单据号必须为正整数");

            slipNo = Number(slipNoText);
            const maxUsedNo = getMaxUsedSlipNo(type, slipBook);
            const suggestedNo = maxUsedNo > 0 ? maxUsedNo + 1 : 1;
            if (slipNo !== suggestedNo) {
                const typeLabel = type === "out" ? "出库" : "入库";
                const confirmSkip = window.confirm(`${typeLabel}簿号 [${slipBook}] 建议下一号是 ${suggestedNo}，当前输入 ${slipNo}。\n确定继续保存吗？`);
                if (!confirmSkip) return;
            }
            if (hasSameSlipNo(type, slipBook, slipNo)) {
                const typeLabel = type === "out" ? "出库" : "入库";
                const confirmDuplicate = window.confirm(`${typeLabel}簿号 [${slipBook}] 的单据号 ${slipNo} 已存在。\n继续保存会产生重复单号，确定继续吗？`);
                if (!confirmDuplicate) return;
            }
        }
    }

    let items = [];
    let computedAmount = 0;

    if (needsProductItems(type)) {
        const validateResult = buildValidatedTransactionItems();
        if (!validateResult.ok) return alert(validateResult.message);
        items = validateResult.items;
        computedAmount = validateResult.computedAmount;
        if (amount <= 0 && computedAmount > 0) {
            amount = computedAmount;
            if (amountInput) amountInput.value = computedAmount.toFixed(2);
        }
    }

    if (amount <= 0) return alert("金额必须大于 0");

    const nowIso = new Date().toISOString();
    const transaction = {
        id: Date.now(),
        transactionDate: transactionDate,
        bookkeepingDate: bookkeepingDate,
        recordedAt: nowIso,
        type: type,
        partnerId: partnerId,
        amount: amount,
        remark: remark
    };

    if (needsProductItems(type)) {
        transaction.items = items;
        transaction.computedAmount = toMoneyNumber(computedAmount);
    }
    if (needsWarehouseSlip(type) && slipBook && slipNo > 0) {
        transaction.slipBook = slipBook;
        transaction.slipNo = slipNo;
    }

    if (isReturnType(type)) {
        const sourceTransactionId = toNumber(sourceTransactionSelect ? sourceTransactionSelect.value : 0, 0);
        const sourceRef = String(sourceRefInput ? sourceRefInput.value : "").trim();
        if (sourceTransactionId > 0) {
            const sourceType = type === "sale_return" ? "out" : "in";
            const sourceTransaction = DB.transactions.find((t) => t.id === sourceTransactionId);
            if (!sourceTransaction || sourceTransaction.partnerId !== partnerId || sourceTransaction.type !== sourceType) {
                return alert("所选原交易与当前退货对象/类型不匹配，请重新选择");
            }
            transaction.sourceTransactionId = sourceTransactionId;
        }
        if (sourceRef) transaction.sourceRef = sourceRef;
    }

    DB.transactions.unshift(transaction);
    if (hasStockImpact(type)) {
        touchProductsStockUpdatedAt(items, nowIso);
    }
    DB.save();
    resetTransactionFormAfterSubmit();
    alert("登记成功！");
}

function buildValidatedTransactionItems() {
    const type = getCurrentTransactionType();
    if (!needsProductItems(type)) {
        return { ok: true, items: [], computedAmount: 0 };
    }

    const validItems = [];
    for (let i = 0; i < TX_STATE.items.length; i += 1) {
        const row = TX_STATE.items[i];
        const productId = toNumber(row.productId, 0);
        const quantity = toIntegerNumber(row.quantity);
        const unitPrice = toMoneyNumber(row.unitPrice);

        const isEmptyRow = !productId && !row.quantity && !row.unitPrice;
        if (isEmptyRow) continue;

        if (!productId) return { ok: false, message: `第 ${i + 1} 行请选择产品` };
        if (quantity <= 0) return { ok: false, message: `第 ${i + 1} 行数量必须为正整数` };
        if (unitPrice < 0) return { ok: false, message: `第 ${i + 1} 行单价不能为负数` };

        const product = findProductById(productId);
        if (!product) return { ok: false, message: `第 ${i + 1} 行产品不存在` };
        if (!product.active) return { ok: false, message: `第 ${i + 1} 行产品已停用，不能用于新单` };

        const lineAmount = toMoneyNumber(quantity * unitPrice);
        validItems.push({
            productId: product.id,
            productSnapshot: {
                name: product.name,
                sku: product.sku,
                spec: product.spec,
                unit: product.unit
            },
            quantity: quantity,
            unitPrice: unitPrice,
            lineAmount: lineAmount
        });
    }

    if (validItems.length === 0) {
        return { ok: false, message: "涉及库存的交易至少需要填写 1 行有效产品明细" };
    }

    const computedAmount = validItems.reduce((sum, item) => sum + item.lineAmount, 0);
    return { ok: true, items: validItems, computedAmount: computedAmount };
}

function resetTransactionFormAfterSubmit() {
    TX_STATE.items = [];
    TX_STATE.amountManualOverride = false;
    const amountInput = document.getElementById("t-amount");
    const remarkInput = document.getElementById("t-remark");
    const sourceSelect = document.getElementById("t-source-transaction");
    const sourceRefInput = document.getElementById("t-source-ref");
    const slipBookInput = document.getElementById("t-slip-book");
    const slipNoInput = document.getElementById("t-slip-no");
    if (amountInput) amountInput.value = "";
    if (remarkInput) remarkInput.value = "";
    if (sourceSelect) sourceSelect.value = "";
    if (sourceRefInput) sourceRefInput.value = "";
    if (slipBookInput) slipBookInput.value = "";
    if (slipNoInput) slipNoInput.value = "";
    updateFormHints();
}

function addClient() {
    const nameInput = document.getElementById("new-client-name");
    const typeInput = document.getElementById("new-client-type");
    const name = nameInput.value.trim();
    const type = typeInput.value;
    if (!name) return alert("请输入名称");
    DB.partners.push({ id: Date.now(), name: name, type: type });
    DB.save();
    toggleAddClientForm();
    nameInput.value = "";
}

function toggleAddClientForm() {
    const form = document.getElementById("add-client-form");
    if (form) form.classList.toggle("hidden");
}

function addProduct() {
    const created = readProductFromInputs(
        "new-product-name",
        "new-product-sku",
        "new-product-spec",
        "new-product-unit",
        "new-product-price"
    );
    if (!created) return;
    DB.products.push(created);
    DB.save();
    clearProductInputs("new-product-name", "new-product-sku", "new-product-spec", "new-product-unit", "new-product-price");
}

function toggleProductActive(productId) {
    const product = findProductById(productId);
    if (!product) return;
    product.active = !product.active;
    DB.save();
}

function toggleQuickAddProductForm() {
    const form = document.getElementById("quick-add-product-form");
    if (form) form.classList.toggle("hidden");
}

function addProductFromQuickForm() {
    const created = readProductFromInputs(
        "quick-product-name",
        "quick-product-sku",
        "quick-product-spec",
        "quick-product-unit",
        "quick-product-price"
    );
    if (!created) return;

    DB.products.push(created);
    const emptyRow = TX_STATE.items.find((row) => !row.productId);
    if (emptyRow) {
        emptyRow.productId = created.id;
        emptyRow.quantity = emptyRow.quantity || "1";
        emptyRow.unitPrice = toMoneyNumber(created.defaultUnitPrice).toFixed(2);
    } else {
        TX_STATE.items.push(createTransactionItemRow(created.id));
    }

    DB.save();
    clearProductInputs("quick-product-name", "quick-product-sku", "quick-product-spec", "quick-product-unit", "quick-product-price");
    const form = document.getElementById("quick-add-product-form");
    if (form) form.classList.add("hidden");
}

function readProductFromInputs(nameId, skuId, specId, unitId, priceId) {
    const name = document.getElementById(nameId).value.trim();
    const sku = document.getElementById(skuId).value.trim();
    const spec = document.getElementById(specId).value.trim();
    const unit = document.getElementById(unitId).value.trim();
    const defaultUnitPrice = toMoneyNumber(document.getElementById(priceId).value);

    if (!name || !unit) {
        alert("请完整填写产品名称和单位");
        return null;
    }

    const skuExists = sku && DB.products.some((p) => p.sku && p.sku.toLowerCase() === sku.toLowerCase());
    if (skuExists) {
        alert("产品编码已存在，请使用唯一编码");
        return null;
    }

    return {
        id: Date.now() + Math.floor(Math.random() * 1000),
        name: name,
        sku: sku,
        spec: spec,
        unit: unit,
        defaultUnitPrice: defaultUnitPrice,
        active: true,
        lastStockUpdatedAt: null
    };
}

function clearProductInputs(nameId, skuId, specId, unitId, priceId) {
    document.getElementById(nameId).value = "";
    document.getElementById(skuId).value = "";
    document.getElementById(specId).value = "";
    document.getElementById(unitId).value = "";
    document.getElementById(priceId).value = "";
}

function calculateBalance(partnerId) {
    let balance = 0;
    DB.transactions.forEach((t) => {
        if (t.partnerId !== partnerId) return;
        if (t.type === "out") balance += toMoneyNumber(t.amount);
        else if (t.type === "in") balance -= toMoneyNumber(t.amount);
        else if (t.type === "sale_return") balance -= toMoneyNumber(t.amount);
        else if (t.type === "purchase_return") balance += toMoneyNumber(t.amount);
        else if (t.type === "receive") balance -= toMoneyNumber(t.amount);
        else if (t.type === "pay") balance += toMoneyNumber(t.amount);
    });
    return balance;
}

