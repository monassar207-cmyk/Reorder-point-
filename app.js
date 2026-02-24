// ════════════════════════════════════════════════════
//  نظام حد الطلب - Reorder Point System
//  Fixed & Enhanced Version
// ════════════════════════════════════════════════════

// ── DATABASE ──────────────────────────────────────
const db = new Dexie('ReorderPointDB');
db.version(1).stores({
    materials: '++id, itemCode, itemName, currentStock, reorderPoint, leadTime, lastUpdated'
});

// ── STATE ─────────────────────────────────────────
let currentView     = 'list';
let editingId       = null;
let deferredPrompt  = null;
let allMaterials    = [];
let sortColumn      = 'itemName';
let sortDirection   = 'asc';
let pendingDeleteId = null;

// ── INIT ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    registerServiceWorker();
    setupNetworkListeners();
    setupInstallPrompt();
});

async function initApp() {
    try {
        await loadMaterials();
    } catch (err) {
        console.error('Init error:', err);
        showToast('تعذّر تحميل البيانات', 'error');
    }
}

// ── SERVICE WORKER ────────────────────────────────
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js')
        .then(reg => {
            console.log('SW registered:', reg.scope);
        })
        .catch(err => console.warn('SW registration failed:', err));
}

// ── NETWORK STATUS ────────────────────────────────
function setupNetworkListeners() {
    const update = () => {
        const dot  = document.getElementById('netDot');
        const text = document.getElementById('netText');
        if (navigator.onLine) {
            dot.className  = 'net-dot';
            text.textContent = 'متصل';
        } else {
            dot.className  = 'net-dot offline';
            text.textContent = 'غير متصل';
            showToast('وضع عدم الاتصال — البيانات محفوظة محلياً', 'warning');
        }
    };
    window.addEventListener('online',  update);
    window.addEventListener('offline', update);
    update();
}

// ── PWA INSTALL ───────────────────────────────────
function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredPrompt = e;
        setTimeout(() => {
            const el = document.getElementById('installPrompt');
            if (el) el.classList.add('show');
        }, 3000);
    });
}

function installApp() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(result => {
        if (result.outcome === 'accepted') showToast('تم تثبيت التطبيق بنجاح ✓', 'success');
        deferredPrompt = null;
        document.getElementById('installPrompt').classList.remove('show');
    });
}

function dismissInstall() {
    document.getElementById('installPrompt').classList.remove('show');
}

// ── LOAD & RENDER ─────────────────────────────────
async function loadMaterials(searchTerm = '') {
    try {
        let materials = await db.materials.toArray();

        // Filter
        if (searchTerm) {
            const q = searchTerm.toLowerCase().trim();
            materials = materials.filter(m =>
                (m.itemName || '').toLowerCase().includes(q) ||
                (m.itemCode || '').toLowerCase().includes(q)
            );
        }

        // Sort
        materials.sort((a, b) => {
            let va = a[sortColumn] ?? '';
            let vb = b[sortColumn] ?? '';
            if (typeof va === 'string') va = va.toLowerCase();
            if (typeof vb === 'string') vb = vb.toLowerCase();
            if (va < vb) return sortDirection === 'asc' ? -1 : 1;
            if (va > vb) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        allMaterials = materials;
        renderMaterials(materials);
        updateStats();
        checkAlerts();
    } catch (err) {
        console.error(err);
        showToast('خطأ في تحميل البيانات', 'error');
    }
}

function renderMaterials(materials) {
    const tbody      = document.getElementById('materialsTableBody');
    const gridEl     = document.getElementById('gridView');
    const emptyEl    = document.getElementById('emptyState');
    const listWrap   = document.getElementById('listView');
    const tableCount = document.getElementById('tableCount');

    tableCount.textContent = `${materials.length} صنف`;

    if (materials.length === 0) {
        tbody.innerHTML = '';
        gridEl.innerHTML = '';
        emptyEl.style.display = 'block';
        listWrap.classList.add('hidden');
        gridEl.classList.remove('active');
        return;
    }

    emptyEl.style.display = 'none';

    if (currentView === 'list') {
        listWrap.classList.remove('hidden');
        gridEl.classList.remove('active');
        renderTable(materials, tbody);
    } else {
        listWrap.classList.add('hidden');
        gridEl.classList.add('active');
        renderGrid(materials, gridEl);
    }
}

function renderTable(materials, tbody) {
    tbody.innerHTML = materials.map((m, idx) => {
        const needsReorder = m.currentStock <= m.reorderPoint;
        const recommendedQty = needsReorder
            ? Math.max(0, (m.reorderPoint * 2) - m.currentStock).toFixed(0)
            : null;

        // Stock bar width capped at 100%
        const barPct = m.reorderPoint > 0
            ? Math.min(100, (m.currentStock / (m.reorderPoint * 2)) * 100).toFixed(1)
            : 100;
        const barColor = needsReorder ? 'var(--accent-danger)' : 'var(--accent-success)';

        return `
        <tr class="${needsReorder ? 'row-danger' : ''}" style="animation-delay:${idx * 0.04}s">
            <td><span class="item-code">${escHtml(m.itemCode)}</span></td>
            <td>
                <div class="item-name">${escHtml(m.itemName)}</div>
                <div class="stock-bar"><div class="stock-bar-fill" style="width:${barPct}%;background:${barColor}"></div></div>
            </td>
            <td style="text-align:center">
                <span class="stock-value ${needsReorder ? 'danger' : 'safe'}">${formatNum(m.currentStock)}</span>
            </td>
            <td style="text-align:center">${formatNum(m.reorderPoint)}</td>
            <td style="text-align:center"><span class="lead-badge">${m.leadTime} يوم</span></td>
            <td style="text-align:center">
                ${needsReorder
                    ? `<span class="status-pill pill-danger">طلب عاجل</span>`
                    : `<span class="status-pill pill-safe">آمن</span>`
                }
            </td>
            <td style="text-align:center">
                ${recommendedQty !== null
                    ? `<span class="recommended-qty urgent">${recommendedQty}</span>`
                    : `<span class="recommended-qty none">—</span>`
                }
            </td>
            <td style="text-align:center">
                <div class="row-actions">
                    <button class="action-btn" onclick="editMaterial(${m.id})" title="تعديل"><i class="fas fa-edit"></i></button>
                    <button class="action-btn del" onclick="confirmDelete(${m.id}, '${escHtml(m.itemName)}')" title="حذف"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function renderGrid(materials, container) {
    container.innerHTML = materials.map((m, idx) => {
        const needsReorder = m.currentStock <= m.reorderPoint;
        const recommendedQty = needsReorder
            ? Math.max(0, (m.reorderPoint * 2) - m.currentStock).toFixed(0)
            : null;

        return `
        <div class="grid-item ${needsReorder ? 'danger-item' : ''}" style="animation-delay:${idx * 0.05}s">
            <div class="grid-top">
                <div>
                    <div class="grid-name">${escHtml(m.itemName)}</div>
                    <div class="grid-code">${escHtml(m.itemCode)}</div>
                </div>
                ${needsReorder
                    ? `<span class="status-pill pill-danger" style="font-size:11px">طلب عاجل</span>`
                    : `<span class="status-pill pill-safe" style="font-size:11px">آمن</span>`
                }
            </div>
            <div class="grid-stats">
                <div class="grid-stat-box">
                    <div class="grid-stat-label">الرصيد</div>
                    <div class="grid-stat-val ${needsReorder ? 'danger' : ''}" style="color:${needsReorder ? 'var(--accent-danger)' : 'var(--text-primary)'}">${formatNum(m.currentStock)}</div>
                </div>
                <div class="grid-stat-box">
                    <div class="grid-stat-label">حد الطلب</div>
                    <div class="grid-stat-val" style="color:var(--accent-primary)">${formatNum(m.reorderPoint)}</div>
                </div>
            </div>
            ${recommendedQty !== null ? `
            <div class="recommend-box">
                <span style="font-size:12px;color:var(--text-secondary)">الكمية المقترحة</span>
                <span class="qty">${recommendedQty}</span>
            </div>` : ''}
            <div class="grid-actions">
                <button class="grid-action-btn" onclick="editMaterial(${m.id})"><i class="fas fa-edit"></i> تعديل</button>
                <button class="grid-action-btn del" onclick="confirmDelete(${m.id}, '${escHtml(m.itemName)}')"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    }).join('');
}

// ── STATS ─────────────────────────────────────────
async function updateStats() {
    try {
        const all = await db.materials.toArray();
        const count   = all.length;
        const total   = all.reduce((s, m) => s + (m.currentStock || 0), 0);
        const alerts  = all.filter(m => m.currentStock <= m.reorderPoint).length;

        animateNumber('totalItems', count);
        animateNumber('totalStock', Math.round(total));
        animateNumber('alertCount', alerts);

        const badge = document.getElementById('alertBadge');
        if (badge) badge.innerHTML = `<i class="fas fa-bell"></i> ${alerts} تنبيه نشط`;
    } catch (err) { console.error(err); }
}

function animateNumber(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const start = parseInt(el.textContent) || 0;
    const diff  = target - start;
    const steps = 20;
    let   step  = 0;
    const timer = setInterval(() => {
        step++;
        el.textContent = Math.round(start + (diff * step / steps));
        if (step >= steps) clearInterval(timer);
    }, 20);
}

// ── ALERTS ────────────────────────────────────────
async function checkAlerts() {
    const all    = await db.materials.toArray();
    const alerts = all.filter(m => m.currentStock <= m.reorderPoint);
    const countEl = document.getElementById('alertCount');
    if (countEl && alerts.length > 0) countEl.classList.add('animate-pulse');
}

async function showAlertView() {
    const all    = await db.materials.toArray();
    const alerts = all.filter(m => m.currentStock <= m.reorderPoint);
    const el     = document.getElementById('alertContent');

    if (alerts.length === 0) {
        el.innerHTML = `
        <div style="text-align:center;padding:48px 20px">
            <div style="font-size:52px;margin-bottom:16px">✅</div>
            <div style="font-size:18px;font-weight:700;margin-bottom:8px">جميع الأصناف بمستوى آمن</div>
            <div style="color:var(--text-muted);font-size:14px">لا توجد أصناف تحتاج إلى طلب شراء حالياً</div>
        </div>`;
    } else {
        el.innerHTML = alerts.map((m, idx) => {
            const recommendedQty = Math.max(0, (m.reorderPoint * 2) - m.currentStock).toFixed(0);
            return `
            <div class="alert-item" style="animation-delay:${idx * 0.06}s">
                <div class="alert-top">
                    <div>
                        <div class="alert-name">${escHtml(m.itemName)}</div>
                        <div class="alert-code">${escHtml(m.itemCode)}</div>
                    </div>
                    <span class="urgent-badge">طلب عاجل</span>
                </div>
                <div class="alert-stats">
                    <div class="alert-stat-box">
                        <div class="alert-stat-label">الرصيد الحالي</div>
                        <div class="alert-stat-val red">${formatNum(m.currentStock)}</div>
                    </div>
                    <div class="alert-stat-box">
                        <div class="alert-stat-label">حد الطلب</div>
                        <div class="alert-stat-val">${formatNum(m.reorderPoint)}</div>
                    </div>
                    <div class="alert-stat-box">
                        <div class="alert-stat-label">الكمية المطلوبة</div>
                        <div class="alert-stat-val purple">${recommendedQty}</div>
                    </div>
                </div>
                <div class="alert-lead"><i class="fas fa-clock" style="margin-left:5px"></i>مدة التوريد: ${m.leadTime} يوم</div>
            </div>`;
        }).join('');
    }

    openModal('alertModal');
}

async function exportAlerts() {
    const all    = await db.materials.toArray();
    const alerts = all.filter(m => m.currentStock <= m.reorderPoint);
    if (alerts.length === 0) { showToast('لا توجد تنبيهات للتصدير', 'warning'); return; }

    const rows = alerts.map(m => ({
        'كود الصنف'     : m.itemCode,
        'اسم الصنف'     : m.itemName,
        'الرصيد الحالي' : m.currentStock,
        'حد الطلب'      : m.reorderPoint,
        'الكمية المطلوبة': Math.max(0, (m.reorderPoint * 2) - m.currentStock),
        'مدة التوريد (يوم)': m.leadTime
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تنبيهات الطلب');
    XLSX.writeFile(wb, `طلبيات_${today()}.xlsx`);
    showToast('تم تصدير قائمة الطلبيات بنجاح', 'success');
}

// ── CRUD ──────────────────────────────────────────
async function saveMaterial(e) {
    e.preventDefault();

    const code = document.getElementById('itemCode').value.trim();
    const name = document.getElementById('itemName').value.trim();

    if (!code || !name) { showToast('يرجى ملء جميع الحقول المطلوبة', 'warning'); return; }

    // Check duplicate code (excluding current item when editing)
    const existing = await db.materials.where('itemCode').equalsIgnoreCase(code).first();
    if (existing && existing.id !== editingId) {
        showToast('كود الصنف موجود مسبقاً، يرجى استخدام كود مختلف', 'error');
        return;
    }

    const material = {
        itemCode     : code,
        itemName     : name,
        currentStock : parseFloat(document.getElementById('currentStock').value) || 0,
        reorderPoint : parseFloat(document.getElementById('reorderPoint').value) || 0,
        leadTime     : parseInt(document.getElementById('leadTime').value)       || 0,
        lastUpdated  : new Date()
    };

    try {
        if (editingId) {
            await db.materials.update(editingId, material);
            showToast('تم تحديث الصنف بنجاح', 'success');
        } else {
            await db.materials.add(material);
            showToast('تم إضافة الصنف بنجاح', 'success');
        }
        closeModal('materialModal');
        document.getElementById('materialForm').reset();
        editingId = null;
        await loadMaterials(document.getElementById('searchInput').value);
    } catch (err) {
        console.error(err);
        showToast('خطأ أثناء حفظ البيانات', 'error');
    }
}

async function editMaterial(id) {
    try {
        const m = await db.materials.get(id);
        if (!m) { showToast('الصنف غير موجود', 'error'); return; }
        editingId = id;
        document.getElementById('modalTitle').textContent = 'تعديل صنف';
        document.getElementById('itemCode').value     = m.itemCode     || '';
        document.getElementById('itemName').value     = m.itemName     || '';
        document.getElementById('currentStock').value = m.currentStock ?? 0;
        document.getElementById('reorderPoint').value = m.reorderPoint ?? 0;
        document.getElementById('leadTime').value     = m.leadTime     ?? 0;
        openModal('materialModal');
    } catch (err) {
        console.error(err);
        showToast('خطأ في تحميل بيانات الصنف', 'error');
    }
}

function confirmDelete(id, name) {
    pendingDeleteId = id;
    document.getElementById('confirmMsg').textContent = `هل تريد حذف "${name}"؟ لا يمكن التراجع عن هذا الإجراء.`;
    document.getElementById('confirmBtn').onclick = () => deleteMaterial(id);
    openModal('confirmModal');
}

async function deleteMaterial(id) {
    closeModal('confirmModal');
    try {
        await db.materials.delete(id);
        showToast('تم حذف الصنف', 'success');
        await loadMaterials(document.getElementById('searchInput').value);
    } catch (err) {
        console.error(err);
        showToast('خطأ أثناء الحذف', 'error');
    }
}

// ── IMPORT ────────────────────────────────────────
function handleDragOver(e) {
    e.preventDefault();
    document.getElementById('dropZone').classList.add('dragover');
}

function handleDragLeave() {
    document.getElementById('dropZone').classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    document.getElementById('dropZone').classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
}

function handleFileImport(e) {
    const file = e.target.files[0];
    if (file) processFile(file);
    e.target.value = ''; // reset so same file can be re-imported
}

function processFile(file) {
    const isCSV = file.name.toLowerCase().endsWith('.csv');
    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            let materials = [];
            if (isCSV) {
                materials = parseCSV(e.target.result);
            } else {
                const data     = new Uint8Array(e.target.result);
                const wb       = XLSX.read(data, { type: 'array' });
                const ws       = wb.Sheets[wb.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1 });
                materials = parseExcelData(jsonData);
            }

            if (materials.length === 0) {
                showToast('لم يتم العثور على بيانات صالحة في الملف', 'warning');
                return;
            }

            // Use bulkPut (upsert by itemCode) instead of bulkAdd to avoid duplicates
            let added = 0, updated = 0;
            for (const m of materials) {
                const existing = await db.materials.where('itemCode').equalsIgnoreCase(m.itemCode).first();
                if (existing) {
                    await db.materials.update(existing.id, m);
                    updated++;
                } else {
                    await db.materials.add(m);
                    added++;
                }
            }

            closeModal('importModal');
            await loadMaterials();
            showToast(`تم استيراد ${added} صنف جديد وتحديث ${updated} صنف`, 'success');
        } catch (err) {
            console.error(err);
            showToast('خطأ في قراءة الملف — تحقق من التنسيق', 'error');
        }
    };

    reader.onerror = () => showToast('فشل قراءة الملف', 'error');

    if (isCSV) reader.readAsText(file, 'UTF-8');
    else        reader.readAsArrayBuffer(file);
}

function parseCSV(text) {
    const lines     = text.replace(/\r/g, '').split('\n');
    const materials = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        // Handle quoted CSV
        const cols = line.match(/(".*?"|[^,]+)/g) || line.split(',');
        if (cols.length >= 5 && cols[0]) {
            materials.push({
                itemCode     : String(cols[0]).replace(/"/g,'').trim(),
                itemName     : String(cols[1]).replace(/"/g,'').trim(),
                currentStock : parseFloat(cols[2]) || 0,
                reorderPoint : parseFloat(cols[3]) || 0,
                leadTime     : parseInt(cols[4])   || 0,
                lastUpdated  : new Date()
            });
        }
    }
    return materials;
}

function parseExcelData(data) {
    const materials = [];
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length < 5 || !row[0]) continue;
        materials.push({
            itemCode     : String(row[0]).trim(),
            itemName     : String(row[1] || '').trim(),
            currentStock : parseFloat(row[2]) || 0,
            reorderPoint : parseFloat(row[3]) || 0,
            leadTime     : parseInt(row[4])   || 0,
            lastUpdated  : new Date()
        });
    }
    return materials;
}

// ── EXPORT ────────────────────────────────────────
async function exportData() {
    const all = await db.materials.toArray();
    if (all.length === 0) { showToast('لا توجد بيانات للتصدير', 'warning'); return; }

    const rows = all.map(m => ({
        'كود الصنف'       : m.itemCode,
        'اسم الصنف'       : m.itemName,
        'الرصيد الحالي'   : m.currentStock,
        'حد الطلب'        : m.reorderPoint,
        'مدة التوريد (يوم)': m.leadTime,
        'الكمية المقترحة' : m.currentStock <= m.reorderPoint ? Math.max(0, (m.reorderPoint * 2) - m.currentStock) : 0,
        'الحالة'          : m.currentStock <= m.reorderPoint ? 'يحتاج طلب' : 'مخزون آمن',
        'آخر تحديث'       : m.lastUpdated ? new Date(m.lastUpdated).toLocaleDateString('en-gb') : ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'المخزون');
    XLSX.writeFile(wb, `مخزون_${today()}.xlsx`);
    showToast('تم تصدير البيانات بنجاح', 'success');
}

// ── SORT ──────────────────────────────────────────
function sortBy(col) {
    if (sortColumn === col) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn    = col;
        sortDirection = 'asc';
    }

    // Update sort icons
    document.querySelectorAll('.sortable').forEach(th => th.classList.remove('active'));
    const icon = document.getElementById(`sort-${col}`);
    if (icon) {
        icon.closest('.sortable').classList.add('active');
        icon.className = `fas fa-sort-${sortDirection === 'asc' ? 'up' : 'down'} sort-icon`;
    }

    loadMaterials(document.getElementById('searchInput').value);
}

// ── SEARCH ────────────────────────────────────────
function searchMaterials() {
    const term = document.getElementById('searchInput').value;
    loadMaterials(term);
}

// ── VIEW TOGGLE ───────────────────────────────────
function setView(view) {
    currentView = view;
    document.getElementById('listViewBtn').classList.toggle('active', view === 'list');
    document.getElementById('gridViewBtn').classList.toggle('active', view === 'grid');
    renderMaterials(allMaterials);
}

// ── REFRESH ───────────────────────────────────────
function refreshData() {
    const icon = document.getElementById('refreshIcon');
    icon.style.transition = 'transform 0.5s ease';
    icon.style.transform  = 'rotate(360deg)';
    setTimeout(() => { icon.style.transition = ''; icon.style.transform = ''; }, 500);
    loadMaterials(document.getElementById('searchInput').value)
        .then(() => showToast('تم تحديث البيانات', 'success'));
}

// ── MODALS ────────────────────────────────────────
function showAddModal() {
    editingId = null;
    document.getElementById('materialForm').reset();
    document.getElementById('modalTitle').textContent = 'إضافة صنف جديد';
    openModal('materialModal');
}

function showImportModal() {
    openModal('importModal');
}

function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
}

function handleOverlayClick(e, id) {
    if (e.target === document.getElementById(id)) closeModal(id);
}

// Close modals with Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        ['materialModal','importModal','alertModal','confirmModal'].forEach(closeModal);
    }
});

// ── TOAST ─────────────────────────────────────────
function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation', info: 'fa-info' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || icons.info}"></i></div>
        <span>${escHtml(msg)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.transition = 'all 0.4s ease';
        toast.style.opacity    = '0';
        toast.style.transform  = 'translateY(10px)';
        setTimeout(() => toast.remove(), 400);
    }, 3200);
}

// ── HELPERS ───────────────────────────────────────
function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
}

function formatNum(n) {
    if (n == null || isNaN(n)) return '0';
    return Number(n).toLocaleString('en-us', { maximumFractionDigits: 2 });
}

function today() {
    return new Date().toISOString().split('T')[0];
}
