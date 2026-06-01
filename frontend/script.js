const API_BASE = window.API_BASE || 'http://localhost:3000/api';

// ─── Estado global ───────────────────────────────────────────
const state = {
    currentUser: JSON.parse(localStorage.getItem('flock_archive_session')) || null,
    view: null,          // { type: 'channel'|'dm', id, name }
    pageSize: 50,
    totalMessages: 0,
    loadedMessages: 0,
    loadedMessagesList: [],
    hasMoreMessages: true,
    isLoadingMessages: false,
    searchTimer: null,
    sidebarSearchTimer: null,

    // Datos completos para sidebar search + show-more
    allChannels: [],
    allUsers: [],
    channelsExpanded: false,
    dmsExpanded: false,
    SIDEBAR_LIMIT: 10,
};

const channelsList      = document.getElementById('channels-list');
const dmsList           = document.getElementById('dms-list');
const messagesEl        = document.getElementById('messages-container');
const titleEl           = document.getElementById('current-view-title');
const viewIconEl        = document.getElementById('view-icon');
const msgCountEl        = document.getElementById('message-count');
const footerChannelEl   = document.getElementById('footer-channel');
const pageInfoEl        = document.getElementById('page-info');
const searchInput       = document.getElementById('search-input');
const searchResults     = document.getElementById('search-results');
const statMessages      = document.getElementById('stat-messages');
const statAttachments   = document.getElementById('stat-attachments');
const statAttachmentSize = document.getElementById('stat-total-size');
const downloadAttachmentsBtn = document.getElementById('download-attachments-btn');
const sidebarSearch     = document.getElementById('sidebar-search');
const channelsShowMore  = document.getElementById('channels-show-more');
const dmsShowMore       = document.getElementById('dms-show-more');
const channelsCount     = document.getElementById('channels-count');
const dmsCount          = document.getElementById('dms-count');
const loginOverlay = document.getElementById('login-overlay');
const loginForm    = document.getElementById('login-form');
const loginEmail   = document.getElementById('login-email');
const loginError   = document.getElementById('login-error');
const userProfileName  = document.getElementById('user-profile-name');
const userProfileEmail = document.getElementById('user-profile-email');
const logoutBtn        = document.getElementById('logout-btn');

// API helpers 
async function apiFetch(path) {
    const url = `${API_BASE}${path}`;
    console.log('Fetching:', url); // Para debugging
    
    try {
        const res = await fetch(url);
        if (!res.ok) {
            const errorText = await res.text();
            console.error(`Error ${res.status}:`, errorText);
            throw new Error(`HTTP ${res.status} en ${path}`);
        }
        return res.json();
    } catch (err) {
        console.error('API Fetch Error:', err);
        throw err;
    }
}

function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 7000);
}

function dayLabel(dateText) {
    return (dateText || '').split(' ')[0] || dateText;
}

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes/1024).toFixed(0)} KB`;
    return `${(bytes/1048576).toFixed(1)} MB`;
}

//sidebar open/close
function openNav() {
  document.getElementById("sidebar").style.width = "400px";
  document.getElementById("main-content").style.marginLeft = "310px";
}

function closeNav() {
  document.getElementById("sidebar").style.width = "0";
  document.getElementById("main-content").style.marginLeft = "0";
}

// Render de un mensaje 
function buildMessageEl(msg) {
    const div = document.createElement('div');
    const isOwn = state.currentUser && msg.senderName === state.currentUser.name;
    div.className = isOwn ? 'message message-own' : 'message';

    let attachHTML = '';
    if (msg.attachments && msg.attachments.length > 0) {
        const links = msg.attachments.map(att => {
            const sizeLabel = att.sizeBytes
                ? ` <span class="att-size">${formatBytes(Number(att.sizeBytes))}</span>`
                : '';
            const localUrl = att.s3Key && att.s3Key.startsWith('http') ? att.s3Key : null;
            const href = localUrl || att.url;
            
            // Preferimos usar la URL local si está disponible para previsualizar/descargar
            const fileTarget = localUrl || att.url;
            
            const redownloadBtn = att.isDownloaded ? `
                <button class="attachment-redownload-btn" title="Descargar nuevamente" onclick="redownloadAttachment('${att.id}')">
                    ↻ Re-descargar
                </button>
            ` : '';

            return `
                <div class="attachment-wrapper">
                    <a href="${href}" target="_blank" class="attachment-link">
                        📄 ${escHtml(att.fileName)}${sizeLabel}
                    </a>
                    <button class="attachment-query-btn" title="Consultar archivo" onclick="handleFileQueryById(${att.id})">
                        Preview
                    </button>
                    ${redownloadBtn}
                </div>
            `;
        }).join('');
        attachHTML = `<div class="attachments">${links}</div>`;
    }

    div.innerHTML = `
        <div class="message-header">
            <span class="sender-name">${escHtml(msg.senderName)}</span>
            <span class="message-time">${escHtml(msg.dateText)}</span>
        </div>
        <div id="message-body" class="message-body">${escHtml(msg.text)}</div>
        ${attachHTML}
    `;
    return div;
}

// Función para abrir el modal con la preview del archivo
async function handleFileQuery(fileTarget) {
    const modal = document.getElementById('preview-modal');
    const title = document.getElementById('preview-title');
    const body = document.getElementById('preview-body');
    
    // Normalizar fileTarget a una URL absoluta antes de enviarla al backend
    let fileUrl = String(fileTarget || '');
    // Quitar prefijo interno si existe
    if (fileUrl.startsWith('#s3:')) fileUrl = fileUrl.replace('#s3:', '');
    // Si no es una URL absoluta, construirla usando el origen actual
    if (!/^https?:\/\//i.test(fileUrl)) {
        if (fileUrl.startsWith('/')) {
            fileUrl = window.location.origin + fileUrl;
        } else {
            fileUrl = window.location.origin + '/' + fileUrl;
        }
    }

    const fileName = fileUrl.split('?')[0].split('/').pop() || 'Archivo';
    title.textContent = `Vista previa`;
    body.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; padding: 20px;">
            <div class="loading-spinner"></div> 
            <span style="margin-left:12px; font-family:sans-serif;">Generando entorno de vista previa...</span>
        </div>
    `;
    modal.style.display = 'flex';
    
    console.log('📤 Enviando archivo (normalizado):', fileUrl);
    try {
        const response = await fetch(`${API_BASE}/attachments/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ file: fileUrl })
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '<no body>');
            console.error('Server error', response.status, text);
            throw new Error(`Error del servidor ${response.status}: ${text}`);
        }

        const data = await response.json();
        
        if (data.status === "success") {
            if (data.type === "image") {
                body.style.whiteSpace = "normal";
                body.style.background = "#222"; 
                body.innerHTML = `
                    <div style="display:flex; justify-content:center; align-items:center; min-height:200px; width:100%;">
                        <img src="${data.content}" alt="${fileName}" style="max-width:100%; max-height:70vh; object-fit:contain; border-radius:4px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);" />
                    </div>
                `;
            } else if (data.type === "text") {
                body.style.whiteSpace = "pre-wrap";
                body.style.background = "#f9f9f9";
                body.textContent = data.content;
            } else if (data.type === "document" || data.type === "pdf") {
                // VISOR DE DOCUMENTOS SEGURO (Iframe)
                body.style.whiteSpace = "normal";
                body.style.background = "#fff";
                body.style.padding = "0"; // Maximizamos espacio para el iframe
                
                // Usamos el visor oficial embebido de Google Docs pasándole la URL real de Flock
                body.innerHTML = `
                    <iframe src="https://docs.google.com/viewer?url=${encodeURIComponent(data.file)}&embedded=true" 
                            style="width:100%; height:72vh; border:none;" 
                            loading="lazy">
                    </iframe>
                `;
            }
        } else {
            body.style.whiteSpace = "normal";
            body.style.background = "#f9f9f9";
            body.innerHTML = `
                <div style="padding:10px; font-family:sans-serif;">
                    <p><strong>Información:</strong> ${data.message}</p>
                    <p><strong>Ubicación:</strong> <code style="background:#eee; padding:2px 6px; border-radius:3px;">${data.file}</code></p>
                </div>
            `;
        }
        
    } catch (err) {
        body.style.whiteSpace = "normal";
        body.style.background = "#f9f9f9";
        body.innerHTML = `<span style="color: red; font-weight: bold; font-family:sans-serif;">⚠️ Error al abrir la vista previa:</span><br><code style="display:block; margin-top:8px;">${err.message}</code>`;
    }
}

// Función para cerrar el modal
function closePreviewModal() {
    document.getElementById('preview-modal').style.display = 'none';
}

// Función para abrir preview usando el ID del attachment (evita colisiones por nombre)
async function handleFileQueryById(attachmentId) {
    const modal = document.getElementById('preview-modal');
    const title = document.getElementById('preview-title');
    const body = document.getElementById('preview-body');
    title.textContent = `Vista previa`;
    body.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; padding: 20px;">
            <div class="loading-spinner"></div>
            <span style="margin-left:12px; font-family:sans-serif;">Generando entorno de vista previa...</span>
        </div>
    `;
    modal.style.display = 'flex';

    console.log('📤 Enviando id de attachment para preview:', attachmentId);
    try {
        const response = await fetch(`${API_BASE}/attachments/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: Number(attachmentId) })
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '<no body>');
            console.error('Server error', response.status, text);
            throw new Error(`Error del servidor ${response.status}: ${text}`);
        }

        const data = await response.json();
        if (data.status === "success") {
            if (data.type === "image") {
                body.style.whiteSpace = "normal";
                body.style.background = "#222";
                body.innerHTML = `
                    <div style="display:flex; justify-content:center; align-items:center; min-height:200px; width:100%;">
                        <img src="${data.content}" alt="Preview" style="max-width:100%; max-height:70vh; object-fit:contain; border-radius:4px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);" />
                    </div>
                `;
            } else if (data.type === "text") {
                body.style.whiteSpace = "pre-wrap";
                body.style.background = "#f9f9f9";
                body.textContent = data.content;
            } else if (data.type === "document" || data.type === "pdf") {
                body.style.whiteSpace = "normal";
                body.style.background = "#fff";
                body.style.padding = "0";
                body.innerHTML = `
                    <iframe src="https://docs.google.com/viewer?url=${encodeURIComponent(data.file)}&embedded=true" 
                            style="width:100%; height:72vh; border:none;" 
                            loading="lazy">
                    </iframe>
                `;
            }
        } else {
            body.style.whiteSpace = "normal";
            body.style.background = "#f9f9f9";
            body.innerHTML = `
                <div style="padding:10px; font-family:sans-serif;">
                    <p><strong>Información:</strong> ${data.message}</p>
                </div>
            `;
        }
    } catch (err) {
        body.style.whiteSpace = "normal";
        body.style.background = "#f9f9f9";
        body.innerHTML = `<span style="color: red; font-weight: bold; font-family:sans-serif;">⚠️ Error al abrir la vista previa:</span><br><code style="display:block; margin-top:8px;">${err.message}</code>`;
    }
}

function updateUserProfileUI() {
    const userProfileName = document.getElementById('user-profile-name');
    const userProfileEmail = document.getElementById('user-profile-email');
    if (state.currentUser && userProfileName && userProfileEmail) {
        userProfileName.textContent = state.currentUser.name || 'Usuario';
        userProfileEmail.textContent = state.currentUser.email || '';
    }
}

// Renderizar lista de mensajes con separadores de día 
function renderMessages(messages) {
    messagesEl.innerHTML = '';

    if (!messages || messages.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = '<div class="empty-icon">💬</div><p>Sin mensajes en este canal.</p>';
        messagesEl.appendChild(empty);
        return;
    }

    let lastDay = null;
    for (const msg of messages) {
        const day = dayLabel(msg.dateText);
        if (day !== lastDay) {
            const sep = document.createElement('div');
            sep.className = 'date-separator';
            sep.innerHTML = `<span>${escHtml(day)}</span>`;
            messagesEl.appendChild(sep);
            lastDay = day;
        }
        messagesEl.appendChild(buildMessageEl(msg));
    }
}

function prependMessages(messages) {
    if (!messages || messages.length === 0) return;

    const firstExistingDayEl = messagesEl.querySelector('.date-separator:first-of-type');
    const firstExistingDay = firstExistingDayEl ? firstExistingDayEl.textContent : null;
    const wrapper = document.createDocumentFragment();
    let lastDay = null;

    for (const msg of messages) {
        const day = dayLabel(msg.dateText);
        if (day !== lastDay) {
            const sep = document.createElement('div');
            sep.className = 'date-separator';
            sep.innerHTML = `<span>${escHtml(day)}</span>`;
            wrapper.appendChild(sep);
            lastDay = day;
        }
        wrapper.appendChild(buildMessageEl(msg));
    }

    const batchLastDay = lastDay;
    const firstChild = messagesEl.firstChild;
    if (firstExistingDay && batchLastDay === firstExistingDay) {
        const separators = Array.from(wrapper.querySelectorAll('.date-separator'));
        const lastSeparator = separators[separators.length - 1];
        if (lastSeparator && lastSeparator.nextSibling) {
            wrapper.removeChild(lastSeparator);
        }
    }

    const previousHeight = messagesEl.scrollHeight;
    const previousScroll = messagesEl.scrollTop;
    messagesEl.insertBefore(wrapper, firstChild);
    // Wait for the browser to reflow the new nodes before correcting scroll,
    // otherwise scrollHeight is stale and the position jumps.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            messagesEl.scrollTop = previousScroll + (messagesEl.scrollHeight - previousHeight);
        });
    });
}

// Cargar mensajes de la vista actual
async function loadMessages() {
    if (!state.view) return;

    if (state.isLoadingMessages) return;
    state.isLoadingMessages = true;

    const isInitialPage = state.loadedMessages === 0;
    if (isInitialPage) {
        state.loadedMessages = 0;
        state.loadedMessagesList = [];
        state.hasMoreMessages = true;
        messagesEl.innerHTML = '';
        showLoadingSkeleton(true);
    }

    showLoading(true);

    const params = new URLSearchParams({
        take: String(state.pageSize),
    });

    if (!isInitialPage && state.loadedMessagesList.length > 0) {
        const beforeId = state.loadedMessagesList[0].id;
        if (beforeId) params.set('beforeId', String(beforeId));
    }

    const email = encodeURIComponent(state.currentUser.email || '');
    let url;
    if (state.view.type === 'channel') {
        url = `${API_BASE}/channels/${encodeURIComponent(state.view.id)}/messages?${params.toString()}`;
    } else {
        url = `${API_BASE}/dm/${encodeURIComponent(state.view.id)}/conversation?currentUserEmail=${email}&${params.toString()}`;
    }

    console.log('Loading messages from:', url); // Debug

    try {
        const res = await fetch(url);
        /*        console.log('Response status:', res.status); // Debug

        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        */
        const messages = await res.json();
            console.log('Messages received:', messages.length); // Debug

        // Obtener total de la cabecera si está disponible
        const totalHeader = res.headers.get('X-Total-Count');
        state.totalMessages = totalHeader ? parseInt(totalHeader, 10) : messages.length;

        if (isInitialPage) {
            state.loadedMessagesList = messages;
            renderMessages(messages);
            messagesEl.scrollTop = messagesEl.scrollHeight;
        } else {
            state.loadedMessagesList.unshift(...messages);
            prependMessages(messages);
        }

        state.loadedMessages += messages.length;
        state.hasMoreMessages = state.loadedMessages < state.totalMessages;
        updatePagination();

    } catch (err) {
        console.error("Error al cargar mensajes:", err);
        messagesEl.innerHTML = `<div class="search-empty" style="color:red;">
            Error: ${err.message}<br>
            Verifica que el backend esté corriendo en ${API_BASE}
        </div>`;    
    } finally {
        state.isLoadingMessages = false;
        showLoadingSkeleton(false);
        showLoading(false);
    }
}


// Actualizar estado de la barra de carga y de paginación 
function updatePagination() {
    const loaded = state.loadedMessages;
    const total  = state.totalMessages;

    if (loaded === 0) {
        pageInfoEl.textContent = 'Sin mensajes';
        msgCountEl.textContent = '';
    } else if (total > 0) {
        pageInfoEl.textContent = `Cargados ${loaded} de ${total}`;
        msgCountEl.textContent = `Mostrando ${loaded} de ${total}`;
    } else {
        pageInfoEl.textContent = `Cargados ${loaded}`;
        msgCountEl.textContent = `${loaded} mensajes cargados`;
    }

}

async function downloadAttachmentsBatch() {
    if (!downloadAttachmentsBtn) return;
    downloadAttachmentsBtn.disabled = true;
    const originalText = downloadAttachmentsBtn.textContent;
    downloadAttachmentsBtn.textContent = 'Descargando...';

    try {
        const response = await fetch(`${API_BASE}/attachments/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 5 }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.total === 0) {
            showToast('No hay adjuntos pendientes para descargar.');
        } else {
            const mainMsg = data.downloaded === 1
                ? `Descargado 1 archivo exitosamente`
                : `Descargados ${data.downloaded} archivos exitosamente`;
            const extra = data.failed ? `, fallaron ${data.failed}` : '';
            showToast(mainMsg + extra);
        }
        loadStats().catch(() => {});
    } catch (err) {
        showToast(`Error: ${err.message || err}`);
    } finally {
        downloadAttachmentsBtn.disabled = false;
        downloadAttachmentsBtn.textContent = originalText;
    }
}

async function redownloadAttachment(attachmentId) {
    try {
        const response = await fetch(`${API_BASE}/attachments/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [attachmentId] }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.downloaded > 0) {
            showToast('Archivo re-descargado exitosamente');
        } else {
            showToast('Error: No se pudo descargar el archivo');
        }
        loadStats().catch(() => {});
    } catch (err) {
        showToast(`Error al re-descargar: ${err.message || err}`);
    }
}


function showLoading(visible) {
    const loadingState = document.getElementById('loading-state');
    if (!loadingState) return;
    loadingState.style.display = visible ? 'flex' : 'none';
}

function showLoadingSkeleton(visible) {
    const skeletonId = 'initial-messages-skeleton';
    if (!visible) {
        const existing = document.getElementById(skeletonId);
        if (existing && existing.parentElement === messagesEl) {
            existing.remove();
        }
        return;
    }

    const skeleton = document.createElement('div');
    skeleton.id = skeletonId;
    skeleton.style.display = 'flex';
    skeleton.style.flexDirection = 'column';
    skeleton.style.gap = '10px';

    for (let i = 0; i < 6; i++) {
        const msg = document.createElement('div');
        msg.className = 'message';
        msg.style.opacity = '0.3';
        msg.style.width = '80%';
        msg.style.marginBottom = '10px';
        msg.style.pointerEvents = 'none';
        msg.style.gap = '2px';

        const header = document.createElement('div');
        header.className = 'message-header';

        const sender = document.createElement('span');
        sender.className = 'sender-name';
        sender.style.background = '#575757';
        sender.style.color = 'transparent';
        sender.style.borderRadius = '4px';
        sender.style.height = '0.87rem';
        sender.style.display = 'inline-block';
        sender.style.minWidth = '5rem';

        const time = document.createElement('span');
        time.className = 'message-time';
        time.style.background = '#5757579a';
        time.style.color = 'transparent';
        time.style.borderRadius = '4px';
        time.style.height = '0.65rem';
        time.style.display = 'inline-block';
        time.style.minWidth = '3rem';

        header.appendChild(sender);
        header.appendChild(time);

        const body = document.createElement('div');
        body.className = 'message-body';
        body.style.background = '#575757';
        body.style.color = 'transparent';
        body.style.borderRadius = '4px';
        body.style.height = '2rem';
        body.textContent = 'Loading';

        msg.appendChild(header);
        msg.appendChild(body);
        skeleton.appendChild(msg);
    }

    messagesEl.appendChild(skeleton);
}



//  Activar una vista (canal o DM) 
function activateView(type, id, name) {
    document.querySelector('.nav-item.active')?.classList.remove('active');

    const selector = type === 'channel'
        ? `[data-type="channel"][data-id="${CSS.escape(id)}"]`
        : `[data-type="dm"][data-id="${CSS.escape(id)}"]`;
    document.querySelector(selector)?.classList.add('active');

    state.view = { type, id, name };
    state.loadedMessages = 0;
    state.loadedMessagesList = [];
    state.hasMoreMessages = true;
    state.isLoadingMessages = false;

    // Persist the active view so it survives page reloads
    localStorage.setItem('flock_archive_last_view', JSON.stringify({ type, id, name }));

    titleEl.textContent = name;
    viewIconEl.textContent = type === 'channel' ? '#' : '●';
    footerChannelEl.textContent = (type === 'channel' ? '#' : '') + name;
    searchInput.placeholder = `Buscar mensajes`;

    loadMessages();
}

//  Crear ítem de nav 
function buildNavItem(type, item) {
    const li = document.createElement('li');
    li.className = 'nav-item';
    li.dataset.type = type;
    li.dataset.id   = item.id;

    if (type === 'channel') {
        const count = item._count?.messages ?? '';
        li.innerHTML = `<span class="nav-prefix">#</span>${escHtml(item.name)}<span class="nav-count">${count}</span>`;
        li.addEventListener('click', () => activateView('channel', item.id, item.name));
    } else {
        const count = item._count?.messages ?? '';
        li.innerHTML = `<span class="nav-prefix">●</span>${escHtml(item.name)}<span class="nav-count">${count}</span>`;
        li.addEventListener('click', () => activateView('dm', item.id, item.name));
    }

    return li;
}

//  Renderizar sidebar filtrado 
function renderSidebarList(listEl, showMoreBtn, showMoreLabelEl, showMoreArrowEl, type, items, expanded, query) {
    listEl.innerHTML = '';

    const filtered = query
        ? items.filter(i => i.name.toLowerCase().includes(query.toLowerCase()))
        : items;

    if (!filtered.length) {
        const li = document.createElement('li');
        li.className = 'nav-item';
        li.style.cssText = 'color:var(--text-muted);font-size:.8rem;padding-left:16px;pointer-events:none';
        li.textContent = 'Sin resultados';
        listEl.appendChild(li);
        showMoreBtn.style.display = 'none';
        return;
    }

    const limit = state.SIDEBAR_LIMIT;
    const showAll = expanded || query; // si hay búsqueda, mostrar todo
    const visible = showAll ? filtered : filtered.slice(0, limit);

    for (const item of visible) {
        listEl.appendChild(buildNavItem(type, item));
    }

    // Botón "ver más / ver menos"
    if (!query && filtered.length > limit) {
        showMoreBtn.style.display = 'flex';
        const remaining = filtered.length - limit;
        if (expanded) {
            showMoreLabelEl.textContent = 'Ver menos';
            showMoreArrowEl.textContent = '▴';
        } else {
            showMoreLabelEl.textContent = `Ver más (${remaining})`;
            showMoreArrowEl.textContent = '▾';
        }
    } else {
        showMoreBtn.style.display = 'none';
    }
}

function refreshSidebar() {
    const q = sidebarSearch.value.trim();

    renderSidebarList(
        channelsList,
        channelsShowMore,
        document.getElementById('channels-show-more-label'),
        document.getElementById('channels-show-more-arrow'),
        'channel',
        state.allChannels,
        state.channelsExpanded,
        q
    );

    renderSidebarList(
        dmsList,
        dmsShowMore,
        document.getElementById('dms-show-more-label'),
        document.getElementById('dms-show-more-arrow'),
        'dm',
        state.allUsers,
        state.dmsExpanded,
        q
    );

    // Re-marcar activo
    if (state.view) {
        const selector = `[data-type="${state.view.type}"][data-id="${CSS.escape(state.view.id)}"]`;
        document.querySelector(selector)?.classList.add('active');
    }
}

// ─── Botones show-more ─────────────────────────────────────────
channelsShowMore.addEventListener('click', () => {
    state.channelsExpanded = !state.channelsExpanded;
    refreshSidebar();
});

dmsShowMore.addEventListener('click', () => {
    state.dmsExpanded = !state.dmsExpanded;
    refreshSidebar();
});

// ─── Buscador de sidebar con debounce ─────────────────────────
sidebarSearch.addEventListener('input', () => {
    clearTimeout(state.sidebarSearchTimer);
    state.sidebarSearchTimer = setTimeout(() => refreshSidebar(), 200);
});

// ─── Cargar canales ───────────────────────────────────────────
async function loadChannels() {
    try {
        const channels = await apiFetch('/channels');

        channels.sort((a, b) => {
            const countA = a._count?.messages || 0;
            const countB = b._count?.messages || 0;
            return countB - countA;
        });

        state.allChannels = channels;
        channelsCount.textContent = channels.length ? `(${channels.length})` : '';

        if (!channels.length) {
            channelsList.innerHTML = '<li class="nav-item" style="color:var(--text-muted);font-size:.8rem;padding-left:16px">Sin canales</li>';
            return;
        }

        refreshSidebar();

        // Restore the last active view; fall back to first channel
        const savedView = JSON.parse(localStorage.getItem('flock_archive_last_view') || 'null');
        if (savedView) {
            const exists = savedView.type === 'channel'
                ? state.allChannels.find(c => c.id === savedView.id)
                : null; // DMs verified after loadUsers; still restore optimistically
            if (exists || savedView.type === 'dm') {
                activateView(savedView.type, savedView.id, savedView.name);
                return;
            }
        }
        // Default: first channel
        const first = channels[0];
        activateView('channel', first.id, first.name);

    } catch (err) {
        channelsList.innerHTML = '<li class="nav-item" style="color:var(--text-muted)">Error al cargar</li>';
        showToast(`Error al cargar canales: ${err.message}`);
    }
}

// ─── Cargar usuarios (DMs) 
async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE}/users`, {
            headers: {
                'Content-Type': 'application/json',
                'x-user-email': state.currentUser ? state.currentUser.email : ''
            }
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const users = await response.json();
        console.log('📋 Usuarios cargados con conteo:', users); // Debug
        
        users.sort((a, b) => {
            const countA = a._count?.messages || 0;
            const countB = b._count?.messages || 0;
            return countB - countA; // Mayor cantidad primero
        });

        state.allUsers = users;
        dmsCount.textContent = users.length ? `(${users.length})` : '';
        
        if (!users.length) {
            dmsList.innerHTML = '<li class="nav-item" style="color:var(--text-muted);font-size:.8rem;padding-left:16px">Sin usuarios</li>';
            return;
        }
        
        refreshSidebar();
        
    } catch (err) {
        console.error('Error loading users:', err);
        dmsList.innerHTML = '<li class="nav-item" style="color:var(--text-muted)">Error al cargar</li>';
        showToast(`Error al cargar usuarios: ${err.message}`);
    }
}

async function loadStats() {
    try {
        // Lanzamos ambas llamadas en paralelo
        const [s, realSize] = await Promise.allSettled([
            apiFetch('/stats'),
            apiFetch('/attachments/real-size'),
        ]);

        if (s.status === 'rejected') throw s.reason;
        const stats = s.value;

        statMessages.textContent    = `${stats.totalMessages.toLocaleString('es-AR')} msgs`;
        statAttachments.textContent = `${stats.totalAttachments.toLocaleString('es-AR')} adj`;

        // Preferimos el tamaño real; si falló, caemos al valor de la DB
        const sizeBytes = realSize.status === 'fulfilled'
            ? Number(realSize.value.totalBytes)
            : Number(stats.totalAttachmentBytes || 0);

        statAttachmentSize.textContent = formatBytes(sizeBytes);

        if (downloadAttachmentsBtn) downloadAttachmentsBtn.disabled = false;

    } catch (err) {
        console.warn('No se pudo cargar stats:', err);
        if (statAttachmentSize) statAttachmentSize.textContent = '—';
    }
}

//  Búsqueda de mensajes con debounce 
searchInput.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    const q = searchInput.value.trim();
    if (!q) { searchResults.style.display = 'none'; return; }
    state.searchTimer = setTimeout(() => doSearch(q), 380);
});

searchInput.addEventListener('blur', () => {
    setTimeout(() => { searchResults.style.display = 'none'; }, 200);
});

async function doSearch(q) {
    searchResults.innerHTML = '<div class="search-empty">Buscando…</div>';
    searchResults.style.display = 'block';

    try {
        const results = await apiFetch(`/messages/search?q=${encodeURIComponent(q)}`);

        if (!results.length) {
            searchResults.innerHTML = '<div class="search-empty">Sin resultados.</div>';
            return;
        }

        const highlighted = (text) => escHtml(text).replace(
            new RegExp(escHtml(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi'),
            m => `<mark>${m}</mark>`
        );

        const items = results.slice(0, 30).map(m => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.dataset.channel = m.channelId || '';
            div.dataset.user    = m.userId || '';
            div.innerHTML = `
                <div class="sri-header">
                    <span class="sri-sender">${escHtml(m.senderName)}</span>
                    <span class="sri-date">${escHtml(m.dateText)}</span>
                </div>
                <div class="sri-text">${highlighted(m.text)}</div>
            `;
            // Click en resultado navega a ese canal/DM
            div.addEventListener('mousedown', (e) => {
                e.preventDefault();
                searchResults.style.display = 'none';
                searchInput.value = '';
                if (m.channelId) {
                    const ch = state.allChannels.find(c => c.id === m.channelId);
                    if (ch) activateView('channel', ch.id, ch.name);
                } else if (m.userId) {
                    const u = state.allUsers.find(u => u.id === m.userId);
                    if (u) activateView('dm', u.id, u.name);
                }
            });
            return div;
        });

        searchResults.innerHTML = '';
        items.forEach(el => searchResults.appendChild(el));

    } catch (err) {
        searchResults.innerHTML = `<div class="search-empty">Error: ${err.message}</div>`;
    }
}
// ─── Login: flujo de dos pasos (email → OTP) ─────────────────
// Estado interno del login modal
const loginState = { step: 'email', pendingEmail: '' };

function setLoginStep(step) {
    loginState.step = step;
    const emailStep  = document.getElementById('login-step-email');
    const codeStep   = document.getElementById('login-step-code');
    const pendingEl  = document.getElementById('login-pending-email');
    loginError.style.display = 'none';
    if (step === 'email') {
        emailStep.style.display = 'block';
        codeStep.style.display  = 'none';
        loginEmail.value = '';
    } else {
        emailStep.style.display = 'none';
        codeStep.style.display  = 'block';
        if (pendingEl) pendingEl.textContent = loginState.pendingEmail;
        document.getElementById('login-code').value = '';
        document.getElementById('login-code').focus();
    }
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';

    // ── Paso 1: enviar email, pedir código ──
    if (loginState.step === 'email') {
        const email = loginEmail.value.trim();
        if (!email) return;

        const submitBtn = loginForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando…';

        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            // Siempre avanzamos al paso 2 (no revelamos si el email existe)
            loginState.pendingEmail = email;
            setLoginStep('code');
        } catch (err) {
            loginError.textContent = 'No se pudo conectar con el servidor.';
            loginError.style.display = 'block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Ingresar';
        }
        return;
    }

    // ── Paso 2: verificar código OTP ──
    if (loginState.step === 'code') {
        const code = document.getElementById('login-code').value.trim();
        if (!code) return;

        const submitBtn = loginForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verificando…';

        try {
            const res = await fetch(`${API_BASE}/auth/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: loginState.pendingEmail, code })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Código inválido');
            }

            const { user } = await res.json();

            // Almacenar sesión y actualizar estado global
            localStorage.setItem('flock_archive_session', JSON.stringify(user));
            state.currentUser = user;

            // Ocultar login, resetear modal para la próxima vez
            loginOverlay.style.display = 'none';
            setLoginStep('email');
            updateUserProfileUI();

            await loadChannels();
            loadUsers().catch(err => console.warn('Error loading users:', err));
            loadStats().catch(err => console.warn('Error loading stats:', err));

            showToast(`Bienvenido de vuelta, ${user.name}`);

        } catch (err) {
            loginError.textContent = err.message;
            loginError.style.display = 'block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Ingresar';
        }
        return;
    }
});

// Botón "Cambiar email" en el paso del código
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'login-back-btn') {
        setLoginStep('email');
    }
});

// Configurar el botón de Logout (Cerrar Sesión)
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('flock_archive_session');
    localStorage.removeItem('flock_archive_last_view');
    state.currentUser = null;
    
    // Limpiar pantalla vieja
    messagesEl.innerHTML = '';
    titleEl.textContent = 'Inicie sesión';
    
    // Resetear listas de canales en el HTML para que no se queden congeladas
    channelsList.innerHTML = '';
    dmsList.innerHTML = '';
    
    // Mostrar el modal de login nuevamente
    loginOverlay.style.display = 'flex';
    loginEmail.value = '';
    
    showToast('Sesión cerrada');
});

//  Infinite scroll hacia arriba para mensajes antiguos
messagesEl.addEventListener('scroll', () => {
    if (!state.view || state.isLoadingMessages || !state.hasMoreMessages) return;
    if (messagesEl.scrollTop > 120) return;

    loadMessages();
});

//  Init  
(async () => {
    if (!state.currentUser) {
        // Si no hay sesión activa, forzamos mostrar el modal de Login
        loginOverlay.style.display = 'flex';
    } else {
        // Si hay sesión activa, ocultamos el login por si acaso, pintamos el usuario y cargamos
        loginOverlay.style.display = 'none';
        updateUserProfileUI();
        try {
            await loadChannels();

            // Si no hay vista activa, cargamos el primer canal por defecto
            if (!state.view && state.allChannels && state.allChannels.length > 0) {
                const firstChannel = state.allChannels[0];
                activateView('channel', firstChannel.id, firstChannel.name);
            }

            loadUsers().catch(err => console.warn('Error loading users:', err));
            loadStats().catch(err => console.warn('Error loading stats:', err));
        } catch (error) {
            console.error("Error en la inicialización:", error);
        }
    }
})();