function renderDashboard() {
    let totalReceivable = 0;
    let totalPayable = 0;
    DB.partners.forEach((p) => {
        const bal = calculateBalance(p.id);
        if (bal > 0) totalReceivable += bal;
        if (bal < 0) totalPayable += Math.abs(bal);
    });

    const receivableEl = document.getElementById("total-receivable");
    const payableEl = document.getElementById("total-payable");
    if (receivableEl) receivableEl.innerText = `¥${totalReceivable.toFixed(2)}`;
    if (payableEl) payableEl.innerText = `¥${totalPayable.toFixed(2)}`;

    const todayStr = getTodayISODate();
    const todayCount = DB.transactions.filter((t) => getTransactionDate(t) === todayStr).length;
    const todayEl = document.getElementById("today-count");
    if (todayEl) todayEl.innerText = todayCount;

    const tbody = document.querySelector("#recent-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    DB.transactions
        .slice()
        .sort(compareTransactionsByBusinessTimeDesc)
        .slice(0, 5)
        .forEach((t) => {
        const partner = DB.partners.find((p) => p.id === t.partnerId);
        const tr = document.createElement("tr");
        const badgeClass = getTypeBadgeClass(t.type);
        const typeLabel = getTypeLabel(t.type);
        const remark = getTransactionPreviewRemark(t);

        tr.innerHTML = `<td>${getTransactionDate(t)}</td><td>${partner ? partner.name : "未知"}</td><td><span class="badge ${badgeClass}">${typeLabel}</span></td><td>¥${toMoneyNumber(t.amount).toFixed(2)}</td><td>${remark}</td>`;
        tbody.appendChild(tr);
    });
}

function renderClientList() {
    const tbody = document.querySelector("#client-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    DB.partners.forEach((p) => {
        const bal = calculateBalance(p.id);
        const tr = document.createElement("tr");
        let statusText = "";
        let statusClass = "";
        if (bal > 0) {
            statusText = `对方欠我们 ¥${bal.toFixed(2)}`;
            statusClass = "status-receivable";
        } else if (bal < 0) {
            statusText = `我们欠对方 ¥${Math.abs(bal).toFixed(2)}`;
            statusClass = "status-payable";
        } else {
            statusText = "两清";
            statusClass = "status-clear";
        }
        tr.innerHTML = `<td><strong>${p.name}</strong></td><td>${p.type === "customer" ? "客户" : "供应商"}</td><td class="status-cell ${statusClass}">${statusText}</td><td><div class="client-actions"><button class="btn btn-small-outline" onclick="filterTransactions(${p.id})">查看流水</button><button class="btn btn-small-outline" onclick="exportPartnerTransactions(${p.id})">导出流水</button></div></td>`;
        tbody.appendChild(tr);
    });
}

function compareTransactionsByBusinessTimeDesc(a, b) {
    const aDate = getTransactionDate(a);
    const bDate = getTransactionDate(b);
    if (aDate !== bDate) return aDate < bDate ? 1 : -1;

    const aMs = getRecordTimeMs(a && a.recordedAt, getTransactionBookkeepingDate(a));
    const bMs = getRecordTimeMs(b && b.recordedAt, getTransactionBookkeepingDate(b));
    if (aMs !== bMs) return bMs - aMs;
    return toNumber(b && b.id, 0) - toNumber(a && a.id, 0);
}

function getPartnerTransactions(partnerId) {
    const targetPartnerId = toNumber(partnerId, 0);
    return DB.transactions
        .filter((t) => t.partnerId === targetPartnerId)
        .sort(compareTransactionsByBusinessTimeDesc);
}

function getCurrentLedgerPartner() {
    const partnerId = toNumber(VIEW_STATE.currentLedgerPartnerId, 0);
    if (!partnerId) return null;
    return DB.partners.find((partner) => partner.id === partnerId) || null;
}

function buildPartnerProfileDraft(partner) {
    if (!partner) {
        return {
            contactName: "",
            phone: "",
            address: "",
            profileRemark: ""
        };
    }
    return {
        contactName: String(partner.contactName || "").trim(),
        phone: String(partner.phone || "").trim(),
        address: String(partner.address || "").trim(),
        profileRemark: String(partner.profileRemark || "").trim()
    };
}

function isValidPhoneText(phone) {
    return /^[0-9+\-()\s]*$/.test(String(phone || ""));
}

function renderPartnerProfileCard(partner) {
    const contactView = document.getElementById("profile-contact-view");
    const phoneView = document.getElementById("profile-phone-view");
    const addressView = document.getElementById("profile-address-view");
    const remarkView = document.getElementById("profile-remark-view");
    const viewBlock = document.getElementById("partner-profile-view");
    const editBlock = document.getElementById("partner-profile-edit");
    const actionView = document.getElementById("partner-profile-actions-view");
    const actionEdit = document.getElementById("partner-profile-actions-edit");
    const contactInput = document.getElementById("profile-contact-input");
    const phoneInput = document.getElementById("profile-phone-input");
    const addressInput = document.getElementById("profile-address-input");
    const remarkInput = document.getElementById("profile-remark-input");

    if (!contactView || !phoneView || !addressView || !remarkView || !viewBlock || !editBlock || !actionView || !actionEdit || !contactInput || !phoneInput || !addressInput || !remarkInput) {
        return;
    }

    const safeText = (value) => {
        const txt = String(value || "").trim();
        return txt || "-";
    };

    if (!partner) {
        VIEW_STATE.profileEditMode = false;
        VIEW_STATE.profileDraft = null;
        contactView.innerText = "-";
        phoneView.innerText = "-";
        addressView.innerText = "-";
        remarkView.innerText = "-";
        viewBlock.classList.remove("hidden");
        editBlock.classList.add("hidden");
        actionView.classList.add("hidden");
        actionEdit.classList.add("hidden");
        return;
    }

    contactView.innerText = safeText(partner.contactName);
    phoneView.innerText = safeText(partner.phone);
    addressView.innerText = safeText(partner.address);
    remarkView.innerText = safeText(partner.profileRemark);

    if (!VIEW_STATE.profileEditMode) {
        viewBlock.classList.remove("hidden");
        editBlock.classList.add("hidden");
        actionView.classList.remove("hidden");
        actionEdit.classList.add("hidden");
        return;
    }

    if (!VIEW_STATE.profileDraft) {
        VIEW_STATE.profileDraft = buildPartnerProfileDraft(partner);
    }

    contactInput.value = VIEW_STATE.profileDraft.contactName;
    phoneInput.value = VIEW_STATE.profileDraft.phone;
    addressInput.value = VIEW_STATE.profileDraft.address;
    remarkInput.value = VIEW_STATE.profileDraft.profileRemark;
    viewBlock.classList.add("hidden");
    editBlock.classList.remove("hidden");
    actionView.classList.add("hidden");
    actionEdit.classList.remove("hidden");
}

function enterPartnerProfileEditMode() {
    const partner = getCurrentLedgerPartner();
    if (!partner) {
        alert("请先选择客户/供应商");
        return;
    }
    VIEW_STATE.profileEditMode = true;
    VIEW_STATE.profileDraft = buildPartnerProfileDraft(partner);
    renderPartnerLedgerPage();
}

function cancelPartnerProfileEditMode() {
    VIEW_STATE.profileEditMode = false;
    VIEW_STATE.profileDraft = null;
    renderPartnerLedgerPage();
}

function savePartnerProfile() {
    const partner = getCurrentLedgerPartner();
    if (!partner) {
        alert("请先选择客户/供应商");
        return;
    }

    const contactInput = document.getElementById("profile-contact-input");
    const phoneInput = document.getElementById("profile-phone-input");
    const addressInput = document.getElementById("profile-address-input");
    const remarkInput = document.getElementById("profile-remark-input");
    if (!contactInput || !phoneInput || !addressInput || !remarkInput) return;

    const contactName = String(contactInput.value || "").trim();
    const phone = String(phoneInput.value || "").trim();
    const address = String(addressInput.value || "").trim();
    const profileRemark = String(remarkInput.value || "").trim();

    if (!isValidPhoneText(phone)) {
        alert("联系电话格式不正确，仅允许数字、空格、+、-、括号");
        return;
    }

    partner.contactName = contactName;
    partner.phone = phone;
    partner.address = address;
    partner.profileRemark = profileRemark;

    VIEW_STATE.profileEditMode = false;
    VIEW_STATE.profileDraft = null;
    DB.save();
    alert("资料已保存");
}

function renderPartnerLedgerPage() {
    const titleEl = document.getElementById("partner-ledger-title");
    const subtitleEl = document.getElementById("partner-ledger-subtitle");
    const countEl = document.getElementById("ledger-count");
    const totalEl = document.getElementById("ledger-total");
    const balanceEl = document.getElementById("ledger-balance");
    const emptyEl = document.getElementById("partner-ledger-empty");
    const tbody = document.querySelector("#partner-ledger-table tbody");

    if (!titleEl || !subtitleEl || !countEl || !totalEl || !balanceEl || !emptyEl || !tbody) return;

    const partnerId = toNumber(VIEW_STATE.currentLedgerPartnerId, 0);
    const partner = DB.partners.find((p) => p.id === partnerId);
    if (!partner) {
        titleEl.innerText = "客户流水详情";
        subtitleEl.innerText = "请选择客户或供应商查看详细流水。";
        countEl.innerText = "0";
        totalEl.innerText = "¥0.00";
        balanceEl.innerText = "¥0.00";
        tbody.innerHTML = "";
        emptyEl.classList.remove("hidden");
        renderPartnerProfileCard(null);
        return;
    }

    const transactions = getPartnerTransactions(partner.id);
    const totalAmount = transactions.reduce((sum, t) => sum + toMoneyNumber(t.amount), 0);
    const balance = calculateBalance(partner.id);
    const roleLabel = partner.type === "customer" ? "客户" : "供应商";

    titleEl.innerText = `${partner.name} - 流水详情`;
    subtitleEl.innerText = `对象类型：${roleLabel}`;
    countEl.innerText = String(transactions.length);
    totalEl.innerText = `¥${totalAmount.toFixed(2)}`;
    balanceEl.innerText = `¥${balance.toFixed(2)}`;
    renderPartnerProfileCard(partner);
    tbody.innerHTML = "";

    if (transactions.length === 0) {
        emptyEl.classList.remove("hidden");
        return;
    }
    emptyEl.classList.add("hidden");

    transactions.forEach((transaction) => {
        const tr = document.createElement("tr");
        const typeLabel = getTypeLabel(transaction.type);
        const badgeClass = getTypeBadgeClass(transaction.type);
        const itemSummary = formatItemSummary(transaction.items) || "-";
        const remark = getTransactionDisplayRemark(transaction);
        const canEditSlip = needsWarehouseSlip(transaction.type);
        const actionText = canEditSlip ? "补填/修改单号" : "-";
        const actionButton = canEditSlip ? `<button class="btn btn-small-outline" onclick="editTransactionSlipInfo(${transaction.id})">${actionText}</button>` : "-";

        tr.innerHTML = `<td>${getTransactionSlipNoDisplay(transaction)}</td><td>${getTransactionDate(transaction)}</td><td><span class="badge ${badgeClass}">${typeLabel}</span></td><td>¥${toMoneyNumber(transaction.amount).toFixed(2)}</td><td>${itemSummary}</td><td>${remark}</td><td>${actionButton}</td><td>${getTransactionSlipBookDisplay(transaction)}</td>`;
        tbody.appendChild(tr);
    });
}

function editTransactionSlipInfo(transactionId) {
    const transaction = DB.transactions.find((item) => item.id === toNumber(transactionId, 0));
    if (!transaction) {
        alert("未找到该交易记录");
        return;
    }
    if (!needsWarehouseSlip(transaction.type)) {
        alert("仅出库/入库记录支持补填单号");
        return;
    }

    const currentBook = normalizeSlipBook(transaction.slipBook);
    const currentNo = toIntegerNumber(transaction.slipNo, 0);
    const nextNo = currentBook ? getMaxUsedSlipNo(transaction.type, currentBook, transaction.id) + 1 : "";
    const bookInput = window.prompt("请输入单据簿号（可留空表示清空单号）", currentBook);
    if (bookInput === null) return;

    const targetBook = normalizeSlipBook(bookInput);
    const defaultNoText = currentNo > 0 ? String(currentNo) : (nextNo ? String(nextNo) : "");
    const noInput = window.prompt("请输入单据号（正整数，可留空）", defaultNoText);
    if (noInput === null) return;

    const noText = String(noInput || "").trim();
    if (!targetBook && !noText) {
        delete transaction.slipBook;
        delete transaction.slipNo;
        DB.save();
        alert("已清空该记录的单据号");
        return;
    }

    if (!targetBook || !noText) {
        alert("如需填写单号，请同时填写单据簿号和单据号");
        return;
    }

    if (!isIntegerText(noText) || Number(noText) <= 0) {
        alert("单据号必须为正整数");
        return;
    }

    const slipNo = Number(noText);
    const maxUsedNo = getMaxUsedSlipNo(transaction.type, targetBook, transaction.id);
    const suggestedNo = maxUsedNo > 0 ? maxUsedNo + 1 : 1;
    const hasDuplicate = hasSameSlipNo(transaction.type, targetBook, slipNo, transaction.id);
    if (slipNo !== suggestedNo) {
        const typeLabel = transaction.type === "out" ? "出库" : "入库";
        const confirmSkip = window.confirm(`${typeLabel}簿号 [${targetBook}] 建议下一号是 ${suggestedNo}，当前输入 ${slipNo}。\n确定继续保存吗？`);
        if (!confirmSkip) return;
    }
    if (hasDuplicate) {
        const typeLabel = transaction.type === "out" ? "出库" : "入库";
        const confirmDuplicate = window.confirm(`${typeLabel}簿号 [${targetBook}] 的单据号 ${slipNo} 已存在。\n继续保存会产生重复单号，确定继续吗？`);
        if (!confirmDuplicate) return;
    }

    transaction.slipBook = targetBook;
    transaction.slipNo = slipNo;
    DB.save();
    alert("单据号更新成功");
}

function showPartnerLedgerPage(partnerId) {
    const targetPartnerId = toNumber(partnerId, 0);
    const partner = DB.partners.find((p) => p.id === targetPartnerId);
    if (!partner) {
        alert("未找到该客户/供应商");
        return;
    }
    if (VIEW_STATE.currentLedgerPartnerId !== targetPartnerId) {
        VIEW_STATE.profileEditMode = false;
        VIEW_STATE.profileDraft = null;
    }
    VIEW_STATE.currentLedgerPartnerId = targetPartnerId;
    renderPartnerLedgerPage();
    showPage("partner-ledger");
}

function exportCurrentLedger() {
    const partnerId = toNumber(VIEW_STATE.currentLedgerPartnerId, 0);
    if (!partnerId) {
        alert("请先选择客户/供应商");
        return;
    }
    exportPartnerTransactions(partnerId);
}

