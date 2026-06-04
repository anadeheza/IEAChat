const API_BASE = window.API_BASE || 'http://localhost:3000/api';

const attachmentsListEl = document.getElementById('attachments-list');
const attachmentsCountEl = document.getElementById('attachments-count');
const attachmentsTotalSizeEl = document.getElementById('attachments-total-size');
const selectAllBtn = document.getElementById('select-all-btn');
const downloadSelectedBtn = document.getElementById('download-selected-btn');
const downloadAllBtn = document.getElementById('download-all-btn');
const toggleDbViewBtn = document.getElementById('toggle-db-view-btn');
const downloadAllDbBtn = document.getElementById('download-all-db-btn');
const downloadCancelBtn = document.getElementById('download-cancel-btn');
const downloadProgressEl = document.getElementById('download-progress');
const downloadProgressBar = document.getElementById('download-progress-bar');
const downloadProgressText = document.getElementById('download-progress-text');

let attachments = [];
let allSelected = false;
let showAllDb = JSON.parse(sessionStorage.getItem('flock_attachments_showAllDb') || 'false');
const currentUser = JSON.parse(localStorage.getItem('flock_archive_session') || 'null');

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes/1024).toFixed(0)} KB`;
    return `${(bytes/1048576).toFixed(1)} MB`;
}

function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 7000);
}

async function fetchAttachments() {
    attachmentsListEl.innerHTML = 'Cargando…';
    try {
        const query = showAllDb ? '?all=true' : '';
        const headers = {};
        if (currentUser && currentUser.email) headers['x-user-email'] = currentUser.email;
        const res = await fetch(`${API_BASE}/attachments${query}`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        attachments = await res.json();

        renderList();
    } catch (err) {
        attachmentsListEl.innerHTML = `<div style="color:red;">Error al cargar adjuntos: ${err.message}</div>`;
    }
}

function renderList() {
//    const savedScroll = attachmentsListEl.scrollTop;
//    console.log('the scroll is', savedScroll);


    if (!attachments || attachments.length === 0) {
        const emptyText = showAllDb ? 'No hay archivos en la DB.' : 'No hay adjuntos pendientes para este usuario.';
        attachmentsListEl.innerHTML = `<div class="search-empty">${emptyText}</div>`;
        attachmentsCountEl.textContent = '0 adj';
        attachmentsTotalSizeEl.textContent = '0 B';
        return;
    }

    attachmentsCountEl.textContent = `${attachments.length} adj`;
    attachmentsTotalSizeEl.textContent = '…';
    fetch(`${API_BASE}/attachments/real-size`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
            attachmentsTotalSizeEl.textContent = formatBytes(Number(data.totalBytes));
        })
        .catch(() => {
            const fallback = attachments.reduce((s, a) => s + (Number(a.sizeBytes || 0)), 0);
            attachmentsTotalSizeEl.textContent = formatBytes(fallback);
        });

    const rows = attachments.map(att => {
        const sizeLabel = att.sizeBytes ? formatBytes(Number(att.sizeBytes)) : '—';
        const source = att.message?.senderName ? `${att.message.senderName}` : att.message?.sourceFile || '';
        const downloadedBadge = att.isDownloaded ? `<span style="margin-left:8px; font-size:.75rem; color:var(--accent);">Descargado</span>` : '';
        return `
            <div class="attachment-row" style="display:flex; align-items:center; gap:8px; padding:8px; border-bottom:1px solid rgba(255,255,255,.02);">
                <input type="checkbox" data-id="${att.id}" class="att-checkbox" />
                <div style="flex:1">
                    <div style="font-weight:600">${att.fileName} ${downloadedBadge}</div>
                    <div style="font-size:.85rem; color: var(--text-muted);">${source}</div>
                </div>
                <div style="white-space:nowrap; margin-left:8px">${sizeLabel}</div>
            </div>
        `;
    }).join('');

    attachmentsListEl.innerHTML = rows;
}     

function getSelectedIds() {
    const checks = Array.from(document.querySelectorAll('.att-checkbox'));
    return checks.filter(c => c.checked).map(c => Number(c.dataset.id));
}

selectAllBtn.addEventListener('click', () => {
    allSelected = !allSelected;
    document.querySelectorAll('.att-checkbox').forEach(ch => ch.checked = allSelected);
    selectAllBtn.textContent = allSelected ? 'Deseleccionar todo' : 'Seleccionar todo';
});

if (toggleDbViewBtn) {
    // Sync button label to match the restored state on page load
    toggleDbViewBtn.textContent = showAllDb ? 'Ver solo mis archivos' : 'Ver todos los archivos de la DB';

    toggleDbViewBtn.addEventListener('click', () => {
        showAllDb = !showAllDb;
        sessionStorage.setItem('flock_attachments_showAllDb', JSON.stringify(showAllDb));
        toggleDbViewBtn.textContent = showAllDb ? 'Ver solo mis archivos' : 'Ver todos los archivos de la DB';
        fetchAttachments().catch(() => {});
    });
}

async function postDownload(ids) {
    try {
        const res = await fetch(`${API_BASE}/attachments/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data;
    } catch (err) {
        throw err;
    }
}

function updateDownloadedStatus(ids) {
    const idSet = new Set(ids);
    attachments.forEach(att => {
        if (idSet.has(att.id)) {
            att.isDownloaded = true;
        }
    });
    renderList();
}

downloadSelectedBtn.addEventListener('click', async () => {
    const ids = getSelectedIds();
    if (!ids.length) return showToast('Seleccioná al menos un archivo.');
    downloadSelectedBtn.disabled = true;
    downloadSelectedBtn.textContent = 'Descargando…';
    if (downloadCancelBtn) { downloadCancelBtn.style.display = 'inline-block'; downloadCancelBtn.disabled = false; }
    try {
        const r = await postDownload(ids);
        const mainMsg = r.downloaded === 1
            ? `Descargado 1 archivo exitosamente`
            : `Descargados ${r.downloaded} archivos exitosamente`;
        const extra = r.failed ? `, fallaron ${r.failed}` : '';
        showToast(mainMsg + extra);
        // Update list locally without flickering
        updateDownloadedStatus(ids);
    } catch (err) {
        showToast(`Error: ${err.message}`);
    } finally {
        downloadSelectedBtn.disabled = false;
        downloadSelectedBtn.textContent = 'Descargar seleccionados';
        if (downloadCancelBtn) { downloadCancelBtn.style.display = 'none'; downloadCancelBtn.disabled = false; }
    }
});

downloadAllBtn.addEventListener('click', async () => {
    const pending = attachments.filter(a => !a.isDownloaded);
    if (!pending.length) return showToast('No hay adjuntos pendientes (todos ya descargados).');
    downloadAllBtn.disabled = true;
    downloadAllBtn.textContent = 'Descargando…';
    if (downloadCancelBtn) { downloadCancelBtn.style.display = 'inline-block'; downloadCancelBtn.disabled = false; }
    try {
        const ids = pending.map(a => a.id);
        const r = await postDownload(ids);
        const mainMsgAll = r.downloaded === 1
            ? `Descargado 1 archivo exitosamente`
            : `Descargados ${r.downloaded} archivos exitosamente`;
        const extraAll = r.failed ? `, fallaron ${r.failed}` : '';
        showToast(mainMsgAll + extraAll);
        // Update list locally without flickering
        updateDownloadedStatus(ids);
    } catch (err) {
        showToast(`Error: ${err.message}`);
    } finally {
        downloadAllBtn.disabled = false;
        downloadAllBtn.textContent = 'Descargar todos';
        if (downloadCancelBtn) { downloadCancelBtn.style.display = 'none'; downloadCancelBtn.disabled = false; }
    }
});

if (downloadAllDbBtn) {
    downloadAllDbBtn.addEventListener('click', async () => {
        showAllDb = true;
        sessionStorage.setItem('flock_attachments_showAllDb', JSON.stringify(true));
        toggleDbViewBtn.textContent = 'Ver solo mis archivos';
        downloadAllDbBtn.disabled = true;
        downloadAllDbBtn.textContent = 'Descargando…';
        if (downloadCancelBtn) { downloadCancelBtn.style.display = 'inline-block'; downloadCancelBtn.disabled = false; }
        try {
            await fetchAttachments();
            const pending = attachments.filter(a => !a.isDownloaded);
            if (!pending.length) return showToast('No hay archivos pendientes (todos ya descargados).');
            const ids = pending.map(a => a.id);
            const r = await postDownload(ids);
            const mainMsgAll = r.downloaded === 1
                ? `Descargado 1 archivo exitosamente`
                : `Descargados ${r.downloaded} archivos exitosamente`;
            const extraAll = r.failed ? `, fallaron ${r.failed}` : '';
            showToast(mainMsgAll + extraAll);
            // Update list locally without flickering
            updateDownloadedStatus(ids);
        } catch (err) {
            showToast(`Error: ${err.message}`);
        } finally {
            downloadAllDbBtn.disabled = false;
            downloadAllDbBtn.textContent = 'Descargar todos (DB)';
        }
    });
}

if (downloadCancelBtn) {
    downloadCancelBtn.addEventListener('click', async () => {
        try {
            downloadCancelBtn.disabled = true;
            const res = await fetch(`${API_BASE}/attachments/cancel`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            showToast('Solicitud de cancelación enviada');
        } catch (err) {
            showToast(`Error cancelando: ${err.message}`);
        } finally {
            downloadCancelBtn.disabled = false;
            downloadCancelBtn.style.display = 'none';
        }
    });
}

// Init
fetchAttachments();