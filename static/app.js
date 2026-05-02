// State
let currentPath        = "/";
let activeTab          = "myfiles";
let pendingDeleteDirId  = null;
let pendingDeleteFileId = null;
let pendingShareFileId  = null;
let pendingUploadFile   = null;

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    const email = window.USER_EMAIL || "";
    const name  = window.USER_NAME  || email;

    document.getElementById("user-email-display").textContent = email;

    const initials = name.split(/\s+/).filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 2)
                  || email.slice(0, 2).toUpperCase();
    document.getElementById("user-avatar").textContent = initials;

    setupDragDrop();
    loadDirectory("/");

    document.addEventListener("click", (e) => {
        if (!e.target.closest(".card-menu-btn") && !e.target.closest(".card-dropdown")) {
            closeAllDropdowns();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            document.querySelectorAll(".modal-backdrop").forEach(m => m.style.display = "none");
        }
        if (e.key === "Enter") {
            if (isVisible("modal-new-folder"))  createFolder();
            if (isVisible("modal-share"))       confirmShare();
        }
    });
});

function isVisible(id) {
    const el = document.getElementById(id);
    return el && el.style.display !== "none";
}

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab) {
    activeTab = tab;

    document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
    document.querySelector(`[data-tab="${tab}"]`).classList.add("active");

    document.getElementById("panel-myfiles").style.display    = tab === "myfiles"    ? "" : "none";
    document.getElementById("panel-shared").style.display     = tab === "shared"     ? "" : "none";
    document.getElementById("panel-duplicates").style.display = tab === "duplicates" ? "" : "none";

    const bc      = document.getElementById("breadcrumb");
    const actions = document.getElementById("topbar-actions");
    const title   = document.getElementById("page-title");

    if (tab === "myfiles") {
        bc.style.display      = "";
        actions.style.display = "";
        title.style.display   = "none";
    } else {
        bc.style.display      = "none";
        actions.style.display = "none";
        title.style.display   = "";
        title.textContent     = tab === "shared" ? "Shared With Me" : "Duplicate Files";
    }

    if (tab === "shared")     loadSharedFiles();
    if (tab === "duplicates") loadDuplicates();
}

// ── Directory listing ──────────────────────────────────────────────────────
async function loadDirectory(path) {
    currentPath = path;
    const res  = await fetch(`/api/directory/list?path=${encodeURIComponent(path)}`);
    if (res.status === 401) { window.location.href = "/login"; return; }
    const data = await res.json();
    renderBreadcrumb(data.path);
    renderFolders(data.directories, data.parent_path);
    renderFiles(data.files);
}

function renderBreadcrumb(path) {
    const bc    = document.getElementById("breadcrumb");
    const segs  = path === "/" ? [] : path.split("/").filter(Boolean);
    let built   = "/";
    let html    = `<a href="#" onclick="loadDirectory('/'); return false;">/</a>`;

    segs.forEach((seg, i) => {
        built += seg + "/";
        const p = built;
        if (i < segs.length - 1) {
            html += `<span class="sep"> &gt; </span><a href="#" onclick="loadDirectory('${p}'); return false;">${seg}</a>`;
        } else {
            html += `<span class="sep"> &gt; </span><span class="bc-current">${seg}</span>`;
        }
    });

    bc.innerHTML = html;
}

function renderFolders(dirs, parentPath) {
    const grid    = document.getElementById("folders-grid");
    const section = document.getElementById("folders-section");
    let html      = "";

    if (parentPath) {
        html += `
        <div class="card" onclick="loadDirectory('${parentPath}')">
            <div class="card-icon">${iconFolder()}</div>
            <div class="card-name">..</div>
            <div class="card-meta">Go up</div>
        </div>`;
    }

    dirs.forEach(d => {
        const safeName = escHtml(d.name);
        html += `
        <div class="card" onclick="loadDirectory('${d.path}')">
            <div class="card-icon">${iconFolder()}</div>
            <div class="card-name" title="${safeName}">${safeName}</div>
            <button class="card-menu-btn" onclick="toggleDropdown(event,'dd-dir-${d._id}')">&#8942;</button>
            <div class="card-dropdown" id="dd-dir-${d._id}">
                <button onclick="loadDirectory('${d.path}'); closeAllDropdowns()">Open</button>
                <button class="danger" onclick="openDeleteDirModal('${d._id}','${escAttr(d.name)}'); closeAllDropdowns()">Delete</button>
            </div>
        </div>`;
    });

    grid.innerHTML = html;
    section.style.display = (dirs.length === 0 && !parentPath) ? "none" : "";
}

function renderFiles(files) {
    const grid    = document.getElementById("files-grid");
    const section = document.getElementById("files-section");
    const empty   = document.getElementById("empty-state");

    let html = "";
    files.forEach(f => {
        const dup      = f.is_duplicate;
        const badge    = dup ? `<span class="duplicate-badge">Duplicate</span>` : "";
        const cardCls  = dup ? "card duplicate" : "card";
        const safeName = escHtml(f.name);
        const meta     = `${fmtSize(f.size)} &bull; ${fmtDate(f.created_at)}`;

        html += `
        <div class="${cardCls}">
            ${badge}
            <div class="card-icon">${iconFile(f.name)}</div>
            <div class="card-name" title="${safeName}">${safeName}</div>
            <div class="card-meta">${meta}</div>
            <button class="card-menu-btn" onclick="toggleDropdown(event,'dd-file-${f._id}')">&#8942;</button>
            <div class="card-dropdown" id="dd-file-${f._id}">
                <button onclick="downloadFile('${f._id}','${escAttr(f.name)}'); closeAllDropdowns()">Download</button>
                <button onclick="openShareModal('${f._id}'); closeAllDropdowns()">Share</button>
                <button class="danger" onclick="openDeleteFileModal('${f._id}','${escAttr(f.name)}'); closeAllDropdowns()">Delete</button>
            </div>
        </div>`;
    });

    grid.innerHTML = html;

    const hasContent = files.length > 0
        || document.querySelectorAll("#folders-grid .card").length > 0;

    section.style.display = files.length > 0 ? "" : "none";
    empty.style.display   = hasContent ? "none" : "";
}

// ── New folder ─────────────────────────────────────────────────────────────
function openNewFolderModal() {
    document.getElementById("new-folder-name").value = "";
    document.getElementById("modal-new-folder").style.display = "flex";
    setTimeout(() => document.getElementById("new-folder-name").focus(), 50);
}

async function createFolder() {
    const name = document.getElementById("new-folder-name").value.trim();
    if (!name) return;

    const res  = await fetch("/api/directory/create", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name, parent_path: currentPath }),
    });
    const data = await res.json();

    if (res.ok) {
        closeModal("modal-new-folder");
        loadDirectory(currentPath);
    } else {
        alert(data.detail || "Failed to create folder");
    }
}

// ── Delete directory ───────────────────────────────────────────────────────
function openDeleteDirModal(id, name) {
    pendingDeleteDirId = id;
    document.getElementById("delete-dir-name").textContent = name;
    document.getElementById("modal-delete-dir").style.display = "flex";
}

async function confirmDeleteDir() {
    if (!pendingDeleteDirId) return;
    const res  = await fetch(`/api/directory/${pendingDeleteDirId}`, { method: "DELETE" });
    const data = await res.json();
    closeModal("modal-delete-dir");
    if (res.ok) {
        loadDirectory(currentPath);
    } else {
        alert(data.detail || "Cannot delete folder");
    }
    pendingDeleteDirId = null;
}

// ── File upload ────────────────────────────────────────────────────────────
function handleFileSelect(input) {
    if (!input.files.length) return;
    uploadFile(input.files[0], false);
    input.value = "";
}

async function uploadFile(file, overwrite) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("directory_path", currentPath);
    fd.append("overwrite", overwrite ? "true" : "false");

    const res  = await fetch("/api/file/upload", { method: "POST", body: fd });
    const data = await res.json();

    if (res.status === 409) {
        pendingUploadFile = file;
        document.getElementById("overwrite-filename").textContent = file.name;
        document.getElementById("modal-overwrite").style.display = "flex";
    } else if (res.ok) {
        loadDirectory(currentPath);
    } else {
        alert(data.detail || "Upload failed");
    }
}

async function confirmOverwrite() {
    if (!pendingUploadFile) return;
    closeModal("modal-overwrite");
    await uploadFile(pendingUploadFile, true);
    pendingUploadFile = null;
}

// ── File download ──────────────────────────────────────────────────────────
function downloadFile(id, name) {
    const a = document.createElement("a");
    a.href     = `/api/file/download/${id}`;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// ── Delete file ────────────────────────────────────────────────────────────
function openDeleteFileModal(id, name) {
    pendingDeleteFileId = id;
    document.getElementById("delete-file-name").textContent = name;
    document.getElementById("modal-delete-file").style.display = "flex";
}

async function confirmDeleteFile() {
    if (!pendingDeleteFileId) return;
    const res  = await fetch(`/api/file/${pendingDeleteFileId}`, { method: "DELETE" });
    const data = await res.json();
    closeModal("modal-delete-file");
    if (!res.ok) alert(data.detail || "Delete failed");
    loadDirectory(currentPath);
    pendingDeleteFileId = null;
}

// ── Share file ─────────────────────────────────────────────────────────────
function openShareModal(id) {
    pendingShareFileId = id;
    document.getElementById("share-email").value   = "";
    document.getElementById("share-feedback").style.display = "none";
    document.getElementById("modal-share").style.display   = "flex";
    setTimeout(() => document.getElementById("share-email").focus(), 50);
}

async function confirmShare() {
    if (!pendingShareFileId) return;
    const email = document.getElementById("share-email").value.trim();
    if (!email) return;

    const res  = await fetch(`/api/file/${pendingShareFileId}/share`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email }),
    });
    const data = await res.json();
    const fb   = document.getElementById("share-feedback");
    fb.style.display = "";

    if (res.ok) {
        fb.className   = "share-success";
        fb.textContent = `Shared with ${email}`;
        setTimeout(() => closeModal("modal-share"), 1500);
    } else {
        fb.className   = "share-error";
        fb.textContent = data.detail || "Share failed";
    }
}

// ── Shared With Me ─────────────────────────────────────────────────────────
async function loadSharedFiles() {
    const res  = await fetch("/api/shared-with-me");
    const data = await res.json();
    const grid  = document.getElementById("shared-grid");
    const empty = document.getElementById("shared-empty");

    if (!data.files.length) {
        grid.innerHTML    = "";
        empty.style.display = "";
        return;
    }

    empty.style.display = "none";
    grid.innerHTML = data.files.map(f => {
        const safeName = escHtml(f.name);
        return `
        <div class="card">
            <div class="card-icon">${iconFile(f.name)}</div>
            <div class="card-name" title="${safeName}">${safeName}</div>
            <div class="card-meta">${fmtSize(f.size)}</div>
            <div class="card-shared-by">Shared by ${escHtml(f.owner_email)}</div>
            <button class="card-menu-btn" onclick="toggleDropdown(event,'dd-sh-${f._id}')">&#8942;</button>
            <div class="card-dropdown" id="dd-sh-${f._id}">
                <button onclick="downloadFile('${f._id}','${escAttr(f.name)}'); closeAllDropdowns()">Download</button>
            </div>
        </div>`;
    }).join("");
}

// ── Duplicates ─────────────────────────────────────────────────────────────
async function loadDuplicates() {
    const res  = await fetch("/api/duplicates/all");
    const data = await res.json();
    const container = document.getElementById("duplicates-content");
    const empty     = document.getElementById("duplicates-empty");

    if (!data.duplicates.length) {
        container.innerHTML  = "";
        empty.style.display = "";
        return;
    }

    empty.style.display = "none";
    container.innerHTML = data.duplicates.map(group => {
        const cards = group.files.map(f => {
            const safeName = escHtml(f.name);
            return `
            <div class="card">
                <div class="card-icon">${iconFile(f.name)}</div>
                <div class="card-name" title="${safeName}">${safeName}</div>
                <div class="card-meta">${fmtSize(f.size)}</div>
                <div class="dup-path" title="${escHtml(f.directory_path)}">${escHtml(f.directory_path)}</div>
                <button class="card-menu-btn" onclick="toggleDropdown(event,'dd-dup-${f.id}')">&#8942;</button>
                <div class="card-dropdown" id="dd-dup-${f.id}">
                    <button onclick="downloadFile('${f.id}','${escAttr(f.name)}'); closeAllDropdowns()">Download</button>
                    <button class="danger" onclick="openDeleteFileModal('${f.id}','${escAttr(f.name)}'); closeAllDropdowns()">Delete</button>
                </div>
            </div>`;
        }).join("");
        return `
        <div class="dup-group">
            <span class="dup-group-badge">Duplicate group</span>
            <div class="grid">${cards}</div>
        </div>`;
    }).join("");
}

// ── Drag and drop ──────────────────────────────────────────────────────────
function setupDragDrop() {
    const content = document.getElementById("main-content");
    const overlay = document.createElement("div");
    overlay.className   = "drag-overlay";
    overlay.textContent = "Drop files to upload";
    content.appendChild(overlay);

    content.addEventListener("dragover", (e) => {
        if (activeTab !== "myfiles") return;
        e.preventDefault();
        overlay.classList.add("active");
    });
    content.addEventListener("dragleave", () => overlay.classList.remove("active"));
    content.addEventListener("drop", (e) => {
        e.preventDefault();
        overlay.classList.remove("active");
        if (activeTab !== "myfiles") return;
        [...e.dataTransfer.files].forEach(f => uploadFile(f, false));
    });
}

// ── Modal helpers ──────────────────────────────────────────────────────────
function closeModal(id) { document.getElementById(id).style.display = "none"; }

function toggleDropdown(e, id) {
    e.stopPropagation();
    const dd     = document.getElementById(id);
    const wasOpen = dd.classList.contains("open");
    closeAllDropdowns();
    if (!wasOpen) dd.classList.add("open");
}

function closeAllDropdowns() {
    document.querySelectorAll(".card-dropdown.open").forEach(d => d.classList.remove("open"));
}

// ── SVG icons ──────────────────────────────────────────────────────────────
function iconFolder() {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"
        stroke="#1976D2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>`;
}

function iconFile(name) {
    const ext = (name || "").split(".").pop().toLowerCase();
    let color  = "#9CA3AF";
    if (ext === "pdf")                                    color = "#DC2626";
    else if (["jpg","jpeg","png","gif","svg","webp"].includes(ext)) color = "#16A34A";
    else if (["doc","docx"].includes(ext))                color = "#2563EB";
    else if (["xls","xlsx","csv"].includes(ext))          color = "#16A34A";
    else if (["zip","tar","gz","rar"].includes(ext))      color = "#D97706";
    else if (["txt","md"].includes(ext))                  color = "#6B7280";

    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"
        stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
    </svg>`;
}

// ── Formatting ─────────────────────────────────────────────────────────────
function fmtSize(bytes) {
    if (bytes == null) return "";
    if (bytes < 1024)          return `${bytes} B`;
    if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escAttr(str) {
    return String(str).replace(/'/g, "\\'").replace(/"/g, "&quot;");
}
