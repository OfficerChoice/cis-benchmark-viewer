/**
 * CIS Benchmark Viewer — app.js
 * Loads data/benchmarks.json and drives all UI interactions
 */

// ── State ──────────────────────────────────────────────
const state = {
  allBenchmarks: [],   // raw data from JSON
  allControls:   [],   // flat list with benchmark reference
  filtered:      [],   // currently displayed
  activeBenchmark: "all",
  activeLevel:   "all",
  activeAssessment: "all",
  searchQuery:   "",
  sortBy:        "id",
  viewMode:      "grid",  // grid | list
  page:          1,
  perPage:       24,
  openControl:   null,
  activeTab:     "overview",
};

// ── Bootstrap ──────────────────────────────────────────
async function loadData() {
  document.getElementById("loadingState").classList.remove("hidden");
  document.getElementById("errorState").classList.add("hidden");
  document.getElementById("controlsArea").style.display = "none";

  try {
    const resp = await fetch("data/benchmarks.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    initApp(data);
  } catch (err) {
    document.getElementById("loadingState").classList.add("hidden");
    document.getElementById("errorState").classList.remove("hidden");
    document.getElementById("errorMsg").textContent =
      `Error: ${err.message}. Make sure parser.py was run first.`;
  }
}

function initApp(benchmarks) {
  state.allBenchmarks = benchmarks;

  // Flatten controls with benchmark info
  state.allControls = [];
  for (const bm of benchmarks) {
    for (const ctrl of bm.controls) {
      state.allControls.push({ ...ctrl, _benchmark: bm.benchmark });
    }
  }

  // Update stats
  document.getElementById("statBenchmarks").textContent = benchmarks.length;
  document.getElementById("statControls").textContent   = state.allControls.length.toLocaleString();

  // Build sidebar nav
  buildBenchmarkNav(benchmarks);

  // Initial render
  applyFilters();

  document.getElementById("loadingState").classList.add("hidden");
  document.getElementById("controlsArea").style.display = "";
}

// ── Sidebar Nav ────────────────────────────────────────
function buildBenchmarkNav(benchmarks) {
  const nav = document.getElementById("benchmarkNav");
  nav.innerHTML = "";

  // "All" item
  const allBtn = navItem("all", "All Benchmarks", state.allControls.length);
  nav.appendChild(allBtn);

  for (const bm of benchmarks) {
    const btn = navItem(bm.benchmark.pdf_path, bm.benchmark.title, bm.controls.length);
    nav.appendChild(btn);
  }
}

function navItem(key, label, count) {
  const btn = document.createElement("button");
  btn.className = `nav-item ${state.activeBenchmark === key ? "active" : ""}`;
  btn.dataset.key = key;

  const shortLabel = label.replace(/^CIS\s+/i, "").replace(/\s+Benchmark\b.*/i, "").trim();
  btn.innerHTML = `
    <span class="nav-dot"></span>
    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${label}">${shortLabel}</span>
    <span class="nav-count">${count}</span>
  `;
  btn.addEventListener("click", () => {
    state.activeBenchmark = key;
    state.page = 1;
    document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.key === key));
    applyFilters();
    // Auto-close sidebar on mobile
    if (window.innerWidth < 900) document.getElementById("sidebar").classList.remove("open");
  });
  return btn;
}

// ── Filtering & Sorting ────────────────────────────────
function applyFilters() {
  let list = [...state.allControls];

  // Benchmark filter
  if (state.activeBenchmark !== "all") {
    list = list.filter(c => c._benchmark.pdf_path === state.activeBenchmark);
  }

  // Level filter
  if (state.activeLevel !== "all") {
    list = list.filter(c =>
      c.levels && c.levels.some(l => l.toLowerCase().includes(`level ${state.activeLevel}`))
    );
  }

  // Assessment filter
  if (state.activeAssessment !== "all") {
    list = list.filter(c => c.assessment === state.activeAssessment);
  }

  // Search
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(c =>
      c.title.toLowerCase().includes(q)       ||
      c.control_id.toLowerCase().includes(q)  ||
      c.description.toLowerCase().includes(q) ||
      c.audit.toLowerCase().includes(q)       ||
      c.remediation.toLowerCase().includes(q)
    );
  }

  // Sort
  list.sort((a, b) => {
    switch (state.sortBy) {
      case "id":
        return compareCtrlId(a.control_id, b.control_id);
      case "title":
        return a.title.localeCompare(b.title);
      case "level":
        return levelNum(a) - levelNum(b);
      case "assessment":
        return a.assessment.localeCompare(b.assessment);
      default: return 0;
    }
  });

  state.filtered = list;
  state.page = Math.min(state.page, Math.ceil(list.length / state.perPage) || 1);

  renderSection();
  renderGrid();
  renderPagination();
  document.getElementById("searchCount").textContent =
    state.searchQuery ? `${list.length} result${list.length !== 1 ? "s" : ""}` : "";
}

function compareCtrlId(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function levelNum(ctrl) {
  const l = ctrl.levels && ctrl.levels[0] || "";
  const m = l.match(/\d+/);
  return m ? parseInt(m[0]) : 99;
}

// ── Section Header ─────────────────────────────────────
function renderSection() {
  const bm = state.allBenchmarks.find(b => b.benchmark.pdf_path === state.activeBenchmark);
  const title = bm ? bm.benchmark.title.replace(/^CIS\s+/i, "") : "All Controls";
  const sub = `${state.filtered.length} control${state.filtered.length !== 1 ? "s" : ""} ${state.searchQuery ? "matching" : ""}`;
  document.getElementById("sectionTitle").textContent = title;
  document.getElementById("sectionSubtitle").textContent = sub;
}

// ── Grid Render ────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById("controlsGrid");
  const empty = document.getElementById("emptyState");

  if (state.filtered.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const start = (state.page - 1) * state.perPage;
  const page  = state.filtered.slice(start, start + state.perPage);

  grid.innerHTML = page.map((ctrl, idx) => cardHTML(ctrl, idx)).join("");

  // Staggered animation
  grid.querySelectorAll(".control-card").forEach((card, i) => {
    card.style.animationDelay = `${i * 25}ms`;
    card.addEventListener("click", () => openModal(ctrl_by_idx(start + i)));
  });
}

function ctrl_by_idx(idx) {
  return state.filtered[idx];
}

function cardHTML(ctrl, idx) {
  const assessClass = assessBadgeClass(ctrl.assessment);
  const levelBadges = (ctrl.levels || []).slice(0, 2).map(l => {
    const n = l.match(/\d+/)?.[0];
    return `<span class="badge badge-level${n || ''}">${l.replace(/ - .+/, "")}</span>`;
  }).join("");

  const q = state.searchQuery.toLowerCase();
  let title = escHtml(ctrl.title);
  let desc  = escHtml(ctrl.description?.slice(0, 200) || "No description available.");
  if (q) {
    title = highlight(title, q);
    desc  = highlight(desc, q);
  }

  return `
    <div class="control-card" data-idx="${idx}">
      <div class="card-top">
        <span class="card-id">${escHtml(ctrl.control_id)}</span>
        <div class="card-badges">
          <span class="badge ${assessClass}">${ctrl.assessment}</span>
          ${levelBadges}
        </div>
      </div>
      <div class="card-title">${title}</div>
      <div class="card-desc">${desc}</div>
      <div class="card-footer">
        <span class="card-tech">${escHtml(ctrl._benchmark?.technology || "")}</span>
        <span class="card-arrow">→</span>
      </div>
    </div>
  `;
}

function assessBadgeClass(assessment) {
  switch (assessment) {
    case "Automated": return "badge-automated";
    case "Manual":    return "badge-manual";
    default:          return "badge-scored";
  }
}

// ── Pagination ─────────────────────────────────────────
function renderPagination() {
  const total = Math.ceil(state.filtered.length / state.perPage);
  const pg = document.getElementById("pagination");
  if (total <= 1) { pg.innerHTML = ""; return; }

  const p = state.page;
  const pages = [];

  // Always show first, last, current±1
  const visible = new Set([1, total, p, p - 1, p + 1].filter(n => n >= 1 && n <= total));
  const sorted = [...visible].sort((a, b) => a - b);

  let prev = 0;
  const html = [];
  html.push(`<button class="page-btn" ${p === 1 ? "disabled" : ""} data-page="${p - 1}">‹</button>`);
  for (const n of sorted) {
    if (n - prev > 1) html.push(`<span style="color:var(--text-dim);padding:0 4px">…</span>`);
    html.push(`<button class="page-btn ${n === p ? "active" : ""}" data-page="${n}">${n}</button>`);
    prev = n;
  }
  html.push(`<button class="page-btn" ${p === total ? "disabled" : ""} data-page="${p + 1}">›</button>`);
  pg.innerHTML = html.join("");

  pg.querySelectorAll(".page-btn[data-page]").forEach(btn => {
    if (!btn.disabled) {
      btn.addEventListener("click", () => {
        state.page = parseInt(btn.dataset.page);
        renderGrid();
        renderPagination();
        document.querySelector(".controls-area").scrollIntoView({ behavior: "smooth" });
      });
    }
  });
}

// ── Modal ──────────────────────────────────────────────
function openModal(ctrl) {
  state.openControl = ctrl;
  state.activeTab   = "overview";

  document.getElementById("modalId").textContent      = ctrl.control_id;
  document.getElementById("modalTitle").textContent   = ctrl.title;
  document.getElementById("modalBenchmark").textContent = ctrl._benchmark?.title || "";
  document.getElementById("modalAssessment").className = `badge ${assessBadgeClass(ctrl.assessment)}`;
  document.getElementById("modalAssessment").textContent = ctrl.assessment;

  const level = ctrl.levels?.[0] || "";
  const ln = level.match(/\d+/)?.[0];
  const lvlEl = document.getElementById("modalLevel");
  lvlEl.className = `badge badge-level${ln || ""}`;
  lvlEl.textContent = level.replace(/ - .+/, "") || "";
  lvlEl.style.display = level ? "" : "none";

  // Overview
  setField("modalDescription", ctrl.description);
  setField("modalRationale",   ctrl.rationale,   "fgRationale");
  setField("modalImpact",      ctrl.impact,       "fgImpact");
  setField("modalReferences",  ctrl.references,   "fgReferences");

  // Audit / Remediation
  document.getElementById("modalAudit").textContent       = ctrl.audit        || "No audit steps provided.";
  document.getElementById("modalRemediation").textContent = ctrl.remediation  || "No remediation steps provided.";

  // CIS Mappings
  renderMappings(ctrl.cis_controls || []);

  // Activate overview tab
  switchTab("overview");

  document.getElementById("modalBackdrop").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function setField(fieldId, val, groupId) {
  const el = document.getElementById(fieldId);
  el.textContent = val || "Not specified.";
  if (groupId) {
    document.getElementById(groupId).style.display = val ? "" : "none";
  }
}

function renderMappings(mappings) {
  const el = document.getElementById("modalMappings");
  if (!mappings.length) {
    el.innerHTML = `<p class="no-mappings">No CIS Controls mappings available.</p>`;
    return;
  }
  el.innerHTML = `
    <table class="mappings-table">
      <thead>
        <tr>
          <th>Version</th>
          <th>Control</th>
          <th>Title</th>
          <th>IG1</th><th>IG2</th><th>IG3</th>
        </tr>
      </thead>
      <tbody>
        ${mappings.map(m => `
          <tr>
            <td><span class="ver-badge">${escHtml(m.version)}</span></td>
            <td><span class="ctrl-id-badge">${escHtml(m.control_id)}</span></td>
            <td style="font-size:0.78rem;line-height:1.4">${escHtml(m.title)}</td>
            <td><span class="ig-dot ${m.ig1 ? "ig-yes" : "ig-no"}"></span></td>
            <td><span class="ig-dot ${m.ig2 ? "ig-yes" : "ig-no"}"></span></td>
            <td><span class="ig-dot ${m.ig3 ? "ig-yes" : "ig-no"}"></span></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function closeModal() {
  document.getElementById("modalBackdrop").classList.add("hidden");
  document.body.style.overflow = "";
  state.openControl = null;
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("tab-active", b.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach(p => {
    p.classList.toggle("hidden", p.id !== `tab-${tab}`);
  });
}

// ── Export ─────────────────────────────────────────────
function exportCurrentView() {
  const data = state.filtered.map(({ _benchmark, ...c }) => ({ benchmark: _benchmark, ...c }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cis_controls_${state.activeBenchmark === "all" ? "all" : "filtered"}.json`;
  a.click();
}

// ── Helpers ────────────────────────────────────────────
function escHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function highlight(html, query) {
  if (!query) return html;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
}

// ── Event Listeners ────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

  // Search
  const searchInput = document.getElementById("searchInput");
  let searchTimeout;
  searchInput.addEventListener("input", e => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      state.page = 1;
      applyFilters();
    }, 220);
  });

  // Level chips
  document.getElementById("levelFilters").addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    document.querySelectorAll("#levelFilters .chip").forEach(c => c.classList.remove("chip-active"));
    chip.classList.add("chip-active");
    state.activeLevel = chip.dataset.level;
    state.page = 1;
    applyFilters();
  });

  // Assessment chips
  document.getElementById("assessmentFilters").addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    document.querySelectorAll("#assessmentFilters .chip").forEach(c => c.classList.remove("chip-active"));
    chip.classList.add("chip-active");
    state.activeAssessment = chip.dataset.assessment;
    state.page = 1;
    applyFilters();
  });

  // Sort
  document.getElementById("sortSelect").addEventListener("change", e => {
    state.sortBy = e.target.value;
    state.page = 1;
    applyFilters();
  });

  // View toggle
  document.getElementById("viewGrid").addEventListener("click", () => {
    state.viewMode = "grid";
    document.getElementById("controlsGrid").classList.remove("list-mode");
    document.getElementById("viewGrid").classList.add("view-btn-active");
    document.getElementById("viewList").classList.remove("view-btn-active");
  });
  document.getElementById("viewList").addEventListener("click", () => {
    state.viewMode = "list";
    document.getElementById("controlsGrid").classList.add("list-mode");
    document.getElementById("viewList").classList.add("view-btn-active");
    document.getElementById("viewGrid").classList.remove("view-btn-active");
  });

  // Export
  document.getElementById("exportBtn").addEventListener("click", exportCurrentView);

  // Modal close
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("modalBackdrop").addEventListener("click", e => {
    if (e.target === document.getElementById("modalBackdrop")) closeModal();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
    if (e.key === "/") { e.preventDefault(); searchInput.focus(); }
  });

  // Modal tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Sidebar toggle
  document.getElementById("menuBtn").addEventListener("click", () => {
    document.getElementById("sidebar").classList.add("open");
  });
  document.getElementById("sidebarClose").addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("open");
  });

  // Load data
  loadData();
});
