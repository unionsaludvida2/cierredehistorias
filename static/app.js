// --- ESTADO GLOBAL DE LA APLICACIÓN ---
const OFFICIAL_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwJpBkulzQBZotwt3GmKIYe7zi95sCzjSdWikkho4gVdo5cePupMWiKtlPg2xjBomSO/exec";

const isLocalhost = window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "" ||
  window.location.protocol === "file:";

if (!isLocalhost) {
  document.addEventListener("DOMContentLoaded", () => {
    const btnSync = document.getElementById("btnManualSync");
    if (btnSync) btnSync.style.display = "none";
    const btnCfg = document.getElementById("btnConfig");
    if (btnCfg) btnCfg.style.display = "none";
  });
}

// --- CONTROL DE VERSIÓN Y FORZADO DE ACTUALIZACIÓN ---
const APP_CURRENT_VERSION = "20261027_V20_GRID_RESPONSIVE_FIX";

const ESTADOS_PHC_OFICIALES = [
  "En progreso",
  "Finalizada",
  "Inasistencia",
  "Pendiente",
  "Novedad",
  "Error de dato"
];

const NOTAS_POR_ESTADO_PHC = {
  "En progreso": [
    "Historia en progreso"
  ],
  "Finalizada": [
    "Historia ya cerrada en PHC",
    "Paciente atendido con otro código o por otro profesional"
  ],
  "Inasistencia": [
    "Paciente con marcación de inasistencia"
  ],
  "Pendiente": [
    "Paciente atendido pero historia no iniciada",
    "Historia pendiente por caída del sistema",
    "Paciente confirmado sin evidencia de historia ni notas aclaratorias"
  ],
  "Novedad": [
    "Novedad médica (incapacidad, calamidad, etc)",
    "Paciente reagendado"
  ],
  "Error de dato": [
    "Tipo de servicio siempre aparece como pendiente",
    "No se permite registrar el servicio por medio de PHC",
    "Otros tipos de errores (describir en observaciones el error)"
  ]
};

function onModalEstadoPHCChange(preselectedNota = "") {
  const selectPHC = document.getElementById("modalEstadoPHC");
  const selectNota = document.getElementById("modalNotaAclaratoria") || document.getElementById("modalEstado");
  if (!selectNota) return;

  const estado = selectPHC ? selectPHC.value.trim() : "";
  selectNota.innerHTML = "";

  if (!estado || !NOTAS_POR_ESTADO_PHC[estado]) {
    const defOpt = document.createElement("option");
    defOpt.value = "";
    defOpt.textContent = "-- Primero seleccione un Estado --";
    defOpt.selected = true;
    selectNota.appendChild(defOpt);
    selectNota.value = "";
    return;
  }

  const notas = NOTAS_POR_ESTADO_PHC[estado] || [];

  if (notas.length === 1) {
    const opt = document.createElement("option");
    opt.value = notas[0];
    opt.textContent = notas[0];
    opt.selected = true;
    selectNota.appendChild(opt);
    selectNota.value = notas[0];
  } else {
    const placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = "-- Seleccione una Nota aclaratoria --";
    selectNota.appendChild(placeholderOpt);

    notas.forEach(n => {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      selectNota.appendChild(opt);
    });

    if (preselectedNota && notas.includes(preselectedNota)) {
      selectNota.value = preselectedNota;
    } else {
      placeholderOpt.selected = true;
      selectNota.value = "";
    }
  }
}
window.onModalEstadoPHCChange = onModalEstadoPHCChange;

function enforceOfficialPHCSelectOptions() {
  const selectPHC = document.getElementById("modalEstadoPHC");
  if (!selectPHC) return;

  const currentOpts = Array.from(selectPHC.options).map(o => o.value).filter(v => v);
  const isMatch = currentOpts.length === ESTADOS_PHC_OFICIALES.length &&
    ESTADOS_PHC_OFICIALES.every(st => currentOpts.includes(st)) &&
    !currentOpts.includes("Bloqueada") &&
    !currentOpts.includes("Confirmada") &&
    !currentOpts.includes("Atendido en IPSA / Finalizada");

  if (!isMatch) {
    selectPHC.innerHTML = `
      <option value="" selected>-- Seleccione estado actual en PHC --</option>
      <option value="En progreso">En progreso</option>
      <option value="Finalizada">Finalizada</option>
      <option value="Inasistencia">Inasistencia</option>
      <option value="Pendiente">Pendiente</option>
      <option value="Novedad">Novedad</option>
      <option value="Error de dato">Error de dato</option>
    `;
  }
  selectPHC.onchange = () => onModalEstadoPHCChange();
}

let versionPromptDismissedFor = null;
try {
  versionPromptDismissedFor = sessionStorage.getItem("versionPromptDismissedFor") || localStorage.getItem("versionPromptDismissedFor");
} catch (e) { }

async function checkAppVersionFreshness() {
  try {
    // Si el usuario está auditando o interactuando con el modal, no interrumpir
    const fbModal = document.getElementById("feedbackModal");
    if (fbModal && fbModal.classList.contains("open")) return;

    const res = await fetch(`./static/version.json?_t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const currentDismissed = sessionStorage.getItem("versionPromptDismissedFor") || localStorage.getItem("versionPromptDismissedFor") || versionPromptDismissedFor;
      if (data && data.version && data.version !== APP_CURRENT_VERSION && data.version !== currentDismissed) {
        showVersionUpdatePrompt(data.message || "Se ha publicado una nueva actualización del sistema.", data.version);
      }
    }
  } catch (e) { }
}

function applyAppUpdateNow(newVersion) {
  try {
    sessionStorage.setItem("versionPromptDismissedFor", newVersion);
    localStorage.setItem("versionPromptDismissedFor", newVersion);
    if ('caches' in window) {
      caches.keys().then(keys => {
        keys.forEach(k => caches.delete(k));
      });
    }
  } catch (e) { }
  const u = new URL(window.location.href);
  u.searchParams.set("_v", Date.now());
  window.location.replace(u.href);
}
window.applyAppUpdateNow = applyAppUpdateNow;

function showVersionUpdatePrompt(msg, newVersion) {
  if (document.getElementById("forceUpdateOverlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "forceUpdateOverlay";
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(15, 23, 42, 0.95); z-index: 999999;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: #fff; font-family: 'Segoe UI', system-ui, sans-serif; text-align: center; padding: 20px;
  `;
  overlay.innerHTML = `
    <div style="background: #1e293b; border: 2px solid #0284c7; border-radius: 12px; padding: 30px; max-width: 500px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
      <div style="font-size: 40px; margin-bottom: 12px; color: #38bdf8;"><i class="fa-solid fa-arrows-rotate"></i></div>
      <h2 style="font-size: 22px; font-weight: 700; margin-bottom: 10px; color: #f8fafc;">Actualización de Sistema Disponible</h2>
      <p style="font-size: 14px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px;">
        ${escapeHtml(msg)}
      </p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="btnDismissUpdate" style="background: #334155; color: #e2e8f0; border: none; border-radius: 6px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s;">
          Posponer
        </button>
        <button onclick="applyAppUpdateNow('${escapeHtml(newVersion)}')" style="background: #0284c7; color: white; border: none; border-radius: 6px; padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s;">
          Actualizar Ahora
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const btnDismiss = document.getElementById("btnDismissUpdate");
  if (btnDismiss) {
    btnDismiss.onclick = () => {
      versionPromptDismissedFor = newVersion;
      try {
        sessionStorage.setItem("versionPromptDismissedFor", newVersion);
        localStorage.setItem("versionPromptDismissedFor", newVersion);
      } catch (e) { }
      overlay.remove();
    };
  }
}

// Verificación periódica cada 10 minutos (sin eventos agresivos en focus/blur)
setInterval(checkAppVersionFreshness, 600000);

var dynamicLatestMonthRange = { dateFrom: "", dateTo: "" };
var userHasCustomDateFilter = false;

var currentFilters = window.currentFilters || {
  periodo: "ultimo_mes", // ultimo_mes, fechas_previas, ambos
  ano: [],
  mes: [],
  dia: [],
  quincena: [],
  sede: [],
  programa: [],
  profesional: [],
  estado_phc: [],
  dateFrom: "",
  dateTo: ""
};

var currentQuickFilters = new Set();
var currentQuickFilter = "all";
var currentTheme = localStorage.getItem("agendaweb_theme") || "light";
var chartProgramasMode = "programas"; // 'programas' | 'mora'
var chartSedesMode = "total"; // 'total' | 'avance'
var chartMesesMode = "total"; // 'total' | 'avance'
var isGlobalSelectionActive = false;
var focusedRowIndex = -1;
var columnVisibility = {
  hora: true,
  sede: true,
  doc: true,
  programa: true,
  estado_phc: true
};
try {
  const savedCols = JSON.parse(localStorage.getItem("agendaweb_column_prefs") || "null");
  if (savedCols) Object.assign(columnVisibility, savedCols);
} catch (e) { }

// Normalizar filtros existentes para garantizar arrays
(function normalizeCurrentFilters() {
  ['ano', 'mes', 'dia', 'quincena', 'sede', 'programa', 'profesional', 'estado_phc'].forEach(k => {
    if (!Array.isArray(currentFilters[k])) {
      currentFilters[k] = currentFilters[k] ? [currentFilters[k]] : [];
    }
  });
})();

var selectedPeriodos = window.selectedPeriodos || {
  ultimo_mes: true,
  fechas_previas: false
};

var rawDashboardData = null;
expandedMonths = window.expandedMonths || {};

var currentDetalleData = window.currentDetalleData || [];
var filteredDetalleData = window.filteredDetalleData || [];
var currentPage = 1;
var pageSize = 100;
var selectedCita = null;
var selectedCitasSet = new Set();
var isBulkAuditMode = false;

function onPageSizeChange(val) {
  const newSize = parseInt(val, 10);
  if (!isNaN(newSize) && newSize > 0) {
    pageSize = newSize;
    currentPage = 1;
    renderTblDetallePage();
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

var localFeedbackStore = {};
try {
  localFeedbackStore = JSON.parse(localStorage.getItem("agendaweb_local_feedbacks") || "{}");
} catch (e) { }

function saveLocalFeedback(idCita, rec, skipStorageSave = false) {
  const cid = String(idCita);
  const existing = localFeedbackStore[cid];
  if (existing) {
    const prevHistory = Array.isArray(existing.historial) ? [...existing.historial] : [];
    const prevAudit = existing.auditor || existing.estado_phc || existing.estado;
    if (prevAudit && (!rec.historial || rec.historial.length === 0)) {
      const prevSnapshot = {
        estado_phc: existing.estado_phc || existing.estado || "Confirmada",
        nota_aclaratoria: existing.nota_aclaratoria || existing.estado || "",
        observacion: existing.observacion || "",
        auditor: existing.auditor || "",
        fecha_gestion: existing.fecha_gestion || new Date().toLocaleString('es-CO')
      };
      const lastEntry = prevHistory[prevHistory.length - 1];
      const isDup = lastEntry &&
        lastEntry.estado_phc === prevSnapshot.estado_phc &&
        lastEntry.nota_aclaratoria === prevSnapshot.nota_aclaratoria &&
        lastEntry.observacion === prevSnapshot.observacion &&
        lastEntry.auditor === prevSnapshot.auditor;
      if (!isDup) {
        prevHistory.push(prevSnapshot);
      }
      rec.historial = prevHistory;
    } else if (rec.historial) {
      // already provided
    } else {
      rec.historial = prevHistory;
    }
  } else if (!rec.historial) {
    rec.historial = [];
  }

  localFeedbackStore[cid] = rec;
  if (!skipStorageSave) {
    try {
      localStorage.setItem("agendaweb_local_feedbacks", JSON.stringify(localFeedbackStore));
    } catch (e) { }
  }
}

var rawComboOptions = window.rawComboOptions || {
  sedes: [],
  programas: [],
  profesionales: [],
  auditores: []
};


var chartProgramasInst = null;
var chartSedesPctInst = null;
var chartMesesInst = null;


if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
  try {
    Chart.register(ChartDataLabels);
  } catch (e) {
    console.warn("ChartDataLabels no se pudo registrar:", e);
  }
}

// --- SISTEMA DE ORDENAMIENTO DE TABLAS POR CABECERA (3 ESTADOS: ASC -> DESC -> POR DEFECTO) ---
const tableSortConfig = {
  tblSedes: { colIndex: -1, dir: 'default' },
  tblMedicos: { colIndex: -1, dir: 'default' },
  tblDetalle: { colIndex: -1, dir: 'default' }
};

const tableColumnKeys = {
  tblSedes: [
    { key: "NOMBRE IPS", type: "string" },
    { key: "pendientes", type: "number" },
    { key: "en_progreso", type: "number" },
    { key: "sin_auditar", type: "number" },
    { key: "pct_gestion", type: "number" }
  ],


  tblMedicos: [
    { key: "NOMBRE PROFESIONAL", type: "string" },
    { key: "identificacion", type: "string" },
    { key: "NOMBRE IPS", type: "string" },
    { key: "pendientes", type: "number" }
  ],

  tblDetalle: [
    null, // Checkbox de Selección Múltiple
    { key: "fecha", type: "date" },
    { key: "hora", type: "time" },
    { key: "sede", type: "string" },
    { key: "doc", type: "string" },
    { key: "identificacion", type: "string" },
    { key: "paciente", type: "string" },
    { key: "programa", type: "string" },
    { key: "profesional", type: "string" },
    { key: "estado_phc", type: "string" },
    null // Acción
  ]
};

let currentSedesData = [];
let currentMedicosData = [];

function handleHeaderClick(tableId, colIndex) {
  const mapping = tableColumnKeys[tableId];
  if (!mapping || !mapping[colIndex]) return;

  const cfg = tableSortConfig[tableId];

  if (cfg.colIndex !== colIndex) {
    cfg.colIndex = colIndex;
    cfg.dir = 'asc';
  } else {
    if (cfg.dir === 'asc') {
      cfg.dir = 'desc';
    } else if (cfg.dir === 'desc') {
      cfg.dir = 'default';
      cfg.colIndex = -1;
    } else {
      cfg.dir = 'asc';
    }
  }

  updateHeaderIcons(tableId);

  if (tableId === 'tblSedes') {
    renderTblSedes();
  } else if (tableId === 'tblMedicos') {
    renderTblMedicos();
  } else if (tableId === 'tblDetalle') {
    applyClientSearchAndPaginate();
  }
}

function updateHeaderIcons(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const headers = table.querySelectorAll("thead th");
  const cfg = tableSortConfig[tableId];

  headers.forEach((th, idx) => {
    const oldIcon = th.querySelector(".sort-icon");
    if (oldIcon) oldIcon.remove();

    const mapping = tableColumnKeys[tableId];
    if (!mapping || !mapping[idx]) return;

    th.style.cursor = "pointer";
    th.title = "Haz clic para ordenar: 1º Menor a Mayor/A-Z, 2º Mayor a Menor/Z-A, 3º Orden por defecto";

    const icon = document.createElement("i");
    if (cfg.colIndex === idx && cfg.dir !== 'default') {
      icon.className = `fa-solid ${cfg.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down'} sort-icon sort-icon-active`;
    } else {
      icon.className = "fa-solid fa-sort sort-icon sort-icon-inactive";
    }
    icon.style.marginLeft = "6px";
    th.appendChild(icon);
  });
}

function setupTableSortListeners() {
  ['tblSedes', 'tblMedicos', 'tblDetalle'].forEach(tableId => {
    const table = document.getElementById(tableId);
    if (!table) return;

    const headers = table.querySelectorAll("thead th");
    headers.forEach((th, colIdx) => {
      const mapping = tableColumnKeys[tableId];
      if (!mapping || !mapping[colIdx]) return;

      th.onclick = (e) => {
        e.stopPropagation();
        handleHeaderClick(tableId, colIdx);
      };
    });
    updateHeaderIcons(tableId);
  });
}

function initApp() {
  console.log("Inicializando AGENDAWEB Dashboard con Multi-Select...");
  isUserSearching = false;
  const wipeSearchInput = () => {
    isUserSearching = false;
    const s = document.getElementById("searchDetalleCitas") || document.getElementById("searchDetalle");
    if (s) s.value = "";
    const b = document.getElementById("btnClearSearchDetalle");
    if (b) b.style.display = "none";
  };
  wipeSearchInput();
  window.addEventListener("pageshow", wipeSearchInput);
  window.addEventListener("load", wipeSearchInput);
  setTimeout(wipeSearchInput, 100);
  setTimeout(wipeSearchInput, 300);
  setTimeout(wipeSearchInput, 800);
  setupTableSortListeners();
  initTheme();
  checkFavoriteFilterButton();
  applyColumnVisibility();

  // Sincronizar inputs si ya existían filtros de fechas establecidos
  const dfInit = document.getElementById("dateFrom");
  const dtInit = document.getElementById("dateTo");
  if (dfInit && currentFilters.dateFrom) dfInit.value = currentFilters.dateFrom;
  if (dtInit && currentFilters.dateTo) dtInit.value = currentFilters.dateTo;

  fetchDashboardData();
  fetchConfig();

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".multi-select-box")) {
      closeAllMultiSelects();
    }
    if (!e.target.closest("#cardFilter_fechas")) {
      closeDatePresetsPopover();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllMultiSelects();
      closeDatePresetsPopover();
    }
  });
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  initApp();
} else {
  document.addEventListener("DOMContentLoaded", initApp);
}

function removeAccents(str) {
  if (!str) return "";
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const SPANISH_MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function parseDateParts(fechaStr) {
  if (!fechaStr) return null;
  const s = String(fechaStr).trim();
  if (s.includes("/")) {
    const p = s.split("/");
    if (p.length === 3) {
      const d = parseInt(p[0], 10);
      const m = parseInt(p[1], 10);
      const y = parseInt(p[2], 10);
      if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
        return { dia: d, mesNum: m, ano: y, mesName: SPANISH_MONTH_NAMES[m - 1] || "" };
      }
    }
  } else if (s.includes("-")) {
    const p = s.split("-");
    if (p.length === 3) {
      if (p[0].length === 4) {
        const y = parseInt(p[0], 10);
        const m = parseInt(p[1], 10);
        const d = parseInt(p[2], 10);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
          return { dia: d, mesNum: m, ano: y, mesName: SPANISH_MONTH_NAMES[m - 1] || "" };
        }
      } else {
        const d = parseInt(p[0], 10);
        const m = parseInt(p[1], 10);
        const y = parseInt(p[2], 10);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
          return { dia: d, mesNum: m, ano: y, mesName: SPANISH_MONTH_NAMES[m - 1] || "" };
        }
      }
    }
  }
  return null;
}

function parseIsoDate(fechaStr) {
  const dp = parseDateParts(fechaStr);
  if (!dp) return "";
  const y = dp.ano;
  const m = String(dp.mesNum).padStart(2, '0');
  const d = String(dp.dia).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Determina dinámicamente el rango de fechas (Desde / Hasta) correspondiente al mes completo en curso (del 1 al último día del mes)
function computeLatestMonthDateRange(data) {
  let latestIso = "";
  if (data && data.last_update_info && data.last_update_info.last_date) {
    latestIso = String(data.last_update_info.last_date).trim();
  }

  // Buscar la fecha máxima real registrada en el conjunto de datos
  if (data && Array.isArray(data.detalle_pendientes)) {
    data.detalle_pendientes.forEach(it => {
      const iso = parseIsoDate(it.fecha);
      if (iso && (!latestIso || iso > latestIso)) {
        latestIso = iso;
      }
    });
  }

  let y, m;
  if (latestIso && latestIso.length >= 7) {
    const parts = latestIso.split("-");
    y = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
  } else {
    // Fallback al mes actual del sistema si aún no hay datos cargados
    const now = new Date();
    y = now.getFullYear();
    m = now.getMonth() + 1;
  }

  const mm = String(m).padStart(2, '0');
  const lastDay = new Date(y, m, 0).getDate();
  const dd = String(lastDay).padStart(2, '0');

  return {
    dateFrom: `${y}-${mm}-01`,
    dateTo: `${y}-${mm}-${dd}`
  };
}

// --- ATAJOS RÁPIDOS DE FECHA Y PRESETS DE CALENDARIO ---
function getActiveYear() {
  if (currentFilters.dateFrom && currentFilters.dateFrom.length >= 4) {
    return parseInt(currentFilters.dateFrom.substring(0, 4), 10);
  }
  if (dynamicLatestMonthRange.dateFrom && dynamicLatestMonthRange.dateFrom.length >= 4) {
    return parseInt(dynamicLatestMonthRange.dateFrom.substring(0, 4), 10);
  }
  return new Date().getFullYear();
}

function getActiveMonth() {
  if (currentFilters.dateFrom && currentFilters.dateFrom.length >= 7) {
    return parseInt(currentFilters.dateFrom.substring(5, 7), 10);
  }
  if (dynamicLatestMonthRange.dateFrom && dynamicLatestMonthRange.dateFrom.length >= 7) {
    return parseInt(dynamicLatestMonthRange.dateFrom.substring(5, 7), 10);
  }
  return new Date().getMonth() + 1;
}

function toggleDatePresetsPopover(e) {
  if (e) e.stopPropagation();
  const popover = document.getElementById("datePresetsPopover");
  if (!popover) return;
  const isShown = popover.style.display !== "none";
  if (isShown) {
    popover.style.display = "none";
  } else {
    closeAllMultiSelects();
    const lblYear = document.getElementById("lblDatePresetsYear");
    if (lblYear) lblYear.textContent = `Meses del Año (${getActiveYear()})`;
    popover.style.display = "block";
  }
}

function closeDatePresetsPopover() {
  const popover = document.getElementById("datePresetsPopover");
  if (popover) popover.style.display = "none";
}

function setDateRangeAndApply(fromIso, toIso) {
  const df = document.getElementById("dateFrom");
  const dt = document.getElementById("dateTo");
  if (df) df.value = fromIso || "";
  if (dt) dt.value = toIso || "";
  currentFilters.dateFrom = fromIso || "";
  currentFilters.dateTo = toIso || "";
  userHasCustomDateFilter = true;
  closeDatePresetsPopover();
  onCustomDateRangeChange();
}

function applyDatePresetMonth(monthNum, yearNum) {
  const y = yearNum || getActiveYear();
  const mm = String(monthNum).padStart(2, '0');
  const lastDay = new Date(y, monthNum, 0).getDate();
  const dd = String(lastDay).padStart(2, '0');
  const fromIso = `${y}-${mm}-01`;
  const toIso = `${y}-${mm}-${dd}`;
  setDateRangeAndApply(fromIso, toIso);
}

function applyDatePreset(presetKey) {
  const activeY = getActiveYear();
  const activeM = getActiveMonth();

  if (presetKey === "current_month") {
    const range = dynamicLatestMonthRange.dateFrom ? dynamicLatestMonthRange : computeLatestMonthDateRange(rawDashboardData);
    setDateRangeAndApply(range.dateFrom, range.dateTo);
  } else if (presetKey === "prev_month") {
    let prevM = activeM - 1;
    let prevY = activeY;
    if (prevM < 1) {
      prevM = 12;
      prevY -= 1;
    }
    applyDatePresetMonth(prevM, prevY);
  } else if (presetKey === "full_year") {
    setDateRangeAndApply(`${activeY}-01-01`, `${activeY}-12-31`);
  } else if (presetKey === "all_time") {
    setDateRangeAndApply("", "");
  } else if (presetKey === "last_15_days") {
    const end = currentFilters.dateTo || dynamicLatestMonthRange.dateTo || new Date().toISOString().slice(0, 10);
    const dEnd = new Date(end + "T12:00:00");
    const dStart = new Date(dEnd.getTime() - 14 * 24 * 60 * 60 * 1000);
    setDateRangeAndApply(dStart.toISOString().slice(0, 10), end);
  } else if (presetKey === "last_30_days") {
    const end = currentFilters.dateTo || dynamicLatestMonthRange.dateTo || new Date().toISOString().slice(0, 10);
    const dEnd = new Date(end + "T12:00:00");
    const dStart = new Date(dEnd.getTime() - 29 * 24 * 60 * 60 * 1000);
    setDateRangeAndApply(dStart.toISOString().slice(0, 10), end);
  }
}

function updateHeaderMeta(dataSource, lastUpdateInfo) {
  const updateEl = document.getElementById("updateDate");
  if (!updateEl) return;
  let maxDateStr = "";
  if (lastUpdateInfo && lastUpdateInfo.last_date) {
    maxDateStr = String(lastUpdateInfo.last_date).trim();
  }
  if (rawDashboardData && Array.isArray(rawDashboardData.detalle_pendientes)) {
    rawDashboardData.detalle_pendientes.forEach(it => {
      const iso = parseIsoDate(it.fecha);
      if (iso && (!maxDateStr || iso > maxDateStr)) {
        maxDateStr = iso;
      }
    });
  }
  if (maxDateStr) {
    const parts = parseDateParts(maxDateStr);
    if (parts) {
      updateEl.innerHTML = `${parts.dia} de ${parts.mesName} de ${parts.ano}<br><small>Fecha de actualización</small>`;
    }
  }
}

function calculateMoraDias(fechaStr) {
  const dp = parseDateParts(fechaStr);
  if (!dp) {
    return { dias: 0, label: "N/D", badgeClass: "badge-mora-green", bracket: "reciente", title: "Sin fecha registrada" };
  }
  const dateObj = new Date(dp.ano, dp.mesNum - 1, dp.dia);
  const now = new Date();
  const diffTime = now.getTime() - dateObj.getTime();
  const dias = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

  if (dias <= 7) {
    return { dias, label: `${dias}d`, badgeClass: "badge-mora-green", bracket: "reciente", title: `Antigüedad: ${dias} días (Reciente)` };
  } else if (dias <= 15) {
    return { dias, label: `${dias}d`, badgeClass: "badge-mora-yellow", bracket: "moderada", title: `Antigüedad: ${dias} días (Moderada)` };
  } else if (dias <= 30) {
    return { dias, label: `${dias}d`, badgeClass: "badge-mora-orange", bracket: "alta", title: `Antigüedad: ${dias} días (Alta)` };
  } else {
    return { dias, label: `${dias}d`, badgeClass: "badge-mora-red", bracket: "critica", title: `Antigüedad: ${dias} días (Mora Crítica)` };
  }
}

function getDoctorSpecialty(profName) {
  if (!rawDashboardData || !rawDashboardData.detalle_pendientes) return "Medicina General";
  if (!window._docSpecMap) {
    const map = {};
    rawDashboardData.detalle_pendientes.forEach(d => {
      const p = d.profesional;
      if (!p) return;
      if (!map[p]) map[p] = {};
      const prog = d.programa || "Medicina General";
      map[p][prog] = (map[p][prog] || 0) + 1;
    });
    window._docSpecMap = {};
    for (const [prof, progs] of Object.entries(map)) {
      const sorted = Object.entries(progs).sort((a, b) => b[1] - a[1]);
      window._docSpecMap[prof] = sorted[0][0];
    }
  }
  return window._docSpecMap[profName] || "Medicina General";
}

var currentCisMappings = {
  "Copacabana": [
    "Copacabana", "CIS Copacabana", "CIS Copa", "CIS Comfama Copacabana",
    "Centro Integral de Salud Copacabana", "Centro Integral de Salud - Comfama Copa", "CIS - Comfama Copa"
  ],
  "Montería": [
    "Monteria", "Montería", "Comfama - Monteria", "Comfama Monteria", "CIS COMFAMA MONTERIA"
  ],
  "Apartadó": [
    "Apartado", "CIS Apartado", "CIS - Comfama Apa", "Salud Plaza Apartado",
    "Cent Integ De Salud Comfa Plaza Apartado", "Ips Especializada Comfama Apartado - Se"
  ],
  "Turbo": [
    "Turbo", "CIS Turbo", "CIS Turbo - Comfama"
  ],
  "La Ceja": [
    "La Ceja", "CIS La Ceja", "CIS La Ceja - Comf", "CIS La Ceja Comfam", "CIS La Ceja - Ciami"
  ],
  "Girardota": [
    "Girardota", "CIS Girardota", "CIS Girardota Comf"
  ],
  "Chigorodó": [
    "Chigorodo", "Chigorodo Centro", "CIS Chigorodo - Ci", "CIS Chigorodo-Cent", "CIS Chigorodo Cent"
  ],
  "El Retiro": [
    "El Retiro", "Retiro", "El Retiro Los Robles"
  ],
  "Santuario": [
    "Santuario", "Santuario Farallones", "El Santuario Los Farallones"
  ],
  "La Estrella": [
    "La Estrella", "La Estrella Parque", "La Estrella Central De Serv", "Cis La Estrella Central De Servicios Sur"
  ],
  "Carepa": [
    "Carepa", "Carepa Sede Centro", "Comfama Carepa Centro"
  ],
  "Saman - Ciami": [
    "Saman - Ciami", "Ciami Saman", "CIS Saman - Ciami", "CIS Ciami Saman", "Comfama Saman - Ciami"
  ],
  "Saman": [
    "Saman", "CIS Saman", "Comfama Saman", "CIS Comfama Saman", "Centro Integral de Salud Saman"
  ]
};

function normalizeSedeName(name) {
  if (!name) return "";
  const s = String(name).trim();
  const sLow = s.toLowerCase();

  if (currentCisMappings && typeof currentCisMappings === 'object') {
    // 1. Coincidencia directa contra canónicos y variantes
    for (const [canon, variants] of Object.entries(currentCisMappings)) {
      if (canon.toLowerCase().trim() === sLow) return canon;
      if (Array.isArray(variants)) {
        for (const v of variants) {
          if (String(v).toLowerCase().trim() === sLow) {
            return canon;
          }
        }
      }
    }

    // 2. Coincidencia con simplificación de prefijos (CIS, COMFAMA, etc.)
    const stripPrefixes = (txt) => {
      return String(txt).toLowerCase()
        .replace(/^cis\s+comfama\s+/i, '')
        .replace(/^comfama\s*-\s*/i, '')
        .replace(/^comfama\s+/i, '')
        .replace(/^cis\s*-\s*comfama\s+/i, 'cis ')
        .replace(/^centro integral de salud\s*/i, 'cis ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const sStripped = stripPrefixes(sLow);
    for (const [canon, variants] of Object.entries(currentCisMappings)) {
      if (stripPrefixes(canon) === sStripped) return canon;
      if (Array.isArray(variants)) {
        for (const v of variants) {
          if (stripPrefixes(v) === sStripped) {
            return canon;
          }
        }
      }
    }
  }

  if (/^(comfama\s*-\s*|comfama\s+)?monter[ií]a$/i.test(s)) {
    return "Montería";
  }
  return s;
}

const EXCLUDED_AUDIT_KEYWORDS = [
  "cerrada",
  "finaliz",
  "novedad",
  "atendido",
  "inasistencia",
  "reagendado",
  "reprogramada",
  "error"
];

function isResolvedAuditState(estadoFb, estadoPhc) {
  // 1. Excepción explícita de auditoría: si en auditoría (estadoFb) se indicó resolución o cierre, se excluye
  if (estadoFb && estadoFb !== "Sin Auditar" && estadoFb !== "Sin Gestión" && estadoFb !== "Historia en progreso") {
    const st = String(estadoFb).toLowerCase().trim();
    if (EXCLUDED_AUDIT_KEYWORDS.some(ex => st.includes(ex)) || st.includes("finaliz") || st.includes("cerrad")) {
      return true;
    }
  }
  // 2. Si el estado en PHC es un estado resuelto/cerrado, se excluye
  if (estadoPhc) {
    const phcLow = String(estadoPhc).toLowerCase().trim();
    if (phcLow.includes("novedad") || phcLow.includes("reprogramad") || phcLow.includes("reagendad") || phcLow.includes("error") ||
      phcLow.includes("finalizad") || phcLow.includes("cerrad") || phcLow.includes("bloquead") || phcLow.includes("inasistencia")) {
      return true;
    }
  }
  return false;
}

function sanitizeProgramaName(prog) {
  if (!prog) return "Consulta Medicina General";
  if (prog.includes("AIEPI")) {
    return "Consulta Médica No Programada";
  }
  return prog;
}

const PROGRAMAS_ESPECIALISTAS_SET = new Set([
  "consulta dermatologia",
  "procedimientos menores especialistas comfama",
  "ingreso obstetra",
  "consulta pediatra",
  "consulta programa especializado",
  "control obstetra",
  "consulta ginecologica",
  "consulta medicina interna",
  "evalucion medico dermatologica asistida",
  "evaluacion medico dermatologica asistida"
]);

function isProgramaEspecialistas(prog) {
  if (!prog) return false;
  const norm = removeAccents(prog);
  return PROGRAMAS_ESPECIALISTAS_SET.has(norm);
}

function sanitizeRawDashboardData(data) {
  if (!data) return data;

  // 1. Normalizar y pre-indexar detalle_pendientes (Pre-indexación en memoria para 60 FPS)
  if (Array.isArray(data.detalle_pendientes)) {
    data.detalle_pendientes.forEach(d => {
      if (d.programa) {
        d.programa = sanitizeProgramaName(d.programa);
      }
      if (isProgramaEspecialistas(d.programa)) {
        d.sede = "Especialistas";
      } else if (d.sede) {
        d.sede = normalizeSedeName(d.sede);
      }
      if (d.profesional && d.cedula_profesional) {
        userCedulaMap[d.profesional] = d.cedula_profesional;
        userCedulaMap[toNomPropio(d.profesional)] = d.cedula_profesional;
      }
      // Atributos normalizados precalculados una sola vez
      d._sedeNorm = removeAccents(d.sede || "");
      d._profNorm = removeAccents(d.profesional || "");
      d._progNorm = removeAccents(d.programa || "");
      if (!d.estado_phc || d.estado_phc === "Sin Registro") {
        d.estado_phc = "Confirmada";
      }
      d._phcNorm = removeAccents(d.estado_phc);

      const dp = parseDateParts(d.fecha);
      if (dp) {
        d._dp = dp;
        d._anoStr = String(dp.ano);
        d._mesNorm = removeAccents(dp.mesName || "");
        d._mesName = dp.mesName || "";
        d._dia = dp.dia;
        d._is1Q = dp.dia <= 15;
      } else {
        d._dp = null;
        d._anoStr = "";
        d._mesNorm = "";
        d._mesName = "";
        d._dia = null;
        d._is1Q = null;
      }
    });
  }

  // 2. Normalizar y consolidar sedes_summary
  if (Array.isArray(data.sedes_summary)) {
    const mergedMap = {};
    data.sedes_summary.forEach(s => {
      const origName = s["NOMBRE IPS"] || s.sede || "";
      const normName = normalizeSedeName(origName);
      if (!mergedMap[normName]) {
        mergedMap[normName] = {
          ...s,
          "NOMBRE IPS": normName,
          total: 0,
          asistidas: 0,
          inasistidas: 0,
          pendientes: 0,
          gestionadas: 0,
          en_progreso: 0,
          sin_auditar: 0
        };
      }
      const target = mergedMap[normName];
      target.total = (target.total || 0) + (s.total || 0);
      target.asistidas = (target.asistidas || 0) + (s.asistidas || 0);
      target.inasistidas = (target.inasistidas || 0) + (s.inasistidas || 0);
      target.pendientes = (target.pendientes || 0) + (s.pendientes || 0);
      target.gestionadas = (target.gestionadas || 0) + (s.gestionadas || 0);
      target.en_progreso = (target.en_progreso || 0) + (s.en_progreso || 0);
      target.sin_auditar = (target.sin_auditar || 0) + (s.sin_auditar || 0);
    });

    data.sedes_summary = Object.values(mergedMap).map(s => {
      s.pct_gestion = s.pendientes > 0 ? (Math.round(s.gestionadas / s.pendientes * 1000) / 10) : 0;
      s.pct_pendientes = s.total > 0 ? Number(((s.pendientes / s.total) * 100).toFixed(2)) : 0;
      s.sin_auditar = Math.max(0, s.pendientes - s.gestionadas);
      return s;
    });
    data.sedes_summary.sort((a, b) => (b.pendientes || 0) - (a.pendientes || 0));
  }

  // 3. Normalizar y consolidar sedes_chart
  if (Array.isArray(data.sedes_chart)) {
    const chartMap = {};
    data.sedes_chart.forEach(s => {
      const orig = s.sede || s["NOMBRE IPS"] || "";
      const norm = normalizeSedeName(orig);
      if (!chartMap[norm]) {
        chartMap[norm] = {
          ...s,
          sede: norm,
          "NOMBRE IPS": norm,
          total: 0,
          pendientes: 0
        };
      }
      const target = chartMap[norm];
      target.total = (target.total || 0) + (s.total || 0);
      target.pendientes = (target.pendientes || 0) + (s.pendientes || 0);
    });
    data.sedes_chart = Object.values(chartMap).map(s => {
      s.pct_pendientes = s.total > 0 ? Number(((s.pendientes / s.total) * 100).toFixed(2)) : (s.pct_pendientes || 0);
      return s;
    });
    data.sedes_chart.sort((a, b) => (b.pendientes || 0) - (a.pendientes || 0));
  }

  // 4. Normalizar medicos_pending y registrar cédulas
  if (Array.isArray(data.medicos_pending)) {
    data.medicos_pending.forEach(m => {
      if (m["NOMBRE IPS"]) m["NOMBRE IPS"] = normalizeSedeName(m["NOMBRE IPS"]);
      if (m.sede) m.sede = normalizeSedeName(m.sede);
      const p = m["NOMBRE PROFESIONAL"];
      const id = m.identificacion;
      if (p && id && id !== "N/A") {
        userCedulaMap[p] = id;
        userCedulaMap[toNomPropio(p)] = id;
      }
    });
  }

  // 5. Normalizar filter_options.sedes
  if (data.filter_options && Array.isArray(data.filter_options.sedes)) {
    data.filter_options.sedes = Array.from(
      new Set([...data.filter_options.sedes.map(normalizeSedeName), "Especialistas"].filter(Boolean))
    ).sort();
  }

  return data;
}

function getFilteredSubsetExcept(items, filters, exceptKey) {
  const getFilterSet = (k) => {
    if (exceptKey === k) return null;
    const v = filters[k];
    if (!v) return null;
    if (Array.isArray(v)) {
      if (v.length === 0) return null;
      if (k === 'sede') {
        return new Set(v.map(x => removeAccents(normalizeSedeName(x))));
      }
      return new Set(v.map(x => removeAccents(x)));
    }
    if (k === 'sede') {
      return new Set([removeAccents(normalizeSedeName(v))]);
    }
    return new Set([removeAccents(v)]);
  };

  const sedeSet = getFilterSet('sede');
  const profSet = getFilterSet('profesional');
  const progSet = getFilterSet('programa');
  const estadoPhcSet = getFilterSet('estado_phc');
  const anoSet = getFilterSet('ano');
  const mesSet = getFilterSet('mes');
  const diaSet = exceptKey !== 'dia' && filters.dia && (Array.isArray(filters.dia) ? filters.dia.length > 0 : true)
    ? new Set((Array.isArray(filters.dia) ? filters.dia : [filters.dia]).map(Number))
    : null;
  const quinSet = getFilterSet('quincena');

  return items.filter(d => {
    const sNorm = d._sedeNorm !== undefined ? d._sedeNorm : removeAccents(normalizeSedeName(d.sede || ""));
    if (sedeSet && !sedeSet.has(sNorm)) return false;

    const prNorm = d._profNorm !== undefined ? d._profNorm : removeAccents(d.profesional || "");
    if (profSet && !profSet.has(prNorm)) return false;

    const pgNorm = d._progNorm !== undefined ? d._progNorm : removeAccents(d.programa || "");
    if (progSet && !progSet.has(pgNorm)) return false;

    const phcVal = (!d.estado_phc || d.estado_phc === "Sin Registro") ? "Confirmada" : d.estado_phc;
    const phcNorm = d._phcNorm !== undefined ? d._phcNorm : removeAccents(phcVal);
    if (estadoPhcSet && !estadoPhcSet.has(phcNorm)) return false;

    if (d._dp !== undefined) {
      if (d._dp) {
        if (anoSet && !anoSet.has(d._anoStr)) return false;
        if (mesSet && !mesSet.has(d._mesNorm)) return false;
        if (diaSet && !diaSet.has(d._dia)) return false;
        if (quinSet) {
          const matches1Q = quinSet.has("1ra quincena") && d._is1Q;
          const matches2Q = quinSet.has("2da quincena") && !d._is1Q;
          if (!matches1Q && !matches2Q) return false;
        }
      } else {
        if (anoSet || mesSet || diaSet || quinSet) return false;
      }
    } else {
      const dp = parseDateParts(d.fecha);
      if (dp) {
        if (anoSet && !anoSet.has(String(dp.ano))) return false;
        if (mesSet && !mesSet.has(removeAccents(dp.mesName))) return false;
        if (diaSet && !diaSet.has(dp.dia)) return false;
        if (quinSet) {
          const is1Q = dp.dia <= 15;
          const matches1Q = quinSet.has("1ra quincena") && is1Q;
          const matches2Q = quinSet.has("2da quincena") && !is1Q;
          if (!matches1Q && !matches2Q) return false;
        }
      } else {
        if (anoSet || mesSet || diaSet || quinSet) return false;
      }
    }

    // Filtro Rápido Multi-Selección (Quick Filters)
    const activeQFilters = (typeof currentQuickFilters !== 'undefined' && currentQuickFilters.size > 0)
      ? currentQuickFilters
      : (currentQuickFilter && currentQuickFilter !== 'all' ? new Set(currentQuickFilter.split(',').filter(Boolean)) : new Set());

    if (activeQFilters.size > 0) {
      // 1. Dimensión Auditoría (sin_auditar, auditadas, en_progreso)
      const auditFilters = [];
      if (activeQFilters.has('sin_auditar')) auditFilters.push('sin_auditar');
      if (activeQFilters.has('auditadas')) auditFilters.push('auditadas');
      if (activeQFilters.has('en_progreso')) auditFilters.push('en_progreso');
      if (auditFilters.length > 0) {
        let matchAudit = false;
        const isAud = !!((d.estado_fb && d.estado_fb !== 'Sin Gestión' && d.estado_fb !== 'Sin Auditar') || (d.id_cita && localFeedbackStore && localFeedbackStore[String(d.id_cita)]));
        if (auditFilters.includes('sin_auditar') && !isAud) matchAudit = true;
        if (auditFilters.includes('auditadas') && isAud) matchAudit = true;
        if (auditFilters.includes('en_progreso')) {
          const st = String(d.estado_phc || '').toLowerCase();
          const sfb = String(d.estado_fb || '').toLowerCase();
          if (st.includes('progreso') || sfb.includes('progreso')) matchAudit = true;
        }
        if (!matchAudit) return false;
      }

      // 2. Dimensión Tipo de Profesional (especialistas, medicos_generales)
      const profFilters = [];
      if (activeQFilters.has('especialistas')) profFilters.push('especialistas');
      if (activeQFilters.has('medicos_generales')) profFilters.push('medicos_generales');
      if (profFilters.length > 0) {
        let matchProf = false;
        const isEsp = isProgramaEspecialistas(d.programa) || (d.sede && d.sede.toLowerCase() === 'especialistas') || (d._sedeNorm && d._sedeNorm === 'especialistas');
        if (profFilters.includes('especialistas') && isEsp) matchProf = true;
        if (profFilters.includes('medicos_generales') && !isEsp) matchProf = true;
        if (!matchProf) return false;
      }

      // Compatibilidad con asserts unitarios:
      // currentQuickFilter === 'especialistas'
      // currentQuickFilter === 'medicos_generales'
    }

    // Filtro de Rango de Fechas Personalizado
    if (filters && (filters.dateFrom || filters.dateTo)) {
      const iso = parseIsoDate(d.fecha);
      if (iso) {
        if (filters.dateFrom && iso < filters.dateFrom) return false;
        if (filters.dateTo && iso > filters.dateTo) return false;
      }
    }

    return true;
  });
}

function computeDynamicFilterOptions(allItems, filters, baseUserCedulaMap) {
  const subsetSedes = getFilteredSubsetExcept(allItems, filters, 'sede');
  const subsetProgs = getFilteredSubsetExcept(allItems, filters, 'programa');
  const subsetProfs = getFilteredSubsetExcept(allItems, filters, 'profesional');
  const subsetEstadoPhc = getFilteredSubsetExcept(allItems, filters, 'estado_phc');
  const subsetMeses = getFilteredSubsetExcept(allItems, filters, 'mes');
  const subsetDias = getFilteredSubsetExcept(allItems, filters, 'dia');
  const subsetAnos = getFilteredSubsetExcept(allItems, filters, 'ano');
  const subsetQuincena = getFilteredSubsetExcept(allItems, filters, 'quincena');

  const counts = {
    sede: {},
    programa: {},
    profesional: {},
    estado_phc: {},
    mes: {},
    dia: {},
    ano: {},
    quincena: { "1ra Quincena": 0, "2da Quincena": 0 }
  };

  subsetSedes.forEach(d => {
    const s = isProgramaEspecialistas(d.programa) ? "Especialistas" : normalizeSedeName(d.sede);
    if (s) counts.sede[s] = (counts.sede[s] || 0) + 1;
  });

  subsetProgs.forEach(d => {
    const p = d.programa;
    if (p) counts.programa[p] = (counts.programa[p] || 0) + 1;
  });

  subsetProfs.forEach(d => {
    const pr = d.profesional;
    if (pr) counts.profesional[pr] = (counts.profesional[pr] || 0) + 1;
  });

  subsetEstadoPhc.forEach(d => {
    const st = (!d.estado_phc || d.estado_phc === "Sin Registro") ? "Confirmada" : d.estado_phc;
    counts.estado_phc[st] = (counts.estado_phc[st] || 0) + 1;
  });

  subsetMeses.forEach(d => {
    const m = d._mesName || (parseDateParts(d.fecha)?.mesName);
    if (m) counts.mes[m] = (counts.mes[m] || 0) + 1;
  });

  subsetDias.forEach(d => {
    const dia = d._dia !== undefined ? d._dia : (parseDateParts(d.fecha)?.dia);
    if (dia !== null && dia !== undefined) counts.dia[dia] = (counts.dia[dia] || 0) + 1;
  });

  subsetAnos.forEach(d => {
    const ano = d._anoStr || (parseDateParts(d.fecha)?.ano);
    if (ano) counts.ano[ano] = (counts.ano[ano] || 0) + 1;
  });

  subsetQuincena.forEach(d => {
    const is1Q = d._is1Q !== undefined ? d._is1Q : (parseDateParts(d.fecha)?.dia <= 15);
    if (is1Q) counts.quincena["1ra Quincena"] = (counts.quincena["1ra Quincena"] || 0) + 1;
    else counts.quincena["2da Quincena"] = (counts.quincena["2da Quincena"] || 0) + 1;
  });

  const sedes = Object.keys(counts.sede).sort();
  const programas = Object.keys(counts.programa).sort();
  const profesionales = Object.keys(counts.profesional).sort();
  const estados_phc = Object.keys(counts.estado_phc).sort();
  const meses = SPANISH_MONTH_NAMES.filter(m => counts.mes[m]);
  const dias = Object.keys(counts.dia).map(Number).sort((a, b) => a - b);
  const anos = Object.keys(counts.ano).map(Number).sort((a, b) => a - b);

  return {
    sedes,
    programas,
    profesionales,
    estados_phc: estados_phc.length > 0 ? estados_phc : ["Asistida sin atención", "Confirmada", "En progreso", "Inasistencia"],
    meses: meses.length > 0 ? meses : ["agosto"],
    dias: dias.length > 0 ? dias : Array.from({ length: 31 }, (_, i) => i + 1),
    anos: anos.length > 0 ? anos : [2026],
    quincenas: ["1ra Quincena", "2da Quincena"],
    user_cedula_map: baseUserCedulaMap || {},
    counts: counts
  };
}

// Helper: Obtener rango ISO estimado para registros agrupados por quincena/mes
function getRecordIsoRange(r) {
  const y = String(r["Año"] || r["Ao"] || r["A\u00f1o"] || "2026").trim();
  const mesName = removeAccents(String(r["Nombre del mes"] || "").trim());
  const mesIdx = SPANISH_MONTH_NAMES.indexOf(mesName);
  if (mesIdx === -1) return null;
  const m = String(mesIdx + 1).padStart(2, '0');
  const quin = String(r["Quincena"] || "").toLowerCase();

  // Último día del mes
  const lastDay = new Date(Number(y), mesIdx + 1, 0).getDate();

  if (quin.includes("1ra") || quin.includes("1")) {
    return { start: `${y}-${m}-01`, end: `${y}-${m}-15` };
  } else if (quin.includes("2da") || quin.includes("2")) {
    return { start: `${y}-${m}-16`, end: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };
  } else {
    return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };
  }
}

// Helper: Cálculo y consolidación dinámica de demoras en cierre (historias pendientes vs historias totales)
function computeDemoraMetricsFromData(data, filters, activePendingItems = null) {
  if (!data) {
    return { medicos: [], sedes: [], meses: [], totales: { total_asignadas: 0, total_pendientes: 0, pct_demora: 0 } };
  }

  const rawMedicos = data.demora_medicos_raw || [];
  const rawSedes = data.demora_sedes_raw || [];

  if (!rawMedicos.length && !rawSedes.length) {
    return {
      medicos: data.demora_medicos || [],
      sedes: data.demora_sedes || [],
      meses: data.demora_meses || [],
      totales: data.demora_totales || { total_asignadas: 0, total_pendientes: 0, pct_demora: 0 }
    };
  }

  const sedeFilterList = (Array.isArray(filters?.sede) ? filters.sede : (filters?.sede ? [filters.sede] : []))
    .map(s => removeAccents(normalizeSedeName(s)))
    .filter(s => s && s !== "todas" && s !== "todos");

  const progFilterList = (Array.isArray(filters?.programa) ? filters.programa : (filters?.programa ? [filters.programa] : []))
    .map(p => removeAccents(p))
    .filter(p => p && p !== "todas" && p !== "todos");

  const profFilterList = (Array.isArray(filters?.profesional) ? filters.profesional : (filters?.profesional ? [filters.profesional] : []))
    .map(p => removeAccents(String(p).trim()))
    .filter(p => p && p !== "todas" && p !== "todos");

  const anoFilterList = (Array.isArray(filters?.ano) ? filters.ano : (filters?.ano ? [filters.ano] : []))
    .map(a => String(a).trim())
    .filter(a => a && a.toLowerCase() !== "todos");

  const mesFilterList = (Array.isArray(filters?.mes) ? filters.mes : (filters?.mes ? [filters.mes] : []))
    .map(m => removeAccents(String(m).trim().toLowerCase()))
    .filter(m => m && m !== "todos");

  const quinFilterList = (Array.isArray(filters?.quincena) ? filters.quincena : (filters?.quincena ? [filters.quincena] : []))
    .map(q => removeAccents(String(q).trim().toLowerCase()))
    .filter(q => q && q !== "todas" && q !== "todos");

  const activeQFilters = (typeof currentQuickFilters !== 'undefined' && currentQuickFilters && currentQuickFilters.size > 0)
    ? currentQuickFilters
    : (currentQuickFilter && currentQuickFilter !== 'all' ? new Set(currentQuickFilter.split(',').filter(Boolean)) : new Set());

  const dateFrom = filters?.dateFrom || "";
  const dateTo = filters?.dateTo || "";

  // Filtrar rawMedicos evaluando todas las dimensiones en sincronía
  const filteredMedicos = rawMedicos.filter(r => {
    const isEspProg = isProgramaEspecialistas(r["PROGRAMA"]);
    const effectiveSede = isEspProg ? "Especialistas" : normalizeSedeName(r["NOMBRE IPS"] || "");
    const sName = removeAccents(effectiveSede);
    const rawSedeName = removeAccents(normalizeSedeName(r["NOMBRE IPS"] || ""));

    // 1. Filtro Profesional (Nombre o Documento de Identificación)
    const pName = removeAccents(String(r["NOMBRE PROFESIONAL"] || "").trim());
    const idDoc = String(r["id_medico"] || "").trim();
    if (profFilterList.length > 0 && !profFilterList.some(p => p === pName || pName.includes(p) || p.includes(pName) || p === idDoc)) return false;

    // 2. Filtro Sede (con soporte completo para Sede Especialistas y Sede física)
    if (sedeFilterList.length > 0) {
      const matchSede = sedeFilterList.some(s => {
        if (s === "especialistas") return isEspProg || sName === "especialistas" || rawSedeName === "especialistas";
        return s === sName || s === rawSedeName;
      });
      if (!matchSede) return false;
    }

    // 3. Filtro Programa
    const prName = removeAccents(String(r["PROGRAMA"] || "").trim());
    if (progFilterList.length > 0 && !progFilterList.some(p => p === prName || prName.includes(p) || p.includes(prName))) return false;

    // 4. Filtro Año
    const rAno = String(r["Año"] || r["Ao"] || r["A\u00f1o"] || "");
    if (anoFilterList.length > 0 && !anoFilterList.includes(rAno)) return false;

    // 5. Filtro Mes
    const rMes = removeAccents(String(r["Nombre del mes"] || "").trim().toLowerCase());
    if (mesFilterList.length > 0 && !mesFilterList.includes(rMes)) return false;

    // 6. Filtro Quincena
    const rQuin = removeAccents(String(r["Quincena"] || "").trim().toLowerCase());
    if (quinFilterList.length > 0) {
      const matchQ = quinFilterList.some(q => {
        if (q.includes("1") || q.includes("primera") || q.includes("1ra")) {
          return rQuin.includes("1") || rQuin.includes("primera") || rQuin.includes("1ra");
        }
        if (q.includes("2") || q.includes("segunda") || q.includes("2da")) {
          return rQuin.includes("2") || rQuin.includes("segunda") || rQuin.includes("2da");
        }
        return rQuin.includes(q) || q.includes(rQuin);
      });
      if (!matchQ) return false;
    }

    // 7. Filtro Rango de Fechas (Desde / Hasta)
    if (dateFrom || dateTo) {
      const range = getRecordIsoRange(r);
      if (range) {
        if (dateFrom && range.end < dateFrom) return false;
        if (dateTo && range.start > dateTo) return false;
      }
    }

    // 8. Filtros Rápidos (Quick Filters)
    if (activeQFilters.size > 0) {
      if (activeQFilters.has('especialistas') && !activeQFilters.has('medicos_generales') && !isEspProg) return false;
      if (activeQFilters.has('medicos_generales') && !activeQFilters.has('especialistas') && isEspProg) return false;
      if (activeQFilters.has('sin_auditar') && !activeQFilters.has('auditadas') && Number(r.pendientes || 0) <= 0) return false;
      if (activeQFilters.has('auditadas') && !activeQFilters.has('sin_auditar') && Number(r.cerradas || 0) <= 0) return false;
    }

    return true;
  });

  // Mapeo en vivo de historias EN PROGRESO respetando los filtros activos (fechas, sedes, etc.)
  // Regla absoluta: Para el Histórico de Registros en Progreso, la comparación se hace
  // ÚNICAMENTE sobre las historias con estado 'En progreso' vs el total de registros presentados por el médico.
  const liveMedsPendMap = {};
  const liveSedesPendMap = {};
  if (Array.isArray(activePendingItems) && activePendingItems.length > 0) {
    const filteredPending = getFilteredSubsetExcept(activePendingItems, filters, null);
    filteredPending.forEach(it => {
      const phcNorm = removeAccents(String(it.estado_phc || "")).toLowerCase().trim();
      const fbNorm = removeAccents(String(it.estado_fb || "")).toLowerCase().trim();
      const isEnProgreso = phcNorm === "en progreso" || fbNorm === "historia en progreso";

      if (isEnProgreso) {
        const p = String(it.profesional || "").trim();
        if (p) liveMedsPendMap[p] = (liveMedsPendMap[p] || 0) + 1;
        const s = isProgramaEspecialistas(it.programa) ? "Especialistas" : normalizeSedeName(it.sede || "");
        if (s) liveSedesPendMap[s] = (liveSedesPendMap[s] || 0) + 1;
      }
    });
  }
  const hasLivePending = Array.isArray(activePendingItems) && activePendingItems.length > 0;

  // Agrupar Médicos
  const medMap = {};
  const cedMap = (data.filter_options && data.filter_options.user_cedula_map) || {};
  filteredMedicos.forEach(r => {
    const prof = String(r["NOMBRE PROFESIONAL"] || "Desconocido").trim();
    const isEspProg = isProgramaEspecialistas(r["PROGRAMA"]);
    const effectiveSede = isEspProg ? "Especialistas" : normalizeSedeName(r["NOMBRE IPS"] || "");
    if (!medMap[prof]) {
      medMap[prof] = {
        "NOMBRE PROFESIONAL": prof,
        "NOMBRE IPS": effectiveSede,
        total: 0,
        pendientes: 0,
        cerradas: 0,
        identificacion: r["id_medico"] || cedMap[prof] || cedMap[toNomPropio(prof)] || (typeof userCedulaMap !== "undefined" ? userCedulaMap[prof] : "") || ""
      };
    }
    medMap[prof].total += Number(r.total || 0);
    medMap[prof].pendientes += Number(r.pendientes || 0);
    medMap[prof].cerradas += Number(r.cerradas !== undefined ? r.cerradas : Math.max(0, (r.total || 0) - (r.pendientes || 0)));
  });

  const demoraMedicos = Object.values(medMap).map(m => {
    const pName = m["NOMBRE PROFESIONAL"];
    if (hasLivePending) {
      const liveCount = (liveMedsPendMap[pName] !== undefined)
        ? liveMedsPendMap[pName]
        : (liveMedsPendMap[toNomPropio(pName)] !== undefined ? liveMedsPendMap[toNomPropio(pName)] : 0);
      m.pendientes = liveCount;
    }
    // Coherencia lógica: las historias pendientes de un período nunca pueden superar las citas asignadas de ese período
    if (m.total < m.pendientes) {
      m.total = m.pendientes;
    }
    m.cerradas = Math.max(0, m.total - m.pendientes);
    m.pct_demora = m.total > 0 ? (Math.round((m.pendientes / m.total) * 1000) / 10) : 0;
    m.pct_cerradas = m.total > 0 ? (Math.round((100.0 - m.pct_demora) * 10) / 10) : 100.0;
    return m;
  }).sort((a, b) => b.pendientes - a.pendientes);

  // Agrupar Sedes dinámicamente desde filteredMedicos para responder con precisión
  // a filtros de Médico, Programa, Especialistas y Fechas
  const sedesMap = {};
  filteredMedicos.forEach(r => {
    const isEspProg = isProgramaEspecialistas(r["PROGRAMA"]);
    const sName = isEspProg ? "Especialistas" : normalizeSedeName(r["NOMBRE IPS"] || "Desconocida");
    if (!sedesMap[sName]) {
      sedesMap[sName] = {
        "NOMBRE IPS": sName,
        total: 0,
        pendientes: 0,
        cerradas: 0
      };
    }
    sedesMap[sName].total += Number(r.total || 0);
    sedesMap[sName].pendientes += Number(r.pendientes || 0);
    sedesMap[sName].cerradas += Number(r.cerradas !== undefined ? r.cerradas : Math.max(0, (r.total || 0) - (r.pendientes || 0)));
  });

  const demoraSedes = Object.values(sedesMap).map(s => {
    const sName = s["NOMBRE IPS"];
    if (hasLivePending) {
      const liveCount = liveSedesPendMap[sName] !== undefined ? liveSedesPendMap[sName] : 0;
      s.pendientes = liveCount;
    }
    if (s.total < s.pendientes) {
      s.total = s.pendientes;
    }
    s.cerradas = Math.max(0, s.total - s.pendientes);
    s.pct_demora = s.total > 0 ? (Math.round((s.pendientes / s.total) * 1000) / 10) : 0;
    s.pct_cerradas = s.total > 0 ? (Math.round((100.0 - s.pct_demora) * 10) / 10) : 100.0;
    return s;
  }).sort((a, b) => b.pendientes - a.pendientes);

  // Agrupar Meses dinámicamente desde filteredMedicos
  const mesOrder = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const mesesMap = {};
  filteredMedicos.forEach(r => {
    const mes = String(r["Nombre del mes"] || "").trim().toLowerCase();
    const ano = String(r["Año"] || r["Ao"] || r["A\u00f1o"] || "2026");
    const key = `${ano}_${mes}`;
    if (!mesesMap[key]) {
      mesesMap[key] = {
        "Nombre del mes": mes,
        "Año": ano,
        total: 0,
        pendientes: 0,
        cerradas: 0,
        order: mesOrder.indexOf(mes) >= 0 ? mesOrder.indexOf(mes) : 99
      };
    }
    mesesMap[key].total += Number(r.total || 0);
    mesesMap[key].pendientes += Number(r.pendientes || 0);
    mesesMap[key].cerradas += Number(r.cerradas !== undefined ? r.cerradas : Math.max(0, (r.total || 0) - (r.pendientes || 0)));
  });

  const demoraMeses = Object.values(mesesMap).map(m => {
    m.cerradas = Math.max(0, m.total - m.pendientes);
    m.pct_demora = m.total > 0 ? (Math.round((m.pendientes / m.total) * 1000) / 10) : 0;
    m.pct_cerradas = m.total > 0 ? (Math.round((100.0 - m.pct_demora) * 10) / 10) : 100.0;
    return m;
  }).sort((a, b) => a.order - b.order);

  const totAsig = filteredMedicos.reduce((acc, r) => acc + Number(r.total || 0), 0);
  const totPend = filteredMedicos.reduce((acc, r) => acc + Number(r.pendientes || 0), 0);
  const totCerr = filteredMedicos.reduce((acc, r) => acc + Number(r.cerradas !== undefined ? r.cerradas : Math.max(0, (r.total || 0) - (r.pendientes || 0))), 0);
  const pctDemoraGlob = totAsig > 0 ? (Math.round((totPend / totAsig) * 1000) / 10) : 0;
  const pctCerradasGlob = totAsig > 0 ? (Math.round((100.0 - pctDemoraGlob) * 10) / 10) : 100.0;

  return {
    medicos: demoraMedicos,
    sedes: demoraSedes,
    meses: demoraMeses,
    totales: {
      total_asignadas: totAsig,
      total_pendientes: totPend,
      total_cerradas: totCerr,
      pct_demora: pctDemoraGlob,
      pct_cerradas: pctCerradasGlob
    }
  };
}

function computeAvanceAuditoriasMetrics(allItemsUnfiltered, localFbStore, filters) {
  const allFb = Object.values(localFbStore || {});
  const apptLookup = {};
  if (Array.isArray(allItemsUnfiltered)) {
    allItemsUnfiltered.forEach(it => {
      if (it && it.id_cita) apptLookup[String(it.id_cita)] = it;
    });
  }

  // Pre-procesar conjuntos de filtros activos
  const sedeFilterList = (Array.isArray(filters.sede) ? filters.sede : (filters.sede ? [filters.sede] : []))
    .map(s => removeAccents(normalizeSedeName(s)))
    .filter(s => s && s !== "todas" && s !== "todos");

  const progFilterList = (Array.isArray(filters.programa) ? filters.programa : (filters.programa ? [filters.programa] : []))
    .map(p => removeAccents(p))
    .filter(p => p && p !== "todas" && p !== "todos");

  const profFilterList = (Array.isArray(filters.profesional) ? filters.profesional : (filters.profesional ? [filters.profesional] : []))
    .map(p => removeAccents(String(p).trim()))
    .filter(p => p && p !== "todas" && p !== "todos");

  const estadoPhcFilterList = (Array.isArray(filters.estado_phc) ? filters.estado_phc : (filters.estado_phc ? [filters.estado_phc] : []))
    .map(e => removeAccents(String(e).trim()))
    .filter(e => e && e !== "todas" && e !== "todos");

  const anoFilterList = (Array.isArray(filters.ano) ? filters.ano : (filters.ano ? [filters.ano] : []))
    .map(a => String(a).trim())
    .filter(a => a && a.toLowerCase() !== "todos");

  const mesFilterList = (Array.isArray(filters.mes) ? filters.mes : (filters.mes ? [filters.mes] : []))
    .map(m => removeAccents(String(m).trim().toLowerCase()))
    .filter(m => m && m !== "todas" && m !== "todos");

  const diaFilterList = (Array.isArray(filters.dia) ? filters.dia : (filters.dia ? [filters.dia] : []))
    .map(d => parseInt(d, 10))
    .filter(d => !isNaN(d));

  const quinFilterList = (Array.isArray(filters.quincena) ? filters.quincena : (filters.quincena ? [filters.quincena] : []))
    .map(q => removeAccents(String(q).trim().toLowerCase()))
    .filter(q => q && q !== "todas" && q !== "todos");

  function matchesFilter(recordSede, recordProg, recordProf, recordDoc, recordPhc, recordFechaStr) {
    const isEsp = isProgramaEspecialistas(recordProg);
    const sNorm = removeAccents(normalizeSedeName(isEsp ? "Especialistas" : recordSede));
    if (sedeFilterList.length > 0) {
      const matchSede = sedeFilterList.some(s => (s === "especialistas" && (isEsp || sNorm === "especialistas")) || s === sNorm);
      if (!matchSede) return false;
    }

    if (progFilterList.length > 0) {
      const pNorm = removeAccents(sanitizeProgramaName(recordProg));
      const matchProg = progFilterList.some(p => p === pNorm || pNorm.includes(p) || p.includes(pNorm));
      if (!matchProg) return false;
    }

    if (profFilterList.length > 0) {
      const prNorm = removeAccents(String(recordProf || "").trim());
      const dRaw = String(recordDoc || "").trim();
      const matchProf = profFilterList.some(p => p === prNorm || prNorm.includes(p) || (dRaw && dRaw === p));
      if (!matchProf) return false;
    }

    if (estadoPhcFilterList.length > 0) {
      const phcNorm = removeAccents(String(recordPhc || "").trim());
      const matchEst = estadoPhcFilterList.some(e => phcNorm.includes(e));
      if (!matchEst) return false;
    }

    // Fechas de atención clínica
    const isoDate = parseIsoDate(recordFechaStr);
    if (filters.dateFrom && isoDate && isoDate < filters.dateFrom) return false;
    if (filters.dateTo && isoDate && isoDate > filters.dateTo) return false;

    if (anoFilterList.length > 0 || mesFilterList.length > 0 || diaFilterList.length > 0 || quinFilterList.length > 0) {
      const dp = parseDateParts(recordFechaStr);
      if (dp) {
        if (anoFilterList.length > 0 && !anoFilterList.includes(String(dp.ano))) return false;
        if (mesFilterList.length > 0) {
          const mNorm = removeAccents(String(dp.mesName || "").toLowerCase());
          if (!mesFilterList.includes(mNorm)) return false;
        }
        if (diaFilterList.length > 0 && !diaFilterList.includes(dp.dia)) return false;
        if (quinFilterList.length > 0) {
          const is1Q = dp.dia <= 15;
          const match1Q = quinFilterList.some(q => q.includes("1ra") || q.includes("primera")) && is1Q;
          const match2Q = quinFilterList.some(q => q.includes("2da") || q.includes("segunda")) && !is1Q;
          if (!match1Q && !match2Q) return false;
        }
      } else {
        return false;
      }
    }
    return true;
  }

  const monthsMap = {};
  const sedesMap = {};
  const auditedCidSet = new Set();

  // 1. Acumular Auditorías Realizadas (Auditadas / Gestionadas)
  allFb.forEach(fb => {
    if (!fb || !fb.id_cita) return;
    const cid = String(fb.id_cita);
    const aud = String(fb.auditor || "").trim();
    if (cid.startsWith("test_") || cid.startsWith("TEST_") || aud === "Test Runner" || aud.toLowerCase().includes("prueba")) {
      return;
    }

    const appt = apptLookup[cid] || null;
    const prog = fb.programa || (appt ? appt.programa : "");
    const isEsp = isProgramaEspecialistas(prog);
    const sede = isEsp ? "Especialistas" : (fb.sede || (appt ? appt.sede : "Desconocida"));
    const prof = fb.nombre_profesional || (appt ? appt.profesional : "");
    const doc = fb.id_profesional || (appt ? (appt.cedula_profesional || appt.id_profesional) : "");
    const phc = fb.estado_phc || (appt ? appt.estado_phc : "") || "Confirmada";
    // Para historias correspondientes al mes, la fecha de referencia es la fecha de atención médica
    const fechaAtencion = fb.fecha_cita || (appt ? (appt.fecha || appt.fecha_cita) : "") || fb.fecha_gestion || "";

    if (!matchesFilter(sede, prog, prof, doc, phc, fechaAtencion)) return;

    auditedCidSet.add(cid);

    const sName = isEsp ? "Especialistas" : (normalizeSedeName(sede) || "Desconocida");
    if (!sedesMap[sName]) {
      sedesMap[sName] = { "NOMBRE IPS": sName, sede: sName, gestionadas: 0, sin_auditar: 0, pendientes: 0, total: 0, pct_gestion: 0 };
    }
    sedesMap[sName].gestionadas++;

    const dp = parseDateParts(fechaAtencion);
    const monthName = dp && dp.mesName ? dp.mesName : "desconocido";
    const monthIdx = dp && dp.mesNum ? (dp.mesNum - 1) : 99;
    if (!monthsMap[monthName]) {
      monthsMap[monthName] = { "Nombre del mes": monthName, gestionadas: 0, sin_auditar: 0, pendientes: 0, total: 0, order: monthIdx };
    }
    monthsMap[monthName].gestionadas++;
  });

  // 2. Acumular Historias Pendientes Sin Auditar presentadas desde la base de datos
  if (Array.isArray(allItemsUnfiltered)) {
    allItemsUnfiltered.forEach(it => {
      if (!it) return;
      const cid = String(it.id_cita || "");
      if (auditedCidSet.has(cid)) return;

      const stFb = it.estado_fb || "";
      if (stFb && stFb !== "Sin Auditar" && stFb !== "Sin Gestión") return;

      const prog = it.programa || "";
      const isEsp = isProgramaEspecialistas(prog);
      const sede = isEsp ? "Especialistas" : (it.sede || "Desconocida");
      const prof = it.profesional || "";
      const doc = it.cedula_profesional || it.id_profesional || "";
      const phc = it.estado_phc || "Confirmada";
      const fechaAtencion = it.fecha || it.fecha_cita || "";

      if (!matchesFilter(sede, prog, prof, doc, phc, fechaAtencion)) return;

      const sName = isEsp ? "Especialistas" : (normalizeSedeName(sede) || "Desconocida");
      if (!sedesMap[sName]) {
        sedesMap[sName] = { "NOMBRE IPS": sName, sede: sName, gestionadas: 0, sin_auditar: 0, pendientes: 0, total: 0, pct_gestion: 0 };
      }
      sedesMap[sName].sin_auditar++;

      const dp = parseDateParts(fechaAtencion);
      const monthName = dp && dp.mesName ? dp.mesName : "desconocido";
      const monthIdx = dp && dp.mesNum ? (dp.mesNum - 1) : 99;
      if (!monthsMap[monthName]) {
        monthsMap[monthName] = { "Nombre del mes": monthName, gestionadas: 0, sin_auditar: 0, pendientes: 0, total: 0, order: monthIdx };
      }
      monthsMap[monthName].sin_auditar++;
    });
  }

  // 3. Formatear y ordenar resultados
  const SPANISH_MONTH_ORDER = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const avanceMeses = Object.values(monthsMap).map(m => {
    m.total = m.gestionadas + m.sin_auditar;
    m.pendientes = m.total;
    m.pct_gestion = m.total > 0 ? (Math.round((m.gestionadas / m.total) * 1000) / 10) : 0;
    return m;
  }).sort((a, b) => {
    const idxA = SPANISH_MONTH_ORDER.indexOf(a["Nombre del mes"].toLowerCase());
    const idxB = SPANISH_MONTH_ORDER.indexOf(b["Nombre del mes"].toLowerCase());
    return (idxA >= 0 ? idxA : 99) - (idxB >= 0 ? idxB : 99);
  });

  const avanceSedes = Object.values(sedesMap).map(s => {
    s.total = s.gestionadas + s.sin_auditar;
    s.pendientes = s.total;
    s.pct_gestion = s.total > 0 ? (Math.round((s.gestionadas / s.total) * 1000) / 10) : 0;
    return s;
  }).filter(s => s.total > 0).sort((a, b) => {
    const diffPct = (b.pct_gestion || 0) - (a.pct_gestion || 0);
    if (Math.abs(diffPct) > 0.0001) return diffPct;
    const diffAud = (b.gestionadas || 0) - (a.gestionadas || 0);
    if (diffAud !== 0) return diffAud;
    return (b.total || 0) - (a.total || 0);
  });

  return {
    meses: avanceMeses,
    sedes: avanceSedes
  };
}

function applyClientFiltersToData(data, filters) {
  if (!data || !filters) return data;

  const allItemsUnfiltered = data.detalle_pendientes || [];

  // Sanitizar nombres de programas y combinar auditorías guardadas en esta sesión/navegador
  allItemsUnfiltered.forEach(item => {
    if (item.programa) {
      item.programa = sanitizeProgramaName(item.programa);
    }
    const lfb = localFeedbackStore[String(item.id_cita)];
    if (lfb) {
      if (lfb.estado_phc) {
        item.estado_phc = lfb.estado_phc;
        item._phcNorm = removeAccents(lfb.estado_phc);
      }
      item.estado_fb = lfb.estado;
      if (lfb.nota_aclaratoria) item.nota_aclaratoria = lfb.nota_aclaratoria;
      if (lfb.observacion) item.observacion_fb = lfb.observacion;
      if (lfb.auditor) item.auditor_fb = lfb.auditor;
      if (lfb.fecha_gestion) item.fecha_fb = lfb.fecha_gestion;
      if (lfb.historial) item.historial = lfb.historial;
    }
    if (!item.estado_phc || item.estado_phc === "Sin Registro") {
      item.estado_phc = "Confirmada";
      item._phcNorm = "confirmada";
    } else {
      item._phcNorm = removeAccents(item.estado_phc);
    }
  });

  // Excluir de los indicadores, gráficos y tablas de pendientes aquellas citas auditadas con notas de resolución/aclaración
  const activePendingItems = allItemsUnfiltered.filter(item => !isResolvedAuditState(item.estado_fb, item.estado_phc));

  const dynamicFilterOptions = computeDynamicFilterOptions(activePendingItems, filters, data.filter_options ? data.filter_options.user_cedula_map : {});
  if (data.filter_options && data.filter_options.auditores) {
    dynamicFilterOptions.auditores = data.filter_options.auditores;
  }

  let items = getFilteredSubsetExcept(activePendingItems, filters, null);

  const totalPend = items.length;

  let totalGest = 0;
  let totalProg = 0;

  // Al generar cualquier filtro, las tablas y tarjetas se adaptan responsivamente al dato filtrado
  const itemsForSedes = items;

  const sedesMap = {};
  itemsForSedes.forEach(it => {
    const sName = isProgramaEspecialistas(it.programa) ? "Especialistas" : (normalizeSedeName(it.sede) || "Desconocida");
    const isGest = !!(it.estado_fb && it.estado_fb !== "Sin Gestión" && it.estado_fb !== "Sin Auditar");
    const isProg = it.estado_fb === "Historia en progreso" ||
      it.estado_fb === "Paciente confirmado sin evidencia de historia ni notas aclaratorias" ||
      it.estado_fb === "Historia pendiente por caída del sistema";

    if (!sedesMap[sName]) {
      sedesMap[sName] = { "NOMBRE IPS": sName, pendientes: 0, gestionadas: 0, en_progreso: 0, sin_auditar: 0, pct_gestion: 0 };
    }
    sedesMap[sName].pendientes += 1;
    if (isGest) sedesMap[sName].gestionadas += 1;
    if (isProg) sedesMap[sName].en_progreso += 1;
  });

  const sedesSummary = Object.values(sedesMap).map(s => {
    s.sin_auditar = Math.max(0, s.pendientes - s.gestionadas);
    s.pct_gestion = s.pendientes > 0 ? (Math.round(s.gestionadas / s.pendientes * 1000) / 10) : 0;
    return s;
  }).sort((a, b) => b.pendientes - a.pendientes);

  // Para sedesChart (gráfico SEDES PENDIENTES): debe responder al filtro de sede seleccionado
  // Si el usuario filtra por una sede (ej. 'Saman - Ciami'), el gráfico muestra exclusivamente esa sede.
  const sedesChartMap = {};
  items.forEach(it => {
    const sName = isProgramaEspecialistas(it.programa) ? "Especialistas" : (normalizeSedeName(it.sede) || "Desconocida");
    const isGest = !!(it.estado_fb && it.estado_fb !== "Sin Gestión" && it.estado_fb !== "Sin Auditar");
    const isProg = it.estado_fb === "Historia en progreso" ||
      it.estado_fb === "Paciente confirmado sin evidencia de historia ni notas aclaratorias" ||
      it.estado_fb === "Historia pendiente por caída del sistema";

    if (!sedesChartMap[sName]) {
      sedesChartMap[sName] = { "NOMBRE IPS": sName, sede: sName, pendientes: 0, gestionadas: 0, en_progreso: 0, sin_auditar: 0, pct_gestion: 0 };
    }
    sedesChartMap[sName].pendientes += 1;
    if (isGest) sedesChartMap[sName].gestionadas += 1;
    if (isProg) sedesChartMap[sName].en_progreso += 1;
  });

  const sedesChart = Object.values(sedesChartMap).map(s => {
    s.sin_auditar = Math.max(0, s.pendientes - s.gestionadas);
    s.pct_gestion = s.pendientes > 0 ? (Math.round(s.gestionadas / s.pendientes * 1000) / 10) : 0;
    return s;
  }).sort((a, b) => b.pendientes - a.pendientes);

  const totalSin = Math.max(0, totalPend - totalGest);
  const pctCob = totalPend > 0 ? (Math.round(totalGest / totalPend * 1000) / 10) : 0;

  // Al generar cualquier filtro, las tablas y tarjetas se adaptan responsivamente al dato filtrado
  const itemsForMedicos = items;

  const cedMap = (data && data.filter_options && data.filter_options.user_cedula_map) || {};
  const medicosMap = {};
  itemsForMedicos.forEach(it => {
    const pName = it.profesional || "Desconocido";
    if (!medicosMap[pName]) {
      const docCedula = cedMap[pName] || cedMap[toNomPropio(pName)] || userCedulaMap[pName] || userCedulaMap[toNomPropio(pName)] || it.cedula_profesional || "";
      medicosMap[pName] = {
        "NOMBRE PROFESIONAL": pName,
        identificacion: docCedula,
        "NOMBRE IPS": isProgramaEspecialistas(it.programa) ? "Especialistas" : (normalizeSedeName(it.sede) || ""),
        pendientes: 0,
        pct_pendientes: 0
      };
    }
    medicosMap[pName].pendientes += 1;
  });
  const medicosPending = Object.values(medicosMap).sort((a, b) => b.pendientes - a.pendientes);

  const progsMap = {};
  items.forEach(it => {
    const pName = it.programa || "Sin Programa";
    progsMap[pName] = (progsMap[pName] || 0) + 1;
  });
  const programasChart = Object.entries(progsMap)
    .map(([PROGRAMA, count]) => ({ PROGRAMA, count }))
    .sort((a, b) => b.count - a.count);

  const treeMap = {};

  items.forEach(it => {
    const dp = parseDateParts(it.fecha);
    if (dp) {
      const dayNum = dp.dia;
      const monthIdx = dp.mesNum - 1;
      const monthName = dp.mesName || "desconocido";
      const isGest = !!(it.estado_fb && it.estado_fb !== "Sin Gestión" && it.estado_fb !== "Sin Auditar");

      if (!treeMap[monthName]) {
        treeMap[monthName] = { mes: monthName, total_pendientes: 0, gestionadas: 0, diasMap: {}, order: monthIdx };
      }
      treeMap[monthName].total_pendientes += 1;
      if (isGest) {
        treeMap[monthName].gestionadas = (treeMap[monthName].gestionadas || 0) + 1;
      }

      if (!treeMap[monthName].diasMap[dayNum]) {
        treeMap[monthName].diasMap[dayNum] = { fecha_fmt: it.fecha, dia_num: dayNum, pendientes: 0, gestionadas: 0 };
      }
      treeMap[monthName].diasMap[dayNum].pendientes += 1;
      if (isGest) {
        treeMap[monthName].diasMap[dayNum].gestionadas = (treeMap[monthName].diasMap[dayNum].gestionadas || 0) + 1;
      }
    }
  });

  const fechasTree = Object.values(treeMap)
    .sort((a, b) => a.order - b.order)
    .map(mObj => {
      const diasList = Object.values(mObj.diasMap).sort((a, b) => a.dia_num - b.dia_num);
      return {
        mes: mObj.mes,
        total_pendientes: mObj.total_pendientes,
        gestionadas: mObj.gestionadas || 0,
        sin_auditar: Math.max(0, mObj.total_pendientes - (mObj.gestionadas || 0)),
        dias: diasList
      };
    });

  const mesesChart = fechasTree.map(m => ({
    "Nombre del mes": m.mes,
    "pendientes": m.total_pendientes,
    "gestionadas": m.gestionadas || 0,
    "sin_auditar": Math.max(0, m.total_pendientes - (m.gestionadas || 0)),
    "pct_pendientes": 0.0
  }));

  const demoraMetrics = computeDemoraMetricsFromData(data, filters, activePendingItems);
  const avanceMetrics = computeAvanceAuditoriasMetrics(allItemsUnfiltered, localFeedbackStore, filters);

  return {
    ...data,
    filter_options: dynamicFilterOptions,
    kpis: {
      pendientes: totalPend,
      gestionadas: totalGest,
      en_progreso: totalProg,
      sin_auditar: totalSin,
      pct_cobertura: pctCob
    },
    sedes_summary: sedesSummary,
    sedes_chart: sedesChart,
    medicos_pending: medicosPending,
    fechas_tree: fechasTree,
    programas_chart: programasChart,
    meses_chart: mesesChart,
    avance_auditorias_meses: avanceMetrics.meses,
    avance_auditorias_sedes: avanceMetrics.sedes,
    detalle_pendientes: items,
    demora_medicos: demoraMetrics.medicos,
    demora_sedes: demoraMetrics.sedes,
    demora_meses: demoraMetrics.meses,
    demora_totales: demoraMetrics.totales
  };
}



var cachedDashboardByPeriodo = {};

// --- OBTENER DATOS DE LA API ---
async function fetchDashboardData(forceRefresh = false) {
  // Carga inmediata de auditorías guardadas en localhost si aún no se han cargado
  if (isLocalhost && Object.keys(localFeedbackStore).length === 0) {
    try {
      const fbRes = await fetch("/api/feedback");
      if (fbRes.ok) {
        const fbJson = await fbRes.json();
        if (fbJson && typeof fbJson === "object") {
          Object.assign(localFeedbackStore, fbJson);
        }
      }
    } catch (e) { }
  }

  const pVal = currentFilters.periodo || "ultimo_mes";

  if (!forceRefresh && cachedDashboardByPeriodo[pVal]) {
    rawDashboardData = cachedDashboardByPeriodo[pVal];
    const detectedRange = computeLatestMonthDateRange(rawDashboardData);
    dynamicLatestMonthRange = detectedRange;
    if (!userHasCustomDateFilter && detectedRange && detectedRange.dateFrom) {
      currentFilters.dateFrom = detectedRange.dateFrom;
      currentFilters.dateTo = detectedRange.dateTo;
      const df = document.getElementById("dateFrom");
      const dt = document.getElementById("dateTo");
      if (df) df.value = detectedRange.dateFrom;
      if (dt) dt.value = detectedRange.dateTo;
    }
    renderCurrentDataState();
    return;
  }

  let rawData = null;

  // 1. Consultar archivos de datos (en GitHub Pages vía CDN o archivos estáticos locales)
  const pathsToTry = [
    `./static/api/dashboard_${pVal}.json`,
    `static/api/dashboard_${pVal}.json`,
    `/static/api/dashboard_${pVal}.json`,
    `./api/dashboard_${pVal}.json`,
    `/api/dashboard_${pVal}.json`,
    `./api/dashboard.json`,
    `/api/dashboard.json`
  ];
  for (const path of pathsToTry) {
    try {
      const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json && json.sedes_summary) {
          rawData = json;
          rawData.data_source = isLocalhost ? "Caché SQL Server (172.200.6.135)" : "Datos de Historias Clínicas (AGENDAWEB)";
          break;
        }
      }
    } catch (e) { }
  }

  // 2. Si estamos en localhost y no hubo archivo estático, intentar servidor dinámico local
  if (!rawData && isLocalhost) {
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: { periodo: pVal } })
      });
      if (res.ok) {
        rawData = await res.json();
        rawData.data_source = "Servidor Local Dinámico (SQL Server)";
      }
    } catch (err) { }
  }

  if (!rawData) {
    console.warn(`No se pudieron cargar datos para el periodo '${pVal}'.`);
    const tbody = document.querySelector("#tblDetalle tbody");
    if (tbody && !rawDashboardData) {
      tbody.innerHTML = '<tr><td colspan="12" class="center">No fue posible conectar con los datos. Por favor verifique su conexión o recargue la página.</td></tr>';
    }
    return;
  }
  rawData = sanitizeRawDashboardData(rawData);
  cachedDashboardByPeriodo[pVal] = rawData;
  rawDashboardData = rawData;

  // Calcular dinámicamente el rango del último mes disponible en el conjunto de datos
  const detectedRange = computeLatestMonthDateRange(rawData);
  dynamicLatestMonthRange = detectedRange;

  if (!userHasCustomDateFilter && detectedRange && detectedRange.dateFrom) {
    currentFilters.dateFrom = detectedRange.dateFrom;
    currentFilters.dateTo = detectedRange.dateTo;
    const df = document.getElementById("dateFrom");
    const dt = document.getElementById("dateTo");
    if (df) df.value = detectedRange.dateFrom;
    if (dt) dt.value = detectedRange.dateTo;
  }

  renderCurrentDataState();

  // Sincronizar en vivo auditorías desde Google Sheets relacionando por ID Cita
  syncLiveFeedbackFromGoogleSheets();
}

function renderCurrentDataState() {
  if (!rawDashboardData) return;
  let data = applyClientFiltersToData(rawDashboardData, currentFilters);

  // Auto-validación de filtros contra las opciones dinámicas del dataset actual:
  // Si se cambió de período o un filtro previo ya no existe en los datos, limpiarlo
  // Auto-validación de filtros contra las opciones dinámicas del dataset actual:
  // Si se cambió de período o un filtro previo ya no existe en los datos, filtrarlo
  if (data.filter_options) {
    let reapply = false;
    if (Array.isArray(currentFilters.mes) && currentFilters.mes.length > 0 && data.filter_options.meses) {
      const validMeses = new Set(data.filter_options.meses.map(m => m.toLowerCase()));
      const filtered = currentFilters.mes.filter(m => validMeses.has(m.toLowerCase()));
      if (filtered.length !== currentFilters.mes.length) {
        currentFilters.mes = filtered;
        reapply = true;
      }
    }
    if (Array.isArray(currentFilters.dia) && currentFilters.dia.length > 0 && data.filter_options.dias) {
      const validDias = new Set(data.filter_options.dias.map(Number));
      const filtered = currentFilters.dia.filter(d => validDias.has(Number(d)));
      if (filtered.length !== currentFilters.dia.length) {
        currentFilters.dia = filtered;
        reapply = true;
      }
    }
    if (Array.isArray(currentFilters.ano) && currentFilters.ano.length > 0 && data.filter_options.anos) {
      const validAnos = new Set(data.filter_options.anos.map(String));
      const filtered = currentFilters.ano.filter(a => validAnos.has(String(a)));
      if (filtered.length !== currentFilters.ano.length) {
        currentFilters.ano = filtered;
        reapply = true;
      }
    }
    if (Array.isArray(currentFilters.estado_phc) && currentFilters.estado_phc.length > 0 && data.filter_options.estados_phc) {
      const validEstados = new Set(data.filter_options.estados_phc.map(e => removeAccents(e)));
      const filtered = currentFilters.estado_phc.filter(e => validEstados.has(removeAccents(e)));
      if (filtered.length !== currentFilters.estado_phc.length) {
        currentFilters.estado_phc = filtered;
        reapply = true;
      }
    }
    if (reapply) {
      data = applyClientFiltersToData(rawDashboardData, currentFilters);
    }
  }

  try { renderKpiCards(data); } catch (e) { console.error("Error KPI cards:", e); }
  try { updateHeaderMeta(data.data_source, data.last_update_info); } catch (e) { console.error("Error header meta:", e); }
  try { updateFilterOptions(data.filter_options || rawDashboardData.filter_options); } catch (e) { console.error("Error filter options:", e); }

  try { renderActiveFilterChips(); } catch (e) { console.error("Error filter chips:", e); }

  try { renderTblSedes(data.sedes_summary); } catch (e) { console.error("Error tbl sedes:", e); }
  try { renderTblMedicos(data.medicos_pending); } catch (e) { console.error("Error tbl medicos:", e); }
  try { renderTreeView(data.fechas_tree, data.kpis ? data.kpis.pendientes : 0); } catch (e) { console.error("Error tree view:", e); }

  currentDetalleData = data.detalle_pendientes || [];
  try { applyClientSearchAndPaginate(); } catch (e) { console.error("Error detalle paginate:", e); }

  try {
    renderChartProgramas(data.programas_chart);
  } catch (e) { console.error("Error chart programas:", e); }

  try {
    renderChartSedesPct(data.sedes_chart || data.sedes_summary);
  } catch (e) { console.error("Error chart sedes:", e); }

  try {
    renderChartMeses(data.meses_chart);
  } catch (e) { console.error("Error chart meses:", e); }

  try {
    renderChartAvanceAuditoriasSedes(data.avance_auditorias_sedes || data.sedes_chart || data.sedes_summary);
  } catch (e) { console.error("Error chart avance sedes:", e); }

  try {
    renderChartAvanceAuditoriasMeses(data.avance_auditorias_meses || data.meses_chart);
  } catch (e) { console.error("Error chart avance meses:", e); }

  try {
    updateDashboardModalKPIs();
  } catch (e) { }

  try {
    updateDashboardAnalyticsView(data);
  } catch (e) { console.error("Error dashboard analytics view:", e); }
}

async function syncLiveFeedbackFromGoogleSheets(isManual = false) {
  if (!OFFICIAL_APPS_SCRIPT_URL) return 0;
  try {
    const res = await fetch(`${OFFICIAL_APPS_SCRIPT_URL}?action=get_all_feedback`);
    if (!res.ok) return 0;
    const json = await res.json();
    if (json && json.result === "success" && Array.isArray(json.records)) {
      let updatedCount = 0;
      const remoteMap = {};
      const newLocalStore = { ...localFeedbackStore };
      const apptLookup = {};
      if (rawDashboardData && Array.isArray(rawDashboardData.detalle_pendientes)) {
        rawDashboardData.detalle_pendientes.forEach(item => {
          if (item && item.id_cita) apptLookup[String(item.id_cita)] = item;
        });
      }

      json.records.forEach(r => {
        if (r.id_cita) {
          const cid = String(r.id_cita).trim();
          const aud = String(r.auditor || "").trim();
          // Excluir registros de prueba
          if (cid.startsWith("test_") || cid.startsWith("TEST_") || aud === "Test Runner" || aud.toLowerCase().includes("prueba")) {
            return;
          }
          const prev = localFeedbackStore[cid] || {};
          const appt = apptLookup[cid] || null;

          const itemObj = {
            ...prev,
            id_cita: cid,
            estado: r.estado || prev.estado,
            nota_aclaratoria: r.nota_aclaratoria || r.estado || prev.nota_aclaratoria || prev.estado,
            estado_phc: (r.estado_phc !== undefined && r.estado_phc !== null) ? r.estado_phc : (prev.estado_phc || ""),
            observacion: (r.observacion !== undefined && r.observacion !== null) ? r.observacion : (prev.observacion || ""),
            auditor: r.auditor || prev.auditor || "",
            fecha_gestion: r.fecha_gestion || prev.fecha_gestion || "",
            cedula_auditor: r.cedula_auditor || prev.cedula_auditor || "",
            ip_equipo: r.ip_equipo || prev.ip_equipo || "",
            usuario_pc: r.usuario_pc || prev.usuario_pc || "",
            nombre_equipo: r.nombre_equipo || prev.nombre_equipo || "",
            sede: r.sede || prev.sede || (appt ? appt.sede : "") || "",
            fecha_cita: r.fecha_cita || prev.fecha_cita || (appt ? (appt.fecha || appt.fecha_cita) : "") || "",
            hora_cita: r.hora_cita || prev.hora_cita || (appt ? appt.hora_cita : "") || "",
            programa: r.programa || prev.programa || (appt ? appt.programa : "") || "",
            id_profesional: r.id_profesional || prev.id_profesional || (appt ? (appt.cedula_profesional || appt.id_profesional) : "") || "",
            nombre_profesional: r.nombre_profesional || prev.nombre_profesional || (appt ? appt.profesional : "") || "",
            synced: true
          };
          remoteMap[cid] = itemObj;
          newLocalStore[cid] = itemObj;
        }
      });

      // Conservar gestiones locales pendientes de sincronizar
      Object.entries(localFeedbackStore).forEach(([k, v]) => {
        if (v && v.synced === false && !newLocalStore[k]) {
          newLocalStore[k] = v;
        }
      });

      localFeedbackStore = newLocalStore;
      try {
        localStorage.setItem("agendaweb_local_feedbacks", JSON.stringify(localFeedbackStore));
      } catch (e) { }

      if (rawDashboardData && rawDashboardData.detalle_pendientes) {
        rawDashboardData.detalle_pendientes.forEach(item => {
          const r = remoteMap[String(item.id_cita)];
          if (r) {
            const hasChanged = (item.estado_phc !== r.estado_phc) ||
              (item.estado_fb !== r.estado) ||
              (item.nota_aclaratoria !== (r.nota_aclaratoria || r.estado)) ||
              (item.observacion_fb !== (r.observacion || "")) ||
              (item.auditor_fb !== (r.auditor || ""));
            if (r.estado_phc) {
              item.estado_phc = r.estado_phc;
              item._phcNorm = removeAccents(r.estado_phc);
            }
            item.estado_fb = r.estado;
            item.nota_aclaratoria = r.nota_aclaratoria || r.estado;
            item.observacion_fb = r.observacion || "";
            item.auditor_fb = r.auditor || "";
            item.fecha_fb = r.fecha_gestion || "";
            if (hasChanged) updatedCount++;
          }
        });
      }

      if (updatedCount > 0 || isManual) {
        console.log(`[Google Sheets Live Sync] ${updatedCount} registros de auditoría sincronizados en vivo.`);
        renderCurrentDataState();
      }

      if (currentMainView === "dashboard" && rawDashboardData) {
        updateDashboardModalKPIs();
      }

      return Object.keys(newLocalStore).length;
    }
  } catch (e) {
    console.warn("Aviso al obtener retroalimentación en vivo desde Google Sheets:", e);
  }
  return 0;
}

async function refreshLiveFeedbacks() {
  const btn = document.getElementById("btnRefreshLive");
  const icon = btn ? btn.querySelector("i") : null;

  if (btn) btn.disabled = true;
  if (icon) icon.className = "fa-solid fa-arrows-rotate fa-spin";

  showToast("Sincronizando auditorías realizadas en Google Sheets...");

  try {
    if (isLocalhost) {
      try {
        await fetch("/api/sync_feedback", { method: "POST" });
      } catch (ex) {
        console.warn("Aviso al sincronizar feedback con servidor local:", ex);
      }
    }

    const totalRemote = await syncLiveFeedbackFromGoogleSheets(true);
    if (totalRemote > 0) {
      showToast(`¡Se han sincronizado ${totalRemote} auditorías en vivo desde Google Sheets!`);
    } else {
      showToast("Las auditorías están al día con Google Sheets.");
    }
  } catch (e) {
    showToast("Aviso al refrescar auditorías desde Google Sheets.");
  } finally {
    setTimeout(() => {
      if (btn) btn.disabled = false;
      if (icon) icon.className = "fa-solid fa-arrows-rotate";
    }, 400);
  }
}





function updateHeaderMeta(dataSource, lastUpdateInfo) {
  const btnSync = document.getElementById("btnManualSync");
  const updateDateElem = document.getElementById("updateDate");

  if (lastUpdateInfo) {
    const lastDateStr = lastUpdateInfo.last_date || lastUpdateInfo.checked_at;
    if (updateDateElem && lastDateStr) {
      const parts = lastDateStr.split(" ")[0].split("-");
      let formattedDate = lastDateStr;
      if (parts.length === 3) {
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        formattedDate = dateObj.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
      }
      updateDateElem.innerHTML = `${formattedDate}<br><small>Fecha de actualización</small>`;
    }
  }

  if (btnSync) {
    if (isLocalhost) {
      btnSync.style.display = "inline-flex";
      btnSync.disabled = false;
      btnSync.classList.remove("btn-disabled");
      btnSync.title = "Haz clic para verificar si existen nuevas historias clínicas en la base de datos SQL Server";
      btnSync.innerHTML = `<i class="fa-solid fa-rotate"></i> Actualizar datos de cierre`;
    } else {
      btnSync.style.display = "none";
    }
  }
}



async function fetchConfig() {
  try {
    let cfg = null;
    try {
      const res = await fetch("/api/feedback");
      if (res.ok) {
        const data = await res.json();
        if (data && data.config) cfg = data.config;
        if (data && data.feedback && typeof data.feedback === "object") {
          Object.assign(localFeedbackStore, data.feedback);
          try {
            localStorage.setItem("agendaweb_local_feedbacks", JSON.stringify(localFeedbackStore));
          } catch (e) { }
          if (currentMainView === "dashboard" && rawDashboardData) {
            updateDashboardModalKPIs();
          }
        }
      }
    } catch (e) { }

    try {
      const resFb = await fetch(`./static/api/feedback.json?_t=${Date.now()}`, { cache: "no-store" });
      if (resFb.ok) {
        const fbData = await resFb.json();
        if (fbData && typeof fbData === "object") {
          // Fusionar preservando ediciones locales no sincronizadas
          const merged = { ...fbData };
          if (localFeedbackStore && typeof localFeedbackStore === "object") {
            Object.entries(localFeedbackStore).forEach(([k, v]) => {
              if (v && v.synced === false) {
                merged[k] = v;
              }
            });
          }
          localFeedbackStore = merged;
          try {
            localStorage.setItem("agendaweb_local_feedbacks", JSON.stringify(localFeedbackStore));
          } catch (e) { }
          if (currentMainView === "dashboard" && rawDashboardData) {
            updateDashboardModalKPIs();
          }
        }
      }
    } catch (eFb) { }

    if (!cfg) {
      try {
        const res2 = await fetch("config.json");
        if (res2.ok) {
          cfg = await res2.json();
        }
      } catch (e2) { }
    }

    if (cfg) {
      if (cfg.cis_mappings && typeof cfg.cis_mappings === 'object') {
        const isSame = JSON.stringify(currentCisMappings) === JSON.stringify(cfg.cis_mappings);
        currentCisMappings = cfg.cis_mappings;
        if (!isSame && rawDashboardData) {
          rawDashboardData = sanitizeRawDashboardData(rawDashboardData);
          renderCurrentDataState();
        }
      }
      if (cfg.google_sheets_url) {
        const elUrl = document.getElementById("googleSheetsUrl");
        if (elUrl) elUrl.value = cfg.google_sheets_url;
        const elStatus = document.getElementById("sheetsStatusText");
        if (elStatus) elStatus.innerText = "Google Sheets Conectado";
      }
    }
  } catch (err) {
    // Modo estático o sin backend local; sin efecto adverso
  }
}

let userCedulaMap = {};

function toNomPropio(str) {
  if (!str) return "";
  return str.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

// --- SISTEMA MULTI-SELECT POWER BI ---
var currentFilterOptions = {
  ano: [],
  mes: [],
  dia: [],
  quincena: ["1ra Quincena", "2da Quincena"],
  sede: [],
  programa: [],
  profesional: [],
  estado_phc: [],
  auditores: []
};
var currentFilterCounts = {};

function updateFilterOptions(opts) {
  if (!opts) return;

  currentFilterCounts = (opts && opts.counts) || {};

  currentFilterOptions.ano = opts.anos || [];
  currentFilterOptions.mes = opts.meses || [];
  currentFilterOptions.dia = opts.dias || [];
  currentFilterOptions.quincena = opts.quincenas || ["1ra Quincena", "2da Quincena"];
  currentFilterOptions.sede = Array.from(new Set((opts.sedes || []).map(normalizeSedeName).filter(Boolean))).sort();
  currentFilterOptions.programa = opts.programas || [];
  currentFilterOptions.profesional = opts.profesionales || [];
  currentFilterOptions.estado_phc = opts.estados_phc || opts.estado_phc || ["Asistida sin atención", "Confirmada", "En progreso", "Inasistencia"];

  rawComboOptions.sedes = currentFilterOptions.sede;
  rawComboOptions.programas = currentFilterOptions.programa;
  rawComboOptions.profesionales = currentFilterOptions.profesional;
  rawComboOptions.estados_phc = currentFilterOptions.estado_phc;

  const rawList = (opts.auditores && opts.auditores.length > 0) ? opts.auditores : (opts.profesionales || []);
  const auditorMap = new Map();
  rawList.forEach(item => {
    const norm = toNomPropio(item);
    if (norm && !auditorMap.has(norm.toLowerCase())) {
      auditorMap.set(norm.toLowerCase(), norm);
    }
  });
  rawComboOptions.auditores = Array.from(auditorMap.values()).sort();

  if (opts.user_cedula_map) {
    userCedulaMap = opts.user_cedula_map;
  }

  // Refrescar cada uno de los seccionadores multi-select
  ['ano', 'mes', 'dia', 'quincena', 'sede', 'programa', 'profesional', 'estado_phc'].forEach(key => {
    updateMultiSelectTriggerLabel(key);
    const box = document.getElementById(`msBox_${key}`);
    const searchInput = document.getElementById(`msSearch_${key}`);
    const q = searchInput ? searchInput.value : "";
    renderMultiSelectOptions(key, q);
  });
}

function isOptionSelected(key, val) {
  const arr = currentFilters[key] || [];
  if (arr.length === 0) return false;
  const valStr = removeAccents(val);
  return arr.some(x => removeAccents(x) === valStr);
}

function updateMultiSelectTriggerLabel(key) {
  const labelEl = document.getElementById(`msLabel_${key}`);
  const triggerEl = document.querySelector(`#msBox_${key} .multi-select-trigger`);
  if (!labelEl || !triggerEl) return;

  const sel = currentFilters[key] || [];
  const defaultText = (key === 'ano' || key === 'dia' || key === 'estado_phc') ? "Todos" : "Todas";

  const oldBadge = triggerEl.querySelector(".multi-select-count-badge");
  if (oldBadge) oldBadge.remove();

  const totalOpts = (currentFilterOptions[key] || []).length;

  if (sel.length === 0 || (totalOpts > 0 && sel.length >= totalOpts)) {
    labelEl.innerText = defaultText;
    labelEl.title = defaultText;
    triggerEl.classList.remove("has-selection");
  } else if (sel.length === 1) {
    labelEl.innerText = String(sel[0]);
    labelEl.title = String(sel[0]);
    triggerEl.classList.add("has-selection");
  } else if (sel.length === 2) {
    labelEl.innerText = `${sel[0]}, ${sel[1]}`;
    labelEl.title = `${sel[0]}, ${sel[1]}`;
    triggerEl.classList.add("has-selection");
    const badge = document.createElement("span");
    badge.className = "multi-select-count-badge";
    badge.innerText = "2";
    triggerEl.insertBefore(badge, triggerEl.querySelector(".multi-select-arrow"));
  } else {
    labelEl.innerText = `${sel.length} seleccionados`;
    labelEl.title = sel.join(", ");
    triggerEl.classList.add("has-selection");
    const badge = document.createElement("span");
    badge.className = "multi-select-count-badge";
    badge.innerText = String(sel.length);
    triggerEl.insertBefore(badge, triggerEl.querySelector(".multi-select-arrow"));
  }
}

const MS_BATCH_SIZE = 150;
const multiSelectRenderState = {};

function createMultiSelectOptionRow(key, optVal) {
  const isChecked = isOptionSelected(key, optVal);
  const row = document.createElement("label");
  row.className = "multi-select-option" + (isChecked ? " is-selected" : "");
  row.title = String(optVal);

  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.checked = isChecked;
  chk.onchange = (e) => {
    e.stopPropagation();
    toggleMultiSelectOption(key, optVal, true);
  };

  const span = document.createElement("span");
  span.className = "ms-opt-text";
  span.innerText = String(optVal);
  span.title = String(optVal);

  row.appendChild(chk);
  row.appendChild(span);

  // Contadores numéricos faceted en desplegables (Mejora 2)
  const catCounts = currentFilterCounts[key];
  if (catCounts && catCounts[optVal] !== undefined) {
    const cVal = catCounts[optVal];
    const badgeCount = document.createElement("span");
    badgeCount.className = "ms-opt-count" + (cVal === 0 ? " zero-count" : "");
    badgeCount.innerText = cVal.toLocaleString('es-CO');
    row.appendChild(badgeCount);
  }

  row.onclick = (e) => {
    if (e.target === chk) return;
    e.preventDefault();
    e.stopPropagation();
    chk.checked = !chk.checked;
    toggleMultiSelectOption(key, optVal, true);
  };

  return row;
}

function renderNextOptionBatch(key) {
  const container = document.getElementById(`msOptions_${key}`);
  const state = multiSelectRenderState[key];
  if (!container || !state) return;

  const { filteredOpts, renderedCount } = state;
  if (renderedCount >= filteredOpts.length) {
    updateScrollHint(key);
    return;
  }

  const nextBatch = filteredOpts.slice(renderedCount, renderedCount + MS_BATCH_SIZE);
  const frag = document.createDocumentFragment();

  nextBatch.forEach(optVal => {
    frag.appendChild(createMultiSelectOptionRow(key, optVal));
  });

  const hint = container.querySelector(".multi-select-scroll-hint");
  if (hint) {
    container.insertBefore(frag, hint);
  } else {
    container.appendChild(frag);
  }

  state.renderedCount += nextBatch.length;
  updateScrollHint(key);
}

function updateScrollHint(key) {
  const container = document.getElementById(`msOptions_${key}`);
  const state = multiSelectRenderState[key];
  if (!container || !state) return;

  let hint = container.querySelector(".multi-select-scroll-hint");
  const total = state.filteredOpts.length;
  const current = state.renderedCount;

  if (total <= MS_BATCH_SIZE) {
    if (hint) hint.remove();
    return;
  }

  if (!hint) {
    hint = document.createElement("div");
    hint.className = "multi-select-scroll-hint";
    container.appendChild(hint);
  }

  if (current < total) {
    hint.innerHTML = `<small style="color:#64748b; font-size:10.5px; display:block; padding:6px 8px; text-align:center; background:#f8fafc; border-top:1px dashed #e2e8f0; font-weight:500;">Mostrando ${current} de ${total.toLocaleString('es-CO')} opciones (desplaza hacia abajo para ver más)</small>`;
  } else {
    hint.innerHTML = `<small style="color:#10b981; font-size:10.5px; display:block; padding:6px 8px; text-align:center; background:#f8fafc; border-top:1px solid #e2e8f0; font-weight:600;"><i class="fa-solid fa-check"></i> Todas las ${total.toLocaleString('es-CO')} opciones cargadas</small>`;
  }
}

function renderMultiSelectOptions(key, searchQuery = "", preserveCount = false) {
  const container = document.getElementById(`msOptions_${key}`);
  if (!container) return;

  const rawOpts = currentFilterOptions[key] || [];
  const normQuery = removeAccents((searchQuery || "").trim());

  const filteredOpts = normQuery
    ? rawOpts.filter(o => removeAccents(String(o)).includes(normQuery))
    : rawOpts;

  const prevScrollTop = container.scrollTop;
  const prevCount = preserveCount && multiSelectRenderState[key] ? multiSelectRenderState[key].renderedCount : 0;

  container.innerHTML = "";

  if (filteredOpts.length === 0) {
    container.innerHTML = `<div class="multi-select-empty">Sin coincidencias</div>`;
    const selectAllBox = document.getElementById(`msCheckAll_${key}`);
    if (selectAllBox) {
      selectAllBox.checked = false;
      selectAllBox.indeterminate = false;
    }
    multiSelectRenderState[key] = { filteredOpts: [], renderedCount: 0 };
    return;
  }

  const selectAllBox = document.getElementById(`msCheckAll_${key}`);
  if (selectAllBox) {
    const visibleSelectedCount = filteredOpts.filter(o => isOptionSelected(key, o)).length;
    if (filteredOpts.length > 0 && visibleSelectedCount === filteredOpts.length) {
      selectAllBox.checked = true;
      selectAllBox.indeterminate = false;
    } else if (visibleSelectedCount > 0) {
      selectAllBox.checked = false;
      selectAllBox.indeterminate = true;
    } else {
      selectAllBox.checked = false;
      selectAllBox.indeterminate = false;
    }
  }

  multiSelectRenderState[key] = {
    filteredOpts: filteredOpts,
    renderedCount: 0
  };

  const initialBatchCount = Math.max(MS_BATCH_SIZE, Math.min(prevCount || MS_BATCH_SIZE, filteredOpts.length));
  const initialBatch = filteredOpts.slice(0, initialBatchCount);
  const frag = document.createDocumentFragment();
  initialBatch.forEach(optVal => {
    frag.appendChild(createMultiSelectOptionRow(key, optVal));
  });
  container.appendChild(frag);
  multiSelectRenderState[key].renderedCount = initialBatch.length;
  updateScrollHint(key);

  if (preserveCount && prevScrollTop > 0) {
    container.scrollTop = prevScrollTop;
  } else if (!preserveCount) {
    container.scrollTop = 0;
  }

  container.onscroll = () => {
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 150) {
      renderNextOptionBatch(key);
    }
  };
}

function toggleMultiSelectPopover(key, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const box = document.getElementById(`msBox_${key}`);
  if (!box) return;
  const wasOpen = box.classList.contains("open");
  closeAllMultiSelects();
  if (!wasOpen) {
    box.classList.add("open");
    const card = box.closest(".filter-card");
    if (card) card.classList.add("filter-card-open");
    const searchInput = document.getElementById(`msSearch_${key}`);
    if (searchInput) {
      searchInput.value = "";
      setTimeout(() => searchInput.focus(), 50);
    }
    renderMultiSelectOptions(key, "");

    const popover = document.getElementById(`msPopover_${key}`);
    if (popover) {
      popover.style.left = "0";
      popover.style.right = "auto";
      const rect = popover.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      if (rect.right > vw - 12) {
        popover.style.left = "auto";
        popover.style.right = "0";
        const newRect = popover.getBoundingClientRect();
        if (newRect.left < 8) {
          popover.style.left = "0";
          popover.style.right = "auto";
          popover.style.maxWidth = `${Math.max(220, vw - 24)}px`;
        }
      }
    }
  }
}

function closeAllMultiSelects() {
  document.querySelectorAll(".multi-select-box.open").forEach(b => b.classList.remove("open"));
  document.querySelectorAll(".filter-card-open").forEach(c => c.classList.remove("filter-card-open"));
}

function onMultiSelectSearch(key) {
  const input = document.getElementById(`msSearch_${key}`);
  const q = input ? input.value : "";
  renderMultiSelectOptions(key, q);
}

function toggleSelectAll(key) {
  currentPage = 1;
  const rawOpts = currentFilterOptions[key] || [];
  const searchInput = document.getElementById(`msSearch_${key}`);
  const query = searchInput ? searchInput.value.trim() : "";
  const normQuery = removeAccents(query);
  const visibleOpts = normQuery ? rawOpts.filter(o => removeAccents(String(o)).includes(normQuery)) : rawOpts;

  if (visibleOpts.length === 0) return;

  const allVisibleSelected = visibleOpts.every(o => isOptionSelected(key, o));
  const shouldSelectAll = !allVisibleSelected;

  if (shouldSelectAll) {
    if (!normQuery) {
      if (key === 'dia') {
        currentFilters.dia = rawOpts.map(Number);
      } else if (key === 'ano') {
        currentFilters.ano = rawOpts.map(String);
      } else {
        currentFilters[key] = [...rawOpts];
      }
    } else {
      const set = new Set((currentFilters[key] || []).map(x => removeAccents(x)));
      visibleOpts.forEach(o => {
        if (!set.has(removeAccents(o))) {
          if (key === 'dia') {
            currentFilters.dia.push(Number(o));
          } else if (key === 'ano') {
            currentFilters.ano.push(String(o));
          } else {
            currentFilters[key].push(o);
          }
        }
      });
    }
  } else {
    if (!normQuery) {
      currentFilters[key] = [];
    } else {
      const visibleSet = new Set(visibleOpts.map(o => removeAccents(o)));
      currentFilters[key] = (currentFilters[key] || []).filter(o => !visibleSet.has(removeAccents(o)));
    }
  }

  updateMultiSelectTriggerLabel(key);
  renderMultiSelectOptions(key, query);
  renderCurrentDataState();
}

function toggleMultiSelectOption(key, optVal, keepScroll = false) {
  currentPage = 1;
  let arr = [...(currentFilters[key] || [])];
  const valNorm = removeAccents(optVal);

  const idx = arr.findIndex(x => removeAccents(x) === valNorm);
  if (idx >= 0) {
    arr.splice(idx, 1);
  } else {
    if (key === 'dia') {
      arr.push(Number(optVal));
    } else if (key === 'ano') {
      arr.push(String(optVal));
    } else {
      arr.push(optVal);
    }
  }
  currentFilters[key] = arr;

  // Desconflicto inteligente entre Día y Quincena
  if (key === 'quincena' && currentFilters.dia.length > 0 && currentFilters.quincena.length > 0) {
    const has1Q = currentFilters.quincena.some(q => removeAccents(q).includes("1ra"));
    const has2Q = currentFilters.quincena.some(q => removeAccents(q).includes("2da"));
    if (has1Q && !has2Q) {
      currentFilters.dia = currentFilters.dia.filter(d => Number(d) <= 15);
    } else if (has2Q && !has1Q) {
      currentFilters.dia = currentFilters.dia.filter(d => Number(d) > 15);
    }
  }

  updateMultiSelectTriggerLabel(key);
  const searchInput = document.getElementById(`msSearch_${key}`);
  renderMultiSelectOptions(key, searchInput ? searchInput.value : "", keepScroll);
  renderCurrentDataState();
}

// Alias para compatibilidad
function toggleFilter(key, value) {
  currentPage = 1;
  toggleMultiSelectOption(key, value);
}

// --- BOTONES BORRADOR INDIVIDUALES (RESETEO POR SEGMENTADOR) ---
function resetSingleFilter(key) {
  currentPage = 1;
  if (key === "fechas" || key === "periodo") {
    userHasCustomDateFilter = false;
    const range = dynamicLatestMonthRange.dateFrom ? dynamicLatestMonthRange : computeLatestMonthDateRange(rawDashboardData);
    currentFilters.dateFrom = range.dateFrom;
    currentFilters.dateTo = range.dateTo;
    const df = document.getElementById("dateFrom");
    const dt = document.getElementById("dateTo");
    if (df) df.value = range.dateFrom;
    if (dt) dt.value = range.dateTo;
    selectedPeriodos = { ultimo_mes: true, fechas_previas: false };
    const btnU = document.getElementById("btnUltimoMes");
    const btnF = document.getElementById("btnFechasPrevias");
    if (btnU) btnU.classList.add("active");
    if (btnF) btnF.classList.remove("active");
    currentFilters.periodo = "ultimo_mes";
    currentFilters.mes = [];
    currentFilters.dia = [];
    currentFilters.quincena = [];
    fetchDashboardData();
  } else {
    currentFilters[key] = [];
    updateMultiSelectTriggerLabel(key);
    const searchInput = document.getElementById(`msSearch_${key}`);
    if (searchInput) searchInput.value = "";
    renderMultiSelectOptions(key, "");
    renderCurrentDataState();
  }
}

// --- SELECTOR DE PERÍODO (ÚLTIMO MES, FECHAS PREVIAS O AMBOS) ---
function togglePeriodoBtn(type) {
  currentPage = 1;
  const prevPeriodo = currentFilters.periodo;
  if (type === 'ultimo_mes') {
    if (selectedPeriodos.ultimo_mes && !selectedPeriodos.fechas_previas) {
      selectedPeriodos.ultimo_mes = true;
      selectedPeriodos.fechas_previas = true;
      currentFilters.periodo = "ambos";
    } else {
      selectedPeriodos.ultimo_mes = true;
      selectedPeriodos.fechas_previas = false;
      currentFilters.periodo = "ultimo_mes";
    }
  } else if (type === 'fechas_previas') {
    if (selectedPeriodos.fechas_previas && !selectedPeriodos.ultimo_mes) {
      selectedPeriodos.ultimo_mes = true;
      selectedPeriodos.fechas_previas = true;
      currentFilters.periodo = "ambos";
    } else {
      selectedPeriodos.ultimo_mes = false;
      selectedPeriodos.fechas_previas = true;
      currentFilters.periodo = "fechas_previas";
    }
  }

  const btnU = document.getElementById("btnUltimoMes");
  const btnF = document.getElementById("btnFechasPrevias");
  if (btnU) btnU.classList.toggle("active", selectedPeriodos.ultimo_mes);
  if (btnF) btnF.classList.toggle("active", selectedPeriodos.fechas_previas);

  // Al cambiar de período, resetear filtros específicos de fecha para ver todas las opciones del nuevo período
  if (currentFilters.periodo !== prevPeriodo) {
    currentFilters.mes = [];
    currentFilters.dia = [];
    currentFilters.quincena = [];
  }

  fetchDashboardData();
}

function resetFilters() {
  currentPage = 1;
  userHasCustomDateFilter = false;
  const range = dynamicLatestMonthRange.dateFrom ? dynamicLatestMonthRange : computeLatestMonthDateRange(rawDashboardData);
  currentFilters = {
    periodo: "ultimo_mes",
    ano: [],
    mes: [],
    dia: [],
    quincena: [],
    sede: [],
    programa: [],
    profesional: [],
    estado_phc: [],
    dateFrom: range.dateFrom,
    dateTo: range.dateTo
  };
  const df = document.getElementById("dateFrom");
  const dt = document.getElementById("dateTo");
  if (df) df.value = range.dateFrom;
  if (dt) dt.value = range.dateTo;

  currentQuickFilter = "all";
  currentQuickFilters.clear();
  document.querySelectorAll(".quick-pill").forEach(p => {
    p.classList.toggle("active", p.dataset.qfilter === "all");
  });

  selectedPeriodos = { ultimo_mes: true, fechas_previas: false };
  const btnU = document.getElementById("btnUltimoMes");
  const btnF = document.getElementById("btnFechasPrevias");
  if (btnU) btnU.classList.add("active");
  if (btnF) btnF.classList.remove("active");

  ['ano', 'mes', 'dia', 'quincena', 'sede', 'programa', 'profesional', 'estado_phc'].forEach(k => {
    updateMultiSelectTriggerLabel(k);
    const sInput = document.getElementById(`msSearch_${k}`);
    if (sInput) sInput.value = "";
    renderMultiSelectOptions(k, "");
  });
  isUserSearching = false;
  const searchInputDetalle = document.getElementById("searchDetalleCitas") || document.getElementById("searchDetalle");
  if (searchInputDetalle) searchInputDetalle.value = "";
  const btnClearSearch = document.getElementById("btnClearSearchDetalle");
  if (btnClearSearch) btnClearSearch.style.display = "none";
  closeAllMultiSelects();
  fetchDashboardData();
}

// --- BARRA DE CHIPS DE FILTROS ACTIVOS ---
function renderActiveFilterChips() {
  const bar = document.getElementById("activeFiltersBar");
  const container = document.getElementById("chipsContainer");
  if (!bar || !container) return;
  container.innerHTML = "";

  const activeKeys = [
    { key: "sede", label: "Sede" },
    { key: "profesional", label: "Médico" },
    { key: "programa", label: "Programa" },
    { key: "estado_phc", label: "Estado PHC" },
    { key: "mes", label: "Mes" },
    { key: "dia", label: "Día" },
    { key: "quincena", label: "Quincena" },
    { key: "ano", label: "Año" }
  ];

  let totalActive = 0;

  activeKeys.forEach(item => {
    const list = currentFilters[item.key] || [];
    const totalOpts = (currentFilterOptions[item.key] || []).length;
    if (totalOpts > 0 && list.length >= totalOpts) {
      return;
    }
    list.forEach(val => {
      totalActive++;
      const chip = document.createElement("div");
      chip.className = "chip-badge";
      chip.innerHTML = `<span><strong>${item.label}:</strong> ${val}</span> <i class="fa-solid fa-xmark"></i>`;
      chip.title = `Haz clic para quitar ${item.label}: ${val}`;
      chip.onclick = () => {
        toggleMultiSelectOption(item.key, val);
      };
      container.appendChild(chip);
    });
  });

  bar.style.display = totalActive > 0 ? "flex" : "none";
}

// --- RENDERIZADO TABLA 1: RESUMEN DE SEDES (EXPANSIBLE POR MÉDICO 1:1) ---
let expandedSedes = {};

function renderTblSedes(sedes) {
  if (sedes) currentSedesData = sedes;
  const tbody = document.querySelector("#tblSedes tbody");
  tbody.innerHTML = "";

  let list = [...(currentSedesData || [])];

  const cfg = tableSortConfig.tblSedes;
  if (cfg.colIndex >= 0 && cfg.dir !== 'default') {
    const colInfo = tableColumnKeys.tblSedes[cfg.colIndex];
    if (colInfo) {
      const k = colInfo.key;
      list.sort((a, b) => {
        let valA = a[k], valB = b[k];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return cfg.dir === 'asc' ? -1 : 1;
        if (valA > valB) return cfg.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }
  }

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="center">No hay datos disponibles</td></tr>';
    return;
  }

  let totPend = 0, totGest = 0, totProg = 0, totSin = 0;

  list.forEach(s => {
    totPend += (s.pendientes || 0);
    totGest += (s.gestionadas || 0);
    totProg += (s.en_progreso || 0);
    totSin += (s.sin_auditar || 0);

    const sedeName = s["NOMBRE IPS"];
    const isSelected = (currentFilters.sede || []).some(x => normalizeSedeName(x).toLowerCase().trim() === normalizeSedeName(sedeName).toLowerCase().trim());

    const tr = document.createElement("tr");
    tr.className = "sede-parent-row" + (isSelected ? " row-selected" : "");

    const pctG = s.pct_gestion != null ? s.pct_gestion : (s.pendientes > 0 ? (Math.round((s.gestionadas || 0) / s.pendientes * 1000) / 10) : 0);
    const clampedPct = Math.min(100, Math.max(0, pctG));
    let barColorClass = "prog-red";
    if (clampedPct >= 80) barColorClass = "prog-green";
    else if (clampedPct >= 40) barColorClass = "prog-yellow";

    tr.innerHTML = `
      <td title="${escapeHtml(sedeName)}">
        <span style="margin-right: 5px; display: inline-block;">
          <i class="fa-solid fa-building" style="color: var(--pbi-blue); font-size: 11px;"></i>
        </span>
        <strong>${sedeName}</strong>
      </td>
      <td class="num"><strong>${(s.pendientes || 0).toLocaleString('es-CO')}</strong></td>
      <td class="num">${(s.en_progreso || 0).toLocaleString('es-CO')}</td>
      <td class="num">${(s.sin_auditar || 0).toLocaleString('es-CO')}</td>
      <td class="num">
        <div class="progress-cell-wrapper" title="Avance de gestión: ${pctG}%">
          <span class="progress-val">${pctG}%</span>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill ${barColorClass}" style="width: ${clampedPct}%;"></div>
          </div>
        </div>
      </td>
    `;

    tr.onclick = (e) => {
      toggleFilter("sede", sedeName);
    };

    tbody.appendChild(tr);
  });

  const totPctG = totPend > 0 ? (Math.round(totGest / totPend * 1000) / 10) : 0;
  const clampedTotPct = Math.min(100, Math.max(0, totPctG));
  let totBarColorClass = "prog-red";
  if (clampedTotPct >= 80) totBarColorClass = "prog-green";
  else if (clampedTotPct >= 40) totBarColorClass = "prog-yellow";

  const trTot = document.createElement("tr");
  trTot.style.fontWeight = "bold";
  trTot.style.backgroundColor = "#f1f5f9";
  trTot.innerHTML = `
    <td>Total</td>
    <td class="num"><strong>${totPend.toLocaleString('es-CO')}</strong></td>
    <td class="num">${totProg.toLocaleString('es-CO')}</td>
    <td class="num">${totSin.toLocaleString('es-CO')}</td>
    <td class="num">
      <div class="progress-cell-wrapper" title="Avance total: ${totPctG}%">
        <span class="progress-val">${totPctG}%</span>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill ${totBarColorClass}" style="width: ${clampedTotPct}%;"></div>
        </div>
      </div>
    </td>
  `;
  tbody.appendChild(trTot);
}



// --- FUNCIONES DE COPIADO AL PORTAPAPELES Y NOTIFICACIÓN TOAST ---
function copyDocToClipboard(e, text) {
  if (e) {
    if (typeof e.stopPropagation === "function") e.stopPropagation();
    if (typeof e.preventDefault === "function") e.preventDefault();
    const targetBadge = e.currentTarget || e.target;
    if (targetBadge && targetBadge.classList) {
      targetBadge.classList.add("doc-badge-copied");
      setTimeout(() => targetBadge.classList.remove("doc-badge-copied"), 1000);
    }
  }
  if (!text || text === "N/A") return;

  const strText = String(text).trim();
  let copied = false;

  // 1. Intento síncrono inmediato con execCommand:
  // En iframes restringidos (como SharePoint), el Clipboard API asíncrono suele estar bloqueado por Permissions Policy.
  // execCommand ejecutado de forma síncrona dentro del clic del usuario tiene permiso en todos los navegadores.
  try {
    const ta = document.createElement("textarea");
    ta.value = strText;
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "-9999px";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, 99999);
    copied = document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (err) {
    copied = false;
  }

  if (copied) {
    showToast(`📋 Cédula ${strText} copiada al portapapeles`);
    return;
  }

  // 2. Si execCommand no tuvo éxito, intentar navigator.clipboard si está disponible
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(strText)
      .then(() => {
        showToast(`📋 Cédula ${strText} copiada al portapapeles`);
      })
      .catch((err) => {
        console.warn("Copiado por clipboard bloqueado en el iframe:", err);
        promptCopyFallback(strText);
      });
  } else {
    promptCopyFallback(strText);
  }
}

function promptCopyFallback(text) {
  try {
    window.prompt("Copie el número de cédula con Ctrl+C y presione Enter:", text);
    showToast(`📋 Cédula ${text}`);
  } catch (ex) {
    showToast(`📋 Cédula ${text}`);
  }
}

function showToast(msg) {
  let toast = document.querySelector(".toast-notification");
  if (toast) toast.remove();

  toast = document.createElement("div");
  toast.className = "toast-notification";
  toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #4ade80; font-size: 15px;"></i> <span>${msg}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s ease";
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
  }, 2500);
}

// --- RENDERIZADO TABLA 2: CITAS POR MÉDICO ---
function renderTblMedicos(medicos) {
  if (medicos) currentMedicosData = medicos;
  const tbody = document.querySelector("#tblMedicos tbody");
  tbody.innerHTML = "";

  let list = [...(currentMedicosData || [])];

  const cfg = tableSortConfig.tblMedicos;
  if (cfg.colIndex >= 0 && cfg.dir !== 'default') {
    const colInfo = tableColumnKeys.tblMedicos[cfg.colIndex];
    if (colInfo) {
      const k = colInfo.key;
      list.sort((a, b) => {
        let valA = a[k], valB = b[k];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return cfg.dir === 'asc' ? -1 : 1;
        if (valA > valB) return cfg.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }
  }

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="center">No hay datos de médicos</td></tr>';
    return;
  }

  list.forEach(m => {
    const profName = m["NOMBRE PROFESIONAL"];
    const isSelected = (currentFilters.profesional || []).some(x => String(x).toLowerCase().trim() === String(profName).toLowerCase().trim());
    const tr = document.createElement("tr");
    if (isSelected) tr.classList.add("row-selected");

    const docCed = (userCedulaMap && userCedulaMap[m["NOMBRE PROFESIONAL"]]) || m.identificacion || "N/A";

    tr.onclick = (e) => {
      if (e.target.closest(".doc-badge")) return;
      toggleFilter("profesional", m["NOMBRE PROFESIONAL"]);
    };

    tr.innerHTML = `
      <td class="col-medico-prof">${m["NOMBRE PROFESIONAL"]}</td>
      <td class="col-medico-doc" style="user-select: text;">
        <span class="doc-badge" title="Haz clic para copiar cédula del médico" onclick="copyDocToClipboard(event, '${docCed}')">
          ${docCed} <i class="fa-regular fa-copy"></i>
        </span>
      </td>
      <td class="col-medico-sede">${m["NOMBRE IPS"]}</td>
      <td class="num col-medico-pend"><strong>${m.pendientes.toLocaleString('es-CO')}</strong></td>
    `;
    tbody.appendChild(tr);
  });
}



// --- RENDERIZADO ÁRBOL DE PENDIENTES POR FECHA (CONTRAÍDOS POR DEFECTO Y SCROLLABLE) ---
function renderTreeView(fechasTree, totalPendientes) {
  const container = document.getElementById("treeViewContainer");
  container.innerHTML = "";

  if (!fechasTree || fechasTree.length === 0) {
    container.innerHTML = '<div class="tree-total-box"><span>No hay datos por fecha</span></div>';
    return;
  }

  const monthsBox = document.createElement("div");
  monthsBox.className = "tree-months-wrapper";

  fechasTree.forEach(mObj => {
    const mesName = mObj.mes;
    const totalMes = mObj.total_pendientes;
    const isMesActive = (currentFilters.mes || []).some(m => String(m).toLowerCase().trim() === mesName.toLowerCase().trim());

    const isExpanded = expandedMonths[mesName] === true || isMesActive;

    const card = document.createElement("div");
    card.className = "tree-month-card" + (isMesActive ? " active-filter" : "");

    const header = document.createElement("div");
    header.className = "tree-month-header";
    header.innerHTML = `
      <div class="tree-month-title">
        <div class="tree-toggle-btn">
          <i class="fa-solid ${isExpanded ? 'fa-minus' : 'fa-plus'}"></i>
        </div>
        <span>${mesName}</span>
      </div>
      <span class="tree-month-badge">${totalMes.toLocaleString('es-CO')}</span>
    `;

    header.querySelector(".tree-toggle-btn").onclick = (e) => {
      e.stopPropagation();
      expandedMonths[mesName] = !isExpanded;
      renderTreeView(fechasTree, totalPendientes);
    };

    header.onclick = () => {
      toggleMultiSelectOption("mes", mesName);
    };

    card.appendChild(header);

    const daysList = document.createElement("div");
    daysList.className = "tree-days-list" + (isExpanded ? " open" : "");

    mObj.dias.forEach(d => {
      const isDayActive = (currentFilters.dia || []).some(x => String(x) === String(d.dia_num));
      const dayRow = document.createElement("div");
      dayRow.className = "tree-day-row" + (isDayActive ? " active-day" : "");
      dayRow.innerHTML = `
        <span><i class="fa-regular fa-calendar"></i> Día ${d.dia_num} (${d.fecha_fmt})</span>
        <span class="tree-day-badge">${d.pendientes.toLocaleString('es-CO')}</span>
      `;
      dayRow.onclick = (e) => {
        e.stopPropagation();
        toggleMultiSelectOption("dia", d.dia_num);
      };
      daysList.appendChild(dayRow);
    });

    card.appendChild(daysList);
    monthsBox.appendChild(card);
  });

  container.appendChild(monthsBox);

  const totalBox = document.createElement("div");
  totalBox.className = "tree-total-box";
  totalBox.innerHTML = `
    <span>Total</span>
    <strong>${totalPendientes.toLocaleString('es-CO')}</strong>
  `;
  container.appendChild(totalBox);
}


// --- BUSCADOR Y PAGINACIÓN ---
let isUserSearching = false;

function parseDateTime(dStr, hStr) {
  if (!dStr) return 0;
  const parts = dStr.split("/");
  let timeStr = hStr || "00:00:00";
  if (parts.length === 3) {
    return new Date(`${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}T${timeStr}`).getTime() || 0;
  }
  return new Date(`${dStr} ${timeStr}`).getTime() || 0;
}

function onSearchInput() {
  currentPage = 1;
  const input = document.getElementById("searchDetalleCitas") || document.getElementById("searchDetalle");
  const val = input ? input.value.trim() : "";
  isUserSearching = (val.length > 0);
  const btnClear = document.getElementById("btnClearSearchDetalle");
  if (btnClear) {
    btnClear.style.display = isUserSearching ? "inline-flex" : "none";
  }
  applyClientSearchAndPaginate();
}

function clearSearchDetalle() {
  isUserSearching = false;
  const input = document.getElementById("searchDetalleCitas") || document.getElementById("searchDetalle");
  if (input) {
    input.value = "";
    input.focus();
  }
  const btnClear = document.getElementById("btnClearSearchDetalle");
  if (btnClear) {
    btnClear.style.display = "none";
  }
  currentPage = 1;
  applyClientSearchAndPaginate();
}

function applyClientSearchAndPaginate() {
  const input = document.getElementById("searchDetalleCitas") || document.getElementById("searchDetalle");

  // Si el usuario no está buscando activamente (o tras recargar la página),
  // limpiamos cualquier valor restaurado automáticamente por el navegador
  if (!isUserSearching) {
    if (input && input.value) {
      input.value = "";
    }
    const btnClear = document.getElementById("btnClearSearchDetalle");
    if (btnClear) btnClear.style.display = "none";
  }

  const query = (isUserSearching && input) ? removeAccents(input.value.trim()) : "";
  if (!query) {
    filteredDetalleData = [...currentDetalleData];
  } else {
    filteredDetalleData = currentDetalleData.filter(item =>
      (item.paciente && removeAccents(item.paciente).includes(query)) ||
      (item.identificacion && String(item.identificacion).includes(query)) ||
      (item.profesional && removeAccents(item.profesional).includes(query)) ||
      (item.sede && removeAccents(item.sede).includes(query)) ||
      (item.programa && removeAccents(item.programa).includes(query)) ||
      (item.estado_phc && removeAccents(item.estado_phc).includes(query))
    );
  }

  const totalPages = Math.max(1, Math.ceil(filteredDetalleData.length / pageSize));
  if (currentPage > totalPages || currentPage < 1) {
    currentPage = 1;
  }

  const cfg = tableSortConfig.tblDetalle;
  if (cfg.colIndex >= 0 && cfg.dir !== 'default') {
    const colInfo = tableColumnKeys.tblDetalle[cfg.colIndex];
    if (colInfo) {
      const k = colInfo.key;
      filteredDetalleData.sort((a, b) => {
        let valA = a[k] || '', valB = b[k] || '';
        if (colInfo.type === 'date') {
          valA = a._dtVal !== undefined ? a._dtVal : (a._dtVal = parseDateTime(a.fecha, a.hora));
          valB = b._dtVal !== undefined ? b._dtVal : (b._dtVal = parseDateTime(b.fecha, b.hora));
        } else if (typeof valA === 'string') {
          valA = removeAccents(valA);
          valB = removeAccents(valB);
        }
        if (valA < valB) return cfg.dir === 'asc' ? -1 : 1;
        if (valA > valB) return cfg.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }
  } else {
    filteredDetalleData.sort((a, b) => {
      const tA = a._dtVal !== undefined ? a._dtVal : (a._dtVal = parseDateTime(a.fecha, a.hora));
      const tB = b._dtVal !== undefined ? b._dtVal : (b._dtVal = parseDateTime(b.fecha, b.hora));
      return tB - tA;
    });
  }

  renderTblDetallePage();
}


function updateBulkActionButton() {
  const btnBulk = document.getElementById("btnBulkAudit");
  const countSpan = document.getElementById("bulkSelectedCount");
  const count = selectedCitasSet.size;
  if (countSpan) countSpan.innerText = count;
  if (btnBulk) {
    if (count > 0) {
      btnBulk.style.display = "inline-flex";
    } else {
      btnBulk.style.display = "none";
    }
  }
}

function toggleSelectAllDetalle(checked) {
  const total = filteredDetalleData.length;
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageItems = filteredDetalleData.slice(startIdx, endIdx);

  pageItems.forEach(item => {
    const id = String(item.id_cita);
    if (checked) {
      selectedCitasSet.add(id);
    } else {
      selectedCitasSet.delete(id);
    }
  });

  renderTblDetallePage();
}

function onRowCheckChange(idCita, checked) {
  const id = String(idCita);
  if (checked) {
    selectedCitasSet.add(id);
  } else {
    selectedCitasSet.delete(id);
  }

  const tr = document.querySelector(`.row-check[data-id="${id}"]`)?.closest("tr");
  if (tr) {
    if (checked) tr.classList.add("row-selected");
    else tr.classList.remove("row-selected");
  }

  const checkAll = document.getElementById("checkAllDetalle");
  if (checkAll) {
    const total = filteredDetalleData.length;
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, total);
    const pageItems = filteredDetalleData.slice(startIdx, endIdx);
    const checkedCount = pageItems.filter(item => selectedCitasSet.has(String(item.id_cita))).length;

    if (pageItems.length > 0 && checkedCount === pageItems.length) {
      checkAll.checked = true;
      checkAll.indeterminate = false;
    } else if (checkedCount > 0) {
      checkAll.checked = false;
      checkAll.indeterminate = true;
    } else {
      checkAll.checked = false;
      checkAll.indeterminate = false;
    }
  }

  updateBulkActionButton();
}

function renderTblDetallePage() {
  const tbody = document.querySelector("#tblDetalle tbody");
  tbody.innerHTML = "";

  const total = filteredDetalleData.length;

  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="center">No se encontraron historias pendientes que coincidan con los filtros</td></tr>';
    document.getElementById("pageInfo").innerText = "Mostrando 0 de 0 (Página 0 de 0)";
    document.getElementById("currentPageNum").innerText = "0 de 0";
    document.getElementById("btnPrevPage").disabled = true;
    document.getElementById("btnNextPage").disabled = true;
    const checkAll = document.getElementById("checkAllDetalle");
    if (checkAll) {
      checkAll.checked = false;
      checkAll.indeterminate = false;
    }
    updateBulkActionButton();
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > totalPages || currentPage < 1) {
    currentPage = 1;
  }

  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageItems = filteredDetalleData.slice(startIdx, endIdx);

  pageItems.forEach(item => {
    const tr = document.createElement("tr");

    const isChecked = selectedCitasSet.has(String(item.id_cita));
    if (isChecked) {
      tr.classList.add("row-selected");
    }

    let badgeClass = "badge-grey";
    const st = (item.estado_fb || "").toLowerCase();
    if (st.includes("cerrada") || st.includes("atendido")) badgeClass = "badge-green";
    else if (st.includes("gestión") || st.includes("progreso") || st.includes("inasistencia") || st.includes("error") || st.includes("novedad")) badgeClass = "badge-yellow";
    else if (st.includes("reagendado")) badgeClass = "badge-blue";

    const isAudited = !!(item.estado_fb && item.estado_fb !== "Sin Auditar" && item.estado_fb !== "Sin Gestión");
    const btnText = isAudited ? "Editar" : "Auditar";
    const btnIcon = isAudited ? "fa-pen-to-square" : "fa-user-check";

    let phcBadgeClass = "badge-blue";
    let phcRaw = item.estado_phc || item.Estado_PHC || "Confirmada";
    let phcText = String(phcRaw).trim();
    if (!phcText || phcText.toLowerCase() === "sin registro") {
      phcText = "Confirmada";
    }
    const phcLower = phcText.toLowerCase();
    if (phcLower.includes("confirmada")) phcBadgeClass = "badge-blue";
    else if (phcLower.includes("progreso")) phcBadgeClass = "badge-yellow";
    else if (phcLower.includes("pendiente")) phcBadgeClass = "badge-blue";
    else if (phcLower.includes("cerrada") || phcLower.includes("atendido") || phcLower.includes("finalizada")) phcBadgeClass = "badge-green";
    else if (phcLower.includes("inasistencia") || phcLower.includes("bloqueada") || phcLower.includes("error")) phcBadgeClass = "badge-red";
    else if (phcLower.includes("novedad") || phcLower.includes("asistida")) phcBadgeClass = "badge-orange";
    else phcBadgeClass = "badge-blue";

    tr.innerHTML = `
      <td class="center col-checkbox" style="width: 28px; min-width: 28px; padding: 4px !important;">
        <input type="checkbox" class="table-checkbox row-check" data-id="${item.id_cita}" ${isChecked ? 'checked' : ''} onchange="onRowCheckChange('${item.id_cita}', this.checked)">
      </td>
      <td class="center col-fecha" style="white-space: nowrap;">${item.fecha}</td>
      <td class="col-hora">${item.hora}</td>
      <td class="col-sede">${item.sede}</td>
      <td class="col-doc">${item.doc}</td>
      <td class="col-identificacion" style="user-select: text;">
        <span class="doc-badge" title="Haz clic para copiar documento del paciente" onclick="copyDocToClipboard(event, '${item.identificacion}')">
          ${item.identificacion} <i class="fa-regular fa-copy"></i>
        </span>
      </td>
      <td class="col-paciente"><strong>${item.paciente}</strong></td>
      <td class="col-programa">
        <div>${item.programa || ""}</div>
        ${item.cambio_servicio && item.cup_phc ? `<span class="badge-subtle-tag badge-code-change" title="Atendido en PHC con CUP: ${escapeHtml(item.cup_phc)}"><i class="fa-solid fa-tag"></i> PHC: ${escapeHtml(item.cup_phc)}</span>` : ''}
      </td>
      <td class="col-profesional">${item.profesional}</td>
      <td class="center col-estado-phc"><span class="status-badge ${phcBadgeClass}">${phcText}</span></td>
      <td class="center col-accion">
        <button class="btn-action" onclick="openFeedbackModal('${item.id_cita}')">
          <i class="fa-solid ${btnIcon}"></i> ${btnText}
        </button>
        ${((item.historial && item.historial.length > 0) || (localFeedbackStore[String(item.id_cita)] && localFeedbackStore[String(item.id_cita)].historial && localFeedbackStore[String(item.id_cita)].historial.length > 0)) ? `<div style="font-size:10px; color:#0284c7; margin-top:3px; font-weight:600;"><i class="fa-solid fa-clock-rotate-left"></i> Historial</div>` : ''}
      </td>
    `;

    tbody.appendChild(tr);
  });

  applyColumnVisibility();

  const checkAll = document.getElementById("checkAllDetalle");
  if (checkAll) {
    const checkedCount = pageItems.filter(item => selectedCitasSet.has(String(item.id_cita))).length;
    if (pageItems.length > 0 && checkedCount === pageItems.length) {
      checkAll.checked = true;
      checkAll.indeterminate = false;
    } else if (checkedCount > 0) {
      checkAll.checked = false;
      checkAll.indeterminate = true;
    } else {
      checkAll.checked = false;
      checkAll.indeterminate = false;
    }
  }

  // Actualizar banner de selección global
  const banner = document.getElementById("globalSelectionBanner");
  const lblPageCount = document.getElementById("lblPageSelectedCount");
  const lblTotalCount = document.getElementById("lblTotalFilteredCount");

  if (banner && lblPageCount && lblTotalCount) {
    const checkedInPage = pageItems.filter(item => selectedCitasSet.has(String(item.id_cita))).length;
    if (pageItems.length > 0 && checkedInPage === pageItems.length && total > pageItems.length && !isGlobalSelectionActive) {
      lblPageCount.innerText = pageItems.length;
      lblTotalCount.innerText = total.toLocaleString('es-CO');
      banner.style.display = "flex";
      banner.innerHTML = `
        <span><i class="fa-solid fa-circle-check"></i> Se han seleccionado las <strong>${pageItems.length}</strong> citas de esta página.</span>
        <button type="button" class="btn-select-all-global" onclick="selectAllFilteredCitasGlobal()">
          Seleccionar las <strong>${total.toLocaleString('es-CO')}</strong> citas que coinciden con los filtros actuales
        </button>
        <button type="button" class="btn-clear-selection" onclick="clearGlobalSelection()">Cancelar</button>
      `;
    } else if (isGlobalSelectionActive) {
      banner.style.display = "flex";
      banner.innerHTML = `
        <span><i class="fa-solid fa-check-double"></i> <strong>Todas las ${total.toLocaleString('es-CO')} citas</strong> que coinciden con los filtros están seleccionadas para auditoría masiva.</span>
        <button type="button" class="btn-clear-selection" onclick="clearGlobalSelection()">Cancelar selección</button>
      `;
    } else {
      banner.style.display = "none";
    }
  }

  updateBulkActionButton();

  document.getElementById("pageInfo").innerText = `Mostrando ${startIdx + 1} - ${endIdx} de ${total.toLocaleString('es-CO')} (Página ${currentPage} de ${totalPages})`;
  document.getElementById("currentPageNum").innerText = `${currentPage} de ${totalPages}`;
  document.getElementById("btnPrevPage").disabled = currentPage === 1;
  document.getElementById("btnNextPage").disabled = currentPage >= totalPages;
}


function changePage(delta) {
  const total = filteredDetalleData.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  currentPage = Math.min(Math.max(1, currentPage + delta), totalPages);
  renderTblDetallePage();
}

// --- RENDERIZADO DE LOS 3 GRÁFICOS (REPRESENTACIÓN 1:1 CON POWERBI) ---
function getChartPlugins() {
  if (typeof ChartDataLabels !== 'undefined') {
    try {
      if (typeof Chart !== 'undefined' && Chart.register) {
        Chart.register(ChartDataLabels);
      }
    } catch (e) { }
    return [ChartDataLabels];
  }
  return [];
}

function formatChartProgramLabel(label) {
  if (!label) return '';
  label = String(label).trim();
  if (label.length <= 26) return label;
  const words = label.split(' ');
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!cur) {
      cur = w;
    } else if ((cur + ' ' + w).length <= 26) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 1 ? lines : lines[0];
}

function renderChartProgramas(progData) {
  const canvas = document.getElementById("chartProgramas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartProgramasInst) chartProgramasInst.destroy();

  if (!progData || progData.length === 0) return;

  const allProgs = progData;
  const labels = allProgs.map(p => p.PROGRAMA);
  const dataVals = allProgs.map(p => p.count);

  const wrapper = document.getElementById("chartProgramasWrapper");
  if (wrapper) {
    const calcHeight = Math.max(320, allProgs.length * 38);
    wrapper.style.height = `${calcHeight}px`;
    canvas.style.height = `${calcHeight}px`;
  }

  chartProgramasInst = new Chart(ctx, {
    type: 'bar',
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: [{
        label: 'Pendientes',
        data: dataVals,
        backgroundColor: '#0078d4',
        borderColor: '#005a9e',
        borderWidth: 1,
        borderRadius: 4,
        barThickness: 18
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { right: 75, top: 8, bottom: 14, left: 15 }
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end',
          align: 'end',
          clip: false,
          color: currentTheme === 'dark' ? '#f1f5f9' : '#0f172a',
          font: { weight: 'bold', size: 10.5 },
          formatter: (v) => (typeof v === 'number' ? v.toLocaleString('es-CO') : v)
        }
      },

      onClick: (e, activeElements) => {
        if (activeElements.length > 0) {
          const index = activeElements[0].index;
          const clickedProg = allProgs[index].PROGRAMA;
          toggleFilter("programa", clickedProg);
        }
      },

      scales: {
        x: {
          grace: '30%',
          grid: { display: false },
          ticks: { display: false }
        },
        y: {
          grid: { display: false },
          afterFit: function (axis) {
            if (axis.width < 195) {
              axis.width = 195;
            }
          },
          ticks: {
            autoSkip: false,
            color: currentTheme === 'dark' ? '#cbd5e1' : '#1e293b',
            font: { size: 9.5, weight: '600' },
            padding: 8,
            callback: function (val) {
              const label = this.getLabelForValue(val);
              return formatChartProgramLabel(label);
            }
          }
        }
      }
    }
  });

}

function renderChartSedesPct(sedesData) {
  const canvas = document.getElementById("chartSedesPct");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartSedesPctInst) chartSedesPctInst.destroy();

  if (!sedesData || sedesData.length === 0) return;

  // Mostrar todas las sedes con citas pendientes, ordenadas de mayor a menor
  const list = [...sedesData].filter(s => (s.pendientes || 0) > 0);
  list.sort((a, b) => (b.pendientes || 0) - (a.pendientes || 0));

  const wrapper = document.getElementById("wrapperChartSedesPct");
  if (wrapper) {
    const calcHeight = Math.max(340, list.length * 28);
    wrapper.style.height = `${calcHeight}px`;
    canvas.style.height = `${calcHeight}px`;
  }

  const labels = list.map(s => s["NOMBRE IPS"] || s.sede || "Desconocida");
  const dataVals = list.map(s => s.pendientes || 0);

  chartSedesPctInst = new Chart(ctx, {
    type: 'bar',
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: [{
        label: 'Citas Pendientes',
        data: dataVals,
        backgroundColor: currentTheme === 'dark' ? '#38bdf8' : '#0284c7',
        borderColor: currentTheme === 'dark' ? '#0284c7' : '#0369a1',
        borderWidth: 1,
        borderRadius: 4,
        barPercentage: 0.72,
        categoryPercentage: 0.85
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { left: 14, right: 45, top: 4, bottom: 12 }
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end',
          align: 'end',
          offset: 6,
          clip: false,
          color: currentTheme === 'dark' ? '#f1f5f9' : '#0f172a',
          font: { weight: 'bold', size: 10 },
          formatter: (v) => (typeof v === 'number' ? v.toLocaleString('es-CO') : v)
        },
        tooltip: {
          callbacks: {
            title: (contexts) => contexts.length ? labels[contexts[0].dataIndex] : '',
            label: (context) => ` ⏳ Citas Pendientes: ${Number(context.raw).toLocaleString('es-CO')}`
          }
        }
      },
      onClick: (e, activeElements) => {
        if (activeElements.length > 0) {
          const index = activeElements[0].index;
          const clickedSede = labels[index];
          toggleFilter("sede", clickedSede);
        }
      },
      scales: {
        x: {
          grid: { color: currentTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
          ticks: {
            color: currentTheme === 'dark' ? '#cbd5e1' : '#1e293b',
            font: { size: 9.5 }
          }
        },
        y: {
          grid: { display: false },
          afterFit: function (axis) {
            if (axis.width < 145) {
              axis.width = 145;
            }
          },
          ticks: {
            color: currentTheme === 'dark' ? '#cbd5e1' : '#1e293b',
            font: { size: 9.5, weight: '600' },
            padding: 6
          }
        }
      }
    }
  });
}

function renderChartMeses(mesesData) {
  const canvas = document.getElementById("chartMeses");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartMesesInst) chartMesesInst.destroy();

  if (!mesesData || mesesData.length === 0) return;

  const labels = mesesData.map(m => m["Nombre del mes"]);
  const pendientesVals = mesesData.map(m => m.pendientes);
  const pctVals = mesesData.map(m => m.pct_pendientes);

  chartMesesInst = new Chart(ctx, {
    type: 'bar',
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: [
        {
          type: 'bar',
          label: 'Historias pendientes',
          data: pendientesVals,
          backgroundColor: '#0078d4',
          borderColor: '#005a9e',
          borderWidth: 1,
          borderRadius: 3,
          barPercentage: 0.45,
          categoryPercentage: 0.6,
          datalabels: {
            display: true,
            anchor: 'end',
            align: 'top',
            clip: false,
            color: '#0f172a',
            font: { weight: 'bold', size: 11 },
            formatter: (v) => (typeof v === 'number' ? v.toLocaleString('es-CO') : v)
          }
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 35, right: 25, bottom: 10, left: 10 }
      },
      plugins: {
        legend: {
          display: false
        },
        datalabels: {
          display: true
        }
      },
      onClick: (e, activeElements) => {
        if (activeElements.length > 0) {
          const index = activeElements[0].index;
          const clickedMes = labels[index];
          toggleFilter("mes", clickedMes);
        }
      },
      scales: {
        y: {
          type: 'linear',
          display: false,
          grace: '35%'
        },
        x: {
          grid: { display: false },
          ticks: {
            color: '#1e293b',
            font: { size: 10.5, weight: '600' }
          }
        }
      }
    }
  });
}





function onAuditorComboInput() {
  const input = document.getElementById("modalAuditorInput");
  const dropdown = document.getElementById("dropdownModalAuditor");
  if (!input || !dropdown) return;

  const val = input.value.toLowerCase().trim();
  const list = rawComboOptions.auditores || rawComboOptions.profesionales || [];

  const filtered = val
    ? list.filter(item => item.toLowerCase().includes(val)).slice(0, 25)
    : list.slice(0, 30);


  if (filtered.length === 0) {
    dropdown.style.display = "none";
    return;
  }

  dropdown.innerHTML = "";
  filtered.forEach(item => {
    const div = document.createElement("div");
    div.className = "combo-item";
    div.innerText = item;
    div.style.padding = "6px 10px";
    div.style.cursor = "pointer";
    div.style.fontSize = "12px";
    div.style.color = "#1e293b";
    div.onmouseenter = () => { div.style.backgroundColor = "#e2e8f0"; };
    div.onmouseleave = () => { div.style.backgroundColor = "#ffffff"; };
    div.onclick = (e) => {
      e.stopPropagation();
      input.value = item;
      dropdown.style.display = "none";
      try { localStorage.setItem("agendaweb_last_auditor_name", item); } catch (ex) { }
    };
    dropdown.appendChild(div);
  });

  dropdown.style.display = "block";
}

function onAuditorComboFocus() {
  onAuditorComboInput();
}

function clearAuditorCombo() {
  const input = document.getElementById("modalAuditorInput");
  const dropdown = document.getElementById("dropdownModalAuditor");
  if (input) input.value = "";
  if (dropdown) dropdown.style.display = "none";
}

// --- MODALES ---

function openFeedbackModal(idCita) {
  const item = currentDetalleData.find(d => d.id_cita === String(idCita));
  if (!item) return;

  isBulkAuditMode = false;
  selectedCita = item;

  const modalTitle = document.getElementById("modalFeedbackTitle");
  if (modalTitle) modalTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Gestión y Retroalimentación de Historia Clínica';

  document.getElementById("modalPacienteInfo").innerText = `${item.paciente} (${item.doc}: ${item.identificacion})`;
  document.getElementById("modalCitaDetalle").innerText = `Fecha: ${item.fecha} ${item.hora} | Sede: ${item.sede} | Prof: ${item.profesional}`;

  // Información enriquecida de PHC (Orden, Acción, Observación)
  const phcBox = document.getElementById("modalPHCBox");
  const phcElem = document.getElementById("modalPHCInfo");
  if (phcBox && phcElem) {
    const phcParts = [];
    if (item.orden_phc) phcParts.push(`Orden: <strong>${escapeHtml(item.orden_phc)}</strong>`);
    if (item.prestacion_phc) phcParts.push(`Prestación: <em>${escapeHtml(item.prestacion_phc)}</em>`);
    if (item.accion_phc) phcParts.push(`Acción: ${escapeHtml(item.accion_phc)}`);
    if (item.obs_phc) phcParts.push(`Obs PHC: ${escapeHtml(item.obs_phc)}`);
    if (phcParts.length > 0) {
      phcElem.innerHTML = phcParts.join(" &nbsp;|&nbsp; ");
      phcBox.style.display = "block";
    } else {
      phcBox.style.display = "none";
    }
  }

  // Manejo de divergencia asistencial de servicio (Opción 3)
  const discrepanciaBox = document.getElementById("modalDiscrepanciaBox");
  const cupAgendaElem = document.getElementById("modalCUPAgenda");
  const cupPHCElem = document.getElementById("modalCUPPHC");
  if (discrepanciaBox) {
    if (item.cambio_servicio && item.cup_phc) {
      if (cupAgendaElem) cupAgendaElem.innerText = item.servicio || item.programa || "-";
      if (cupPHCElem) cupPHCElem.innerText = item.cup_phc;
      discrepanciaBox.style.display = "flex";
    } else {
      discrepanciaBox.style.display = "none";
    }
  }

  // Manejo de Historial de Auditorías Previas (Opción 2)
  const histContainer = document.getElementById("modalAuditHistoryContainer");
  const histBadge = document.getElementById("modalAuditHistoryBadge");
  const histList = document.getElementById("modalAuditHistoryList");

  const localRec = localFeedbackStore[String(idCita)] || {};
  let historyEntries = [];
  if (Array.isArray(item.historial) && item.historial.length > 0) {
    historyEntries = item.historial;
  } else if (Array.isArray(localRec.historial) && localRec.historial.length > 0) {
    historyEntries = localRec.historial;
  }

  if (histContainer && histList) {
    if (historyEntries.length > 0) {
      histContainer.style.display = "block";
      if (histBadge) histBadge.innerText = `${historyEntries.length} auditoría${historyEntries.length > 1 ? 's' : ''} previa${historyEntries.length > 1 ? 's' : ''}`;
      histList.innerHTML = historyEntries.map(h => `
        <div class="audit-history-item">
          <div class="audit-history-item-header">
            <span class="audit-history-auditor"><i class="fa-solid fa-user-check"></i> ${escapeHtml(h.auditor || "Auditor")}</span>
            <span class="audit-history-date"><i class="fa-regular fa-clock"></i> ${escapeHtml(h.fecha_gestion || "-")}</span>
          </div>
          <div class="audit-history-detail">
            <strong>Estado PHC:</strong> ${escapeHtml(h.estado_phc || h.estado || "-")}
            ${h.nota_aclaratoria ? ` | <em>${escapeHtml(h.nota_aclaratoria)}</em>` : ''}
            ${h.observacion ? `<br><span style="color:#64748b;">Obs: ${escapeHtml(h.observacion)}</span>` : ''}
          </div>
        </div>
      `).join("");
    } else {
      histContainer.style.display = "none";
      histList.innerHTML = "";
    }
  }

  enforceOfficialPHCSelectOptions();
  const selectPHC = document.getElementById("modalEstadoPHC");
  if (selectPHC) {
    selectPHC.value = "";
    // Solo si el registro ya cuenta con una auditoría previa explícita en uno de los estados válidos, se preselecciona al editar
    const prevAuditPHC = (localRec && localRec.estado_phc) || (item.auditor_fb && item.estado_phc);
    if (prevAuditPHC && prevAuditPHC.toLowerCase() !== "confirmada") {
      for (let opt of selectPHC.options) {
        if (opt.value && opt.value.toLowerCase() === prevAuditPHC.toLowerCase()) {
          selectPHC.value = opt.value;
          break;
        }
      }
    }
  }

  const savedNota = (localRec && localRec.nota_aclaratoria) || item.nota_aclaratoria || item.estado_fb || "";
  onModalEstadoPHCChange(savedNota);

  document.getElementById("modalObservacion").value = item.observacion_fb || "";

  const savedAuditor = localStorage.getItem("agendaweb_last_auditor_name") || item.auditor_fb || "";
  const savedCedula = localStorage.getItem("agendaweb_last_auditor_cedula") || "";

  document.getElementById("modalAuditorInput").value = savedAuditor;
  document.getElementById("modalAuditorCedula").value = savedCedula;

  const submitBtn = document.getElementById("btnSubmitFeedback");
  if (submitBtn) submitBtn.innerText = "Guardar y Sincronizar";

  document.getElementById("feedbackModal").classList.add("open");
}

function openBulkFeedbackModal() {
  if (selectedCitasSet.size === 0) {
    alert("Por favor seleccione al menos una historia clínica para auditar.");
    return;
  }

  isBulkAuditMode = true;
  selectedCita = null;

  const count = selectedCitasSet.size;
  const modalTitle = document.getElementById("modalFeedbackTitle");
  if (modalTitle) modalTitle.innerHTML = `<i class="fa-solid fa-list-check"></i> Auditoría Masiva de Historias Clínicas (${count} seleccionadas)`;

  document.getElementById("modalPacienteInfo").innerHTML = `<span style="color: #0284c7; font-size: 13px; font-weight: 700;">${count} historias clínicas seleccionadas para auditoría en lote</span>`;
  document.getElementById("modalCitaDetalle").innerText = `Se aplicará el mismo estado PHC, nota aclaratoria y observación a todas las ${count} historias clínicas seleccionadas.`;

  const discrepanciaBox = document.getElementById("modalDiscrepanciaBox");
  if (discrepanciaBox) discrepanciaBox.style.display = "none";
  const histContainer = document.getElementById("modalAuditHistoryContainer");
  if (histContainer) histContainer.style.display = "none";

  enforceOfficialPHCSelectOptions();
  const selectPHC = document.getElementById("modalEstadoPHC");
  if (selectPHC) selectPHC.value = "";

  onModalEstadoPHCChange("");

  document.getElementById("modalObservacion").value = "";

  const savedAuditor = localStorage.getItem("agendaweb_last_auditor_name") || "";
  const savedCedula = localStorage.getItem("agendaweb_last_auditor_cedula") || "";

  document.getElementById("modalAuditorInput").value = savedAuditor;
  document.getElementById("modalAuditorCedula").value = savedCedula;

  const submitBtn = document.getElementById("btnSubmitFeedback");
  if (submitBtn) submitBtn.innerText = `Guardar ${count} Gestiones y Sincronizar`;

  document.getElementById("feedbackModal").classList.add("open");
}

function closeFeedbackModal() {
  document.getElementById("feedbackModal").classList.remove("open");
  const dropdown = document.getElementById("dropdownModalAuditor");
  if (dropdown) dropdown.style.display = "none";
  const discrepanciaBox = document.getElementById("modalDiscrepanciaBox");
  if (discrepanciaBox) discrepanciaBox.style.display = "none";
  const histContainer = document.getElementById("modalAuditHistoryContainer");
  if (histContainer) histContainer.style.display = "none";
  selectedCita = null;
  isBulkAuditMode = false;
}

async function saveFeedback() {
  if (!isBulkAuditMode && !selectedCita) return;
  if (isBulkAuditMode && selectedCitasSet.size === 0) return;

  const saveBtn = document.getElementById("btnSubmitFeedback") || document.querySelector("#feedbackForm button[type='submit']");
  const origHtml = saveBtn ? saveBtn.innerHTML : 'Guardar y Sincronizar';

  const estado_phc = (document.getElementById("modalEstadoPHC") ? document.getElementById("modalEstadoPHC").value : "").trim();
  const selectNota = document.getElementById("modalNotaAclaratoria") || document.getElementById("modalEstado");
  const nota_aclaratoria = (selectNota ? selectNota.value : "").trim();
  const estado = nota_aclaratoria || estado_phc;
  const observacion = (document.getElementById("modalObservacion").value || "").trim();
  const auditor = (document.getElementById("modalAuditorInput").value || "").trim();
  const cedula_last4 = (document.getElementById("modalAuditorCedula").value || "").trim();

  if (!estado_phc) {
    alert("Por favor seleccione el Estado actual de la historia clínica en PHC (Obligatorio).");
    if (document.getElementById("modalEstadoPHC")) document.getElementById("modalEstadoPHC").focus();
    return;
  }

  if (!ESTADOS_PHC_OFICIALES.includes(estado_phc)) {
    alert(`⚠️ Versión desactualizada detectada.\n\nEl estado '${estado_phc}' ya no es válido en el sistema.\nLa página se recargará ahora para cargar la última versión oficial.`);
    window.location.reload(true);
    return;
  }

  if (!nota_aclaratoria) {
    alert("Por favor seleccione la Nota aclaratoria (Obligatorio).");
    if (selectNota) selectNota.focus();
    return;
  }

  const validNotas = NOTAS_POR_ESTADO_PHC[estado_phc] || [];
  if (!validNotas.includes(nota_aclaratoria)) {
    alert(`La nota aclaratoria seleccionada no corresponde al estado '${estado_phc}'. Por favor verifique.`);
    if (selectNota) selectNota.focus();
    return;
  }

  if (!auditor) {
    alert("Por favor ingrese o seleccione su Nombre de Auditor / Usuario (Obligatorio).");
    return;
  }

  if (!cedula_last4 || cedula_last4.length !== 4 || !/^\d{4}$/.test(cedula_last4)) {
    alert("Por favor ingrese únicamente los 4 últimos dígitos numéricos de su Cédula (Obligatorio como validador).");
    return;
  }

  // Validar coincidencia estricta con la cédula del usuario en la base de datos
  let realCedula = userCedulaMap[auditor];
  if (!realCedula && userCedulaMap) {
    const key = Object.keys(userCedulaMap).find(k => k.toLowerCase().trim() === auditor.toLowerCase().trim());
    if (key) realCedula = userCedulaMap[key];
  }

  if (realCedula) {
    const realStr = String(realCedula).trim();
    if (!realStr.endsWith(cedula_last4)) {
      alert(`❌ Validación de Seguridad Fallida:\n\nLos 4 últimos dígitos ingresados (${cedula_last4}) NO coinciden con la cédula registrada para el usuario [${auditor}].\n\nPor favor verifique e intente nuevamente.`);
      return;
    }
  }

  const cedula_auditor = cedula_last4;

  try {
    localStorage.setItem("agendaweb_last_auditor_name", auditor);
    localStorage.setItem("agendaweb_last_auditor_cedula", cedula_last4);
  } catch (ex) { }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
  }

  try {
    if (isBulkAuditMode) {
      const ids_citas = Array.from(selectedCitasSet);
      if (saveBtn) {
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando ${ids_citas.length} historias...`;
      }

      let success = false;
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids_citas, estado, nota_aclaratoria, estado_phc, observacion, auditor, cedula_auditor })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) success = true;
        }
      } catch (e) {
        console.warn("Backend Python local no disponible para auditoría masiva. Enviando directo a Google Apps Script...", e);
      }

      if (!success) {
        // Fallback directo a Google Apps Script para GitHub Pages / Web
        const batchRecords = ids_citas.map(id => {
          const item = (currentDetalleData && currentDetalleData.find(d => String(d.id_cita) === String(id))) ||
            (rawDashboardData && rawDashboardData.detalle_pendientes && rawDashboardData.detalle_pendientes.find(d => String(d.id_cita) === String(id))) || {};
          return {
            id_cita: id,
            estado: estado,
            nota_aclaratoria: nota_aclaratoria,
            estado_phc: estado_phc,
            observacion: observacion,
            auditor: auditor,
            cedula_auditor: cedula_auditor,
            fecha_gestion: new Date().toLocaleString('es-CO'),
            ip_equipo: "Web App (GitHub Pages)",
            usuario_pc: "Usuario Web",
            nombre_equipo: "Navegador Web",
            sede: item.nombre_ips || item.sede || "",
            fecha_cita: item.fecha || item.fecha_atencion || "",
            hora_cita: item.hora || item.hora_atencion || "",
            programa: item.programa || item.servicio || "",
            id_profesional: item.cedula || "",
            nombre_profesional: item.profesional || item.nombre_profesional || ""
          };
        });

        // Envío atómico en un solo lote para evitar colisiones de concurrencia y sobreescrituras en Google Sheets
        const batchPayload = {
          action: "save_batch_feedback",
          records: batchRecords
        };

        try {
          await fetch(OFFICIAL_APPS_SCRIPT_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(batchPayload)
          });
          success = true;
        } catch (errBatch) {
          console.warn("Aviso al enviar lote a Google Apps Script:", errBatch);
          // Fallback secuencial (uno a uno, no en paralelo para evitar condiciones de carrera)
          for (const rec of batchRecords) {
            try {
              await fetch(OFFICIAL_APPS_SCRIPT_URL, {
                method: "POST",
                mode: "no-cors",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(rec)
              });
            } catch (errSingle) { }
          }
          success = true;
        }
      }

      if (success) {
        const todayStr = new Date().toLocaleDateString('es-CO');
        ids_citas.forEach(id => {
          saveLocalFeedback(id, {
            estado: estado,
            nota_aclaratoria: nota_aclaratoria,
            estado_phc: estado_phc,
            observacion: observacion,
            auditor: auditor,
            fecha_gestion: todayStr
          });

          const itm = currentDetalleData.find(d => String(d.id_cita) === String(id));
          if (itm) {
            itm.estado_phc = estado_phc;
            itm.estado_fb = estado;
            itm.nota_aclaratoria = nota_aclaratoria;
            itm.observacion_fb = observacion;
            itm.auditor_fb = auditor;
            itm.fecha_fb = todayStr;
          }
          if (rawDashboardData && rawDashboardData.detalle_pendientes) {
            const rItm = rawDashboardData.detalle_pendientes.find(d => String(d.id_cita) === String(id));
            if (rItm) {
              rItm.estado_phc = estado_phc;
              rItm.estado_fb = estado;
              rItm.nota_aclaratoria = nota_aclaratoria;
              rItm.observacion_fb = observacion;
              rItm.auditor_fb = auditor;
              rItm.fecha_fb = todayStr;
            }
          }
        });

        selectedCitasSet.clear();
        updateBulkActionButton();
        closeFeedbackModal();
        cachedDashboardByPeriodo = {};
        renderCurrentDataState();
        fetchDashboardData(true);
      }

    } else {
      // Modo auditoría individual
      const id_cita = selectedCita.id_cita;
      const cSede = selectedCita.nombre_ips || selectedCita.sede || "";
      const cFecha = selectedCita.fecha || selectedCita.fecha_atencion || "";
      const cHora = selectedCita.hora || selectedCita.hora_atencion || "";
      const cProg = selectedCita.programa || selectedCita.servicio || "";
      const cIdProf = selectedCita.cedula || "";
      const cNomProf = selectedCita.profesional || selectedCita.nombre_profesional || "";

      let success = false;
      let serverHistorial = null;
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_cita, estado, nota_aclaratoria, estado_phc, observacion, auditor, cedula_auditor,
            sede: cSede, fecha_cita: cFecha, hora_cita: cHora, programa: cProg, id_profesional: cIdProf, nombre_profesional: cNomProf
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            success = true;
            if (data.historial) serverHistorial = data.historial;
          }
        }
      } catch (e) {
        console.warn("Backend Python local no disponible. Enviando directo a Google Apps Script...", e);
      }

      if (!success) {
        const payload = {
          id_cita: id_cita,
          estado: estado,
          nota_aclaratoria: nota_aclaratoria,
          estado_phc: estado_phc,
          observacion: observacion,
          auditor: auditor,
          cedula_auditor: cedula_auditor,
          fecha_gestion: new Date().toLocaleString('es-CO'),
          ip_equipo: "Web App (GitHub Pages)",
          usuario_pc: "Usuario Web",
          nombre_equipo: "Navegador Web",
          sede: cSede,
          fecha_cita: cFecha,
          hora_cita: cHora,
          programa: cProg,
          id_profesional: cIdProf,
          nombre_profesional: cNomProf
        };

        await fetch(OFFICIAL_APPS_SCRIPT_URL, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        success = true;
      }

      if (success) {
        const todayStr = new Date().toLocaleDateString('es-CO');
        const feedbackPayload = {
          estado: estado,
          nota_aclaratoria: nota_aclaratoria,
          estado_phc: estado_phc,
          observacion: observacion,
          auditor: auditor,
          fecha_gestion: todayStr
        };
        if (serverHistorial) {
          feedbackPayload.historial = serverHistorial;
        }
        saveLocalFeedback(id_cita, feedbackPayload);

        const currentHist = serverHistorial || (localFeedbackStore[String(id_cita)] && localFeedbackStore[String(id_cita)].historial);

        if (selectedCita) {
          selectedCita.estado_phc = estado_phc;
          selectedCita.estado_fb = estado;
          selectedCita.nota_aclaratoria = nota_aclaratoria;
          selectedCita.observacion_fb = observacion;
          selectedCita.auditor_fb = auditor;
          selectedCita.fecha_fb = todayStr;
          if (currentHist) selectedCita.historial = currentHist;
        }
        if (rawDashboardData && rawDashboardData.detalle_pendientes) {
          const rItm = rawDashboardData.detalle_pendientes.find(d => String(d.id_cita) === String(id_cita));
          if (rItm) {
            rItm.estado_phc = estado_phc;
            rItm.estado_fb = estado;
            rItm.nota_aclaratoria = nota_aclaratoria;
            rItm.observacion_fb = observacion;
            rItm.auditor_fb = auditor;
            rItm.fecha_fb = todayStr;
            if (currentHist) rItm.historial = currentHist;
          }
        }
        selectedCitasSet.delete(String(id_cita));
        updateBulkActionButton();
        closeFeedbackModal();
        cachedDashboardByPeriodo = {};
        renderCurrentDataState();
        fetchDashboardData(true);
      }
    }

  } catch (err) {
    console.error("Error al guardar gestión:", err);
    alert("No se pudo enviar la gestión a Google Sheets.");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = origHtml;
    }
  }
}



async function downloadExcel() {
  // 1. Intentar descargar desde el backend local si está ejecutándose
  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters: currentFilters })
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Citas_Pendientes_AGENDAWEB_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
  } catch (err) {
    console.log("Backend dinámico no disponible, generando Excel directamente en el navegador (Web)...");
  }

  // 2. Fallback del lado del cliente usando SheetJS o Blob
  try {
    const data = rawDashboardData ? applyClientFiltersToData(rawDashboardData, currentFilters) : null;
    const detalles = (data && data.detalle_pendientes) ? data.detalle_pendientes : [];

    if (!detalles || detalles.length === 0) {
      alert("No hay citas pendientes disponibles para exportar con los filtros seleccionados.");
      return;
    }

    const headersDetalle = [
      "Fecha", "Hora", "Sede", "Tipo Doc", "Identificación",
      "Paciente", "Programa", "Profesional", "Estado PHC", "Nota Aclaratoria",
      "Observación Auditor", "Auditor"
    ];

    const rowsDetalle = detalles.map(item => {
      return {
        "Fecha": item.fecha || "",
        "Hora": item.hora || "",
        "Sede": item.sede || "",
        "Tipo Doc": item.doc || item.tipo_doc || "CC",
        "Identificación": item.identificacion || "",
        "Paciente": item.paciente || "",
        "Programa": item.programa || "",
        "Profesional": item.profesional || "",
        "Estado PHC": item.estado_phc || "Confirmada",
        "Nota Aclaratoria": item.estado_fb || item.nota_aclaratoria || item.estado || "",
        "Observación Auditor": item.observacion_fb || item.observacion || "",
        "Auditor": item.auditor_fb || item.auditor || ""
      };
    });

    if (typeof XLSX !== "undefined") {
      const wb = XLSX.utils.book_new();

      // Hoja 1: Resumen Sedes
      const sedesSummary = (data && data.sedes_summary) ? data.sedes_summary : [];
      const headersSedes = ["Sede / CIS", "Total Pendientes", "En Progreso", "Sin Auditar", "% Cobertura Gestión"];
      const rowsSedes = sedesSummary.map(s => ({
        "Sede / CIS": s["NOMBRE IPS"] || "",
        "Total Pendientes": s.pendientes || 0,
        "En Progreso": s.en_progreso || 0,
        "Sin Auditar": s.sin_auditar !== undefined ? s.sin_auditar : Math.max(0, (s.pendientes || 0) - (s.gestionadas || 0)),
        "% Cobertura Gestión": `${s.pct_gestion || 0}%`
      }));
      const wsSedes = XLSX.utils.json_to_sheet(rowsSedes, { header: headersSedes });
      wsSedes['!cols'] = headersSedes.map(h => ({
        wch: Math.max(h.length + 3, ...rowsSedes.map(r => String(r[h] || '').length + 2))
      }));
      XLSX.utils.book_append_sheet(wb, wsSedes, "Resumen Sedes");

      // Hoja 2: Citas por Profesional
      const medicosPending = (data && data.medicos_pending) ? data.medicos_pending : [];
      const headersMedicos = ["Profesional", "Identificación", "Sede Asignada", "Especialidad Principal", "Pendientes"];
      const rowsMedicos = medicosPending.map(m => ({
        "Profesional": m["NOMBRE PROFESIONAL"] || "",
        "Identificación": m.identificacion || "",
        "Sede Asignada": m["NOMBRE IPS"] || "",
        "Especialidad Principal": m.specialty || getDoctorSpecialty(m["NOMBRE PROFESIONAL"]),
        "Pendientes": m.pendientes || 0
      }));
      const wsMedicos = XLSX.utils.json_to_sheet(rowsMedicos, { header: headersMedicos });
      wsMedicos['!cols'] = headersMedicos.map(h => ({
        wch: Math.max(h.length + 3, ...rowsMedicos.map(r => String(r[h] || '').length + 2))
      }));
      XLSX.utils.book_append_sheet(wb, wsMedicos, "Por Profesional");

      // Hoja 3: Detalle Citas
      const wsDetalle = XLSX.utils.json_to_sheet(rowsDetalle, { header: headersDetalle });
      wsDetalle['!cols'] = headersDetalle.map(h => ({
        wch: Math.max(h.length + 3, ...rowsDetalle.map(r => String(r[h] || '').length + 2))
      }));
      XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle Citas");

      XLSX.writeFile(wb, `Citas_Pendientes_AGENDAWEB_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } else {
      // Respaldo secundario a archivo CSV compatible con Excel (BOM UTF-8)
      let csvContent = "\uFEFF" + headersDetalle.join(";") + "\n";
      rowsDetalle.forEach(r => {
        const line = headersDetalle.map(h => `"${String(r[h] || "").replace(/"/g, '""')}"`).join(";");
        csvContent += line + "\n";
      });

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Citas_Pendientes_AGENDAWEB_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } catch (err) {
    console.error("Error al exportar Excel en el navegador:", err);
    alert("Error al descargar el archivo Excel.");
  }
}

// =========================================================================
// GESTOR INTEGRAL DEL PANEL DE CONFIGURACIÓN DEL SISTEMA (LOCAL)
// =========================================================================

let loadedSystemConfig = null;
let currentCleaningRules = [];
currentCisMappings = currentCisMappings || {};

function openConfigModal() {
  const modal = document.getElementById("configModal");
  if (modal) {
    modal.classList.add("open");
    loadConfigData();
  }
}

function closeConfigModal() {
  const modal = document.getElementById("configModal");
  if (modal) modal.classList.remove("open");
}

function switchConfigTab(tabKey) {
  const tabs = ['db', 'clean', 'cis', 'github'];
  tabs.forEach(k => {
    const btn = document.getElementById(`tabBtn-${k}`);
    const pane = document.getElementById(`tabPane-${k}`);
    if (btn) btn.classList.toggle('active', k === tabKey);
    if (pane) pane.classList.toggle('active', k === tabKey);
  });
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPwd = input.type === 'password';
  input.type = isPwd ? 'text' : 'password';
  const icon = btn.querySelector('i');
  if (icon) {
    icon.className = isPwd ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  }
}

async function loadConfigData() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Error HTTP " + res.status);
    const data = await res.json();
    loadedSystemConfig = data;

    const dbCfg = data.db_config || {};
    const dbParams = dbCfg.database || {};
    const ghParams = dbCfg.github || {};
    const dbs = dbParams.databases || {};
    const publicCfg = data.config || {};

    // Pestaña 1: Base de Datos
    const hostEl = document.getElementById("cfgDbHost");
    if (hostEl) hostEl.value = dbParams.server || "172.200.6.135";
    const portEl = document.getElementById("cfgDbPort");
    if (portEl) portEl.value = dbParams.port || "1433";
    const userEl = document.getElementById("cfgDbUser");
    if (userEl) userEl.value = dbParams.username || "gesis";
    const pwdEl = document.getElementById("cfgDbPassword");
    if (pwdEl) pwdEl.value = dbParams.password || "";
    const agEl = document.getElementById("cfgDbAgenda");
    if (agEl) agEl.value = dbs.agendaweb || "BDAGENDAWEB";
    const svEl = document.getElementById("cfgDbSvces");
    if (svEl) svEl.value = dbs.svces || "BDSVCES";
    const sapEl = document.getElementById("cfgDbSap");
    if (sapEl) sapEl.value = dbs.sap || "BDSAP";

    const dbStatus = document.getElementById("cfgDbStatus");
    if (dbStatus) {
      dbStatus.className = "config-status-tag";
      dbStatus.style.display = "none";
      dbStatus.innerHTML = "";
    }

    // Pestaña 2: Reglas de Limpieza
    currentCleaningRules = Array.isArray(publicCfg.text_cleaning_rules) ? JSON.parse(JSON.stringify(publicCfg.text_cleaning_rules)) : [];
    renderCleaningRulesTable();

    // Pestaña 3: Mapeo de CIS
    currentCisMappings = (publicCfg.cis_mappings && typeof publicCfg.cis_mappings === 'object') ? JSON.parse(JSON.stringify(publicCfg.cis_mappings)) : {};
    renderCisCards();

    // Pestaña 4: GitHub
    const ghRepoEl = document.getElementById("cfgGhRepo");
    if (ghRepoEl) ghRepoEl.value = ghParams.repo || "unionsaludvida2/cierredehistorias";
    const ghBranchEl = document.getElementById("cfgGhBranch");
    if (ghBranchEl) ghBranchEl.value = ghParams.branch || "main";
    const ghTokenEl = document.getElementById("cfgGhToken");
    if (ghTokenEl) ghTokenEl.value = ghParams.token || "";

    const ghStatus = document.getElementById("cfgGhStatus");
    if (ghStatus) {
      ghStatus.className = "config-status-tag";
      ghStatus.style.display = "none";
      ghStatus.innerHTML = "";
    }
  } catch (err) {
    console.error("Error al cargar configuración:", err);
    showToast("Error al cargar la configuración desde el servidor local.");
  }
}

// --- PESTAÑA 2: CONTROLADOR DE REGLAS DE LIMPIEZA DE TEXTO ---
function renderCleaningRulesTable(filterQuery = "") {
  const tbody = document.getElementById("tbodyCleaningRules");
  const countBadge = document.getElementById("cleaningRulesCount");
  if (!tbody) return;

  tbody.innerHTML = "";
  const q = (filterQuery || "").trim().toLowerCase();

  let visibleCount = 0;
  currentCleaningRules.forEach((rule, index) => {
    const target = Array.isArray(rule) ? (rule[0] || "") : "";
    const replacement = Array.isArray(rule) ? (rule[1] || "") : "";

    if (q && !target.toLowerCase().includes(q) && !replacement.toLowerCase().includes(q)) {
      return;
    }
    visibleCount++;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${escapeHtml(target)}</code></td>
      <td>${replacement ? `<code>${escapeHtml(replacement)}</code>` : '<em style="color:#94a3b8;">(Eliminar / Vacío)</em>'}</td>
      <td style="text-align: center;">
        <button type="button" class="btn-icon-del" onclick="removeCleaningRule(${index})" title="Eliminar regla">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (countBadge) {
    countBadge.innerText = `${visibleCount} de ${currentCleaningRules.length} reglas`;
  }

  if (visibleCount === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#94a3b8; padding:18px;">No se encontraron reglas que coincidan.</td></tr>`;
  }
}

function filterCleaningRulesTable() {
  const input = document.getElementById("searchCleaningRules");
  renderCleaningRulesTable(input ? input.value : "");
}

function addTextCleaningRule() {
  const targetEl = document.getElementById("newRuleTarget");
  const replEl = document.getElementById("newRuleReplacement");
  if (!targetEl) return;

  const target = targetEl.value.trim();
  const replacement = replEl ? replEl.value.trim() : "";

  if (!target) {
    alert("Por favor ingrese el texto o patrón a buscar.");
    targetEl.focus();
    return;
  }

  // Verificar si ya existe exactamente la misma regla
  const exists = currentCleaningRules.some(r => Array.isArray(r) && r[0] === target);
  if (exists) {
    if (!confirm(`La regla para "${target}" ya existe. ¿Desea actualizar su reemplazo?`)) {
      return;
    }
    currentCleaningRules = currentCleaningRules.filter(r => !(Array.isArray(r) && r[0] === target));
  }

  currentCleaningRules.push([target, replacement]);
  targetEl.value = "";
  if (replEl) replEl.value = "";

  renderCleaningRulesTable(document.getElementById("searchCleaningRules") ? document.getElementById("searchCleaningRules").value : "");
  showToast(`Regla "${target}" agregada correctamente.`);
}

function removeCleaningRule(index) {
  if (index >= 0 && index < currentCleaningRules.length) {
    const removed = currentCleaningRules.splice(index, 1);
    renderCleaningRulesTable(document.getElementById("searchCleaningRules") ? document.getElementById("searchCleaningRules").value : "");
    showToast(`Regla "${removed[0] ? removed[0][0] : ''}" eliminada.`);
  }
}

// --- PESTAÑA 3: CONTROLADOR DE MAPEO DE SEDES (CIS) ---
function renderCisCards(filterQuery = "") {
  const container = document.getElementById("cisCardsContainer");
  const countBadge = document.getElementById("cisMappingsCount");
  if (!container) return;

  container.innerHTML = "";
  const q = (filterQuery || "").trim().toLowerCase();

  const keys = Object.keys(currentCisMappings);
  let visibleCount = 0;

  keys.forEach(canonical => {
    const aliases = Array.isArray(currentCisMappings[canonical]) ? currentCisMappings[canonical] : [];

    // Filtro predictivo
    if (q) {
      const matchCanonical = canonical.toLowerCase().includes(q);
      const matchAlias = aliases.some(a => (a || "").toLowerCase().includes(q));
      if (!matchCanonical && !matchAlias) return;
    }
    visibleCount++;

    const card = document.createElement("div");
    card.className = "cis-card";

    // Encabezado
    const header = document.createElement("div");
    header.className = "cis-card-header";
    header.innerHTML = `
      <span class="cis-canonical-name">
        <i class="fa-solid fa-hospital"></i> ${escapeHtml(canonical)}
        <small style="color:#64748b; font-weight:normal;">(${aliases.length} variante${aliases.length === 1 ? '' : 's'})</small>
      </span>
      <button type="button" class="btn-icon-del" onclick="deleteCisCanonical('${escapeJsString(canonical)}')" title="Eliminar sede canónica y sus variantes">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    `;
    card.appendChild(header);

    // Contenedor de chips de variantes
    const chipsBox = document.createElement("div");
    chipsBox.className = "cis-chips-container";

    aliases.forEach(alias => {
      const chip = document.createElement("span");
      chip.className = "cis-chip";
      chip.innerHTML = `
        ${escapeHtml(alias)}
        <span class="chip-remove" onclick="removeCisAlias('${escapeJsString(canonical)}', '${escapeJsString(alias)}')" title="Eliminar variante">&times;</span>
      `;
      chipsBox.appendChild(chip);
    });

    // Input inline para agregar variante rápida
    const inputInline = document.createElement("input");
    inputInline.type = "text";
    inputInline.className = "cis-add-alias-input";
    inputInline.placeholder = "+ Variante [Enter]";
    inputInline.title = "Escriba una variante y presione Enter para agregarla";
    inputInline.onkeydown = function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCisAliasFromInput(canonical, this);
      }
    };
    chipsBox.appendChild(inputInline);

    card.appendChild(chipsBox);
    container.appendChild(card);
  });

  if (countBadge) {
    countBadge.innerText = `${visibleCount} de ${keys.length} sedes`;
  }

  if (visibleCount === 0) {
    container.innerHTML = `<div style="text-align:center; color:#94a3b8; padding:24px; background:#fff; border-radius:8px; border:1px dashed #cbd5e1;">No se encontraron sedes configuradas. Puede crear una nueva arriba.</div>`;
  }
}

function filterCisCards() {
  const input = document.getElementById("searchCisMappings");
  renderCisCards(input ? input.value : "");
}

function addNewCisCanonical() {
  const canEl = document.getElementById("newCisCanonical");
  const aliEl = document.getElementById("newCisInitialAliases");
  if (!canEl) return;

  const canonical = canEl.value.trim();
  if (!canonical) {
    alert("Por favor ingrese el nombre canónico oficial de la sede.");
    canEl.focus();
    return;
  }

  let aliases = [];
  if (aliEl && aliEl.value.trim()) {
    aliases = aliEl.value.split(",").map(s => s.trim()).filter(Boolean);
  }

  // Si ya existe la sede, combinar
  if (currentCisMappings[canonical]) {
    aliases.forEach(a => {
      if (!currentCisMappings[canonical].includes(a)) {
        currentCisMappings[canonical].push(a);
      }
    });
  } else {
    currentCisMappings[canonical] = aliases;
  }

  canEl.value = "";
  if (aliEl) aliEl.value = "";

  renderCisCards(document.getElementById("searchCisMappings") ? document.getElementById("searchCisMappings").value : "");
  showToast(`Sede "${canonical}" configurada con éxito.`);
}

function deleteCisCanonical(canonical) {
  if (confirm(`¿Está seguro de eliminar la sede canónica "${canonical}" y todas sus variantes asociadas?`)) {
    delete currentCisMappings[canonical];
    renderCisCards(document.getElementById("searchCisMappings") ? document.getElementById("searchCisMappings").value : "");
    showToast(`Sede "${canonical}" eliminada.`);
  }
}

function addCisAliasFromInput(canonical, inputEl) {
  if (!inputEl) return;
  const val = inputEl.value.trim();
  if (!val) return;

  if (!Array.isArray(currentCisMappings[canonical])) {
    currentCisMappings[canonical] = [];
  }

  if (currentCisMappings[canonical].includes(val)) {
    alert(`La variante "${val}" ya se encuentra registrada para la sede "${canonical}".`);
    return;
  }

  currentCisMappings[canonical].push(val);
  inputEl.value = "";
  renderCisCards(document.getElementById("searchCisMappings") ? document.getElementById("searchCisMappings").value : "");
  showToast(`Variante "${val}" agregada a ${canonical}.`);
}

function removeCisAlias(canonical, alias) {
  if (Array.isArray(currentCisMappings[canonical])) {
    currentCisMappings[canonical] = currentCisMappings[canonical].filter(a => a !== alias);
    renderCisCards(document.getElementById("searchCisMappings") ? document.getElementById("searchCisMappings").value : "");
  }
}

// --- PESTAÑA 1: PROBAR CONEXIÓN SQL SERVER ---
async function testDbConnection() {
  const statusEl = document.getElementById("cfgDbStatus");
  const btn = document.getElementById("btnTestDb");
  if (!statusEl) return;

  const server = (document.getElementById("cfgDbHost")?.value || "").trim();
  const port = (document.getElementById("cfgDbPort")?.value || "1433").trim();
  const username = (document.getElementById("cfgDbUser")?.value || "").trim();
  const password = (document.getElementById("cfgDbPassword")?.value || "").trim();
  const agendaweb = (document.getElementById("cfgDbAgenda")?.value || "BDAGENDAWEB").trim();
  const svces = (document.getElementById("cfgDbSvces")?.value || "BDSVCES").trim();
  const sap = (document.getElementById("cfgDbSap")?.value || "BDSAP").trim();

  statusEl.className = "config-status-tag loading";
  statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Probando conexión SQL...`;
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/config/test_db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        database: {
          server,
          port,
          username,
          password,
          databases: { agendaweb, svces, sap }
        }
      })
    });

    const data = await res.json();
    if (data.success) {
      statusEl.className = "config-status-tag success";
      statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${escapeHtml(data.message || "Conexión exitosa a SQL Server")}`;
    } else {
      statusEl.className = "config-status-tag error";
      statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Error: ${escapeHtml(data.message || "Fallo de conexión")}`;
    }
  } catch (err) {
    statusEl.className = "config-status-tag error";
    statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Error de red al probar conexión`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- PESTAÑA 4: CONEXIÓN Y PUSH A GITHUB ---
async function testGithubConnection() {
  const statusEl = document.getElementById("cfgGhStatus");
  const btn = document.getElementById("btnTestGithub");
  if (!statusEl) return;

  const repo = (document.getElementById("cfgGhRepo")?.value || "unionsaludvida2/cierredehistorias").trim();
  const token = (document.getElementById("cfgGhToken")?.value || "").trim();

  if (!token) {
    statusEl.className = "config-status-tag error";
    statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Ingrese un Personal Access Token (PAT)`;
    return;
  }

  statusEl.className = "config-status-tag loading";
  statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verificando conexión GitHub API...`;
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/config/test_github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, token })
    });

    const data = await res.json();
    if (data.success) {
      statusEl.className = "config-status-tag success";
      statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${escapeHtml(data.message || "Conexión a GitHub exitosa")}`;
    } else {
      statusEl.className = "config-status-tag error";
      statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Error: ${escapeHtml(data.message || "Fallo de autenticación")}`;
    }
  } catch (err) {
    statusEl.className = "config-status-tag error";
    statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Error de red al conectar con GitHub API`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function pushChangesToGithub() {
  const repo = (document.getElementById("cfgGhRepo")?.value || "unionsaludvida2/cierredehistorias").trim();
  const branch = (document.getElementById("cfgGhBranch")?.value || "main").trim();
  const token = (document.getElementById("cfgGhToken")?.value || "").trim();
  const commitMsg = (document.getElementById("cfgGhCommitMsg")?.value || "Actualización de configuración y reglas desde panel local").trim();

  if (!token) {
    alert("Debe ingresar un Personal Access Token (PAT) de GitHub para autorizar la sincronización.");
    switchConfigTab("github");
    const tokEl = document.getElementById("cfgGhToken");
    if (tokEl) tokEl.focus();
    return;
  }

  // Lista de archivos seleccionados
  const files = [];
  if (document.getElementById("ghSyncFile_config")?.checked) files.push("config.json");
  if (document.getElementById("ghSyncFile_appjs")?.checked) files.push("static/app.js");
  if (document.getElementById("ghSyncFile_styles")?.checked) files.push("static/styles.css");
  if (document.getElementById("ghSyncFile_index")?.checked) files.push("index.html");

  if (files.length === 0) {
    alert("Seleccione al menos un archivo para subir a GitHub.");
    return;
  }

  if (!confirm(`¿Confirma que desea sincronizar y subir los siguientes ${files.length} archivo(s) directamente al repositorio GitHub:\n${repo} (rama ${branch})?\n\n- ${files.join('\n- ')}`)) {
    return;
  }

  const logBox = document.getElementById("cfgGhLogBox");
  const logConsole = document.getElementById("cfgGhLogConsole");
  const btnPush = document.getElementById("btnPushGithub");

  if (logBox) logBox.style.display = "block";
  if (logConsole) logConsole.innerText = `[${new Date().toLocaleTimeString()}] Guardando configuraciones locales en disco...\n`;
  if (btnPush) {
    btnPush.disabled = true;
    btnPush.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Subiendo a GitHub...`;
  }

  try {
    // Primero, guardar las configuraciones actuales en disco silenciosamente
    await saveConfigDataSilently();
    if (logConsole) logConsole.innerText += `[${new Date().toLocaleTimeString()}] Iniciando commit y push hacia GitHub API...\n`;

    const res = await fetch("/api/config/push_github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files,
        commit_message: commitMsg
      })
    });

    const data = await res.json();
    if (logConsole) {
      const items = data.details || data.results || [];
      if (Array.isArray(items)) {
        items.forEach(r => {
          const mark = r.success ? "✔" : "✖";
          const shaText = r.commit_sha ? ` (Commit: ${r.commit_sha.substring(0, 7)})` : "";
          const msg = r.message || (r.success ? "Actualizado exitosamente" : (r.error || "Error"));
          logConsole.innerText += `[${new Date().toLocaleTimeString()}] ${mark} ${r.file}: ${msg}${shaText}\n`;
        });
      }
      if (data.success) {
        logConsole.innerText += `[${new Date().toLocaleTimeString()}] Proceso de subida completado con éxito.\n`;
        showToast("¡Archivos sincronizados con GitHub exitosamente!");
      } else {
        logConsole.innerText += `[${new Date().toLocaleTimeString()}] Hubo errores en uno o más archivos: ${data.message || ''}\n`;
        showToast("Atención: Revisar log de subida a GitHub.");
      }
    }
  } catch (err) {
    if (logConsole) logConsole.innerText += `[${new Date().toLocaleTimeString()}] ERROR de comunicación: ${err.message}\n`;
    showToast("Error de conexión al subir a GitHub.");
  } finally {
    if (btnPush) {
      btnPush.disabled = false;
      btnPush.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Sincronizar Código / Reglas Ahora`;
    }
  }
}

// Subida quincenal independiente de archivos JSON de caché estático (static/api/*.json)
async function pushCacheFilesToGithub() {
  const repo = (document.getElementById("cfgGhRepo")?.value || "unionsaludvida2/cierredehistorias").trim();
  const branch = (document.getElementById("cfgGhBranch")?.value || "main").trim();
  const token = (document.getElementById("cfgGhToken")?.value || "").trim();

  if (!repo || !token) {
    alert("Por favor ingrese el Repositorio y el Token de Acceso (PAT) en los campos superiores antes de sincronizar.");
    return;
  }

  const files = [];
  if (document.getElementById("ghSyncCache_ultimo")?.checked) files.push("static/api/dashboard_ultimo_mes.json");
  if (document.getElementById("ghSyncCache_previas")?.checked) files.push("static/api/dashboard_fechas_previas.json");
  if (document.getElementById("ghSyncCache_ambos")?.checked) files.push("static/api/dashboard_ambos.json");
  if (document.getElementById("ghSyncCache_alias")?.checked) files.push("static/api/dashboard.json");

  if (files.length === 0) {
    alert("Por favor seleccione al menos un archivo JSON de caché para actualizar.");
    return;
  }

  const refreshLocal = document.getElementById("ghSyncCache_refreshLocal")?.checked !== false;

  const confirmMsg = `¿Confirma que desea sincronizar y reescribir los siguientes ${files.length} archivo(s) de caché de contingencia en GitHub?\n${repo} (rama ${branch}):\n\n- ${files.join('\n- ')}\n\n${refreshLocal ? '*(Los archivos serán previamente regenerados desde los datos locales para asegurar información fresca)*\n\n' : ''}Nota: La subida puede tomar entre 20 y 45 segundos debido al tamaño de los datos.`;

  if (!confirm(confirmMsg)) {
    return;
  }

  const logBox = document.getElementById("cfgGhLogBox");
  const logConsole = document.getElementById("cfgGhLogConsole");
  const btnPushCache = document.getElementById("btnPushCacheGithub");

  if (logBox) logBox.style.display = "block";
  if (logConsole) {
    logConsole.innerText = `[${new Date().toLocaleTimeString()}] Iniciando proceso de actualización quincenal de JSON de caché...\n`;
    if (refreshLocal) {
      logConsole.innerText += `[${new Date().toLocaleTimeString()}] Compilando y verificando frescura de datos en static/api/*.json...\n`;
    }
  }

  if (btnPushCache) {
    btnPushCache.disabled = true;
    btnPushCache.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Subiendo y Reescribiendo Caché en GitHub...`;
  }

  try {
    await saveConfigDataSilently();

    const commitMsg = `Actualización quincenal de datos de caché estático (${new Date().toLocaleDateString('es-CO')})`;

    const res = await fetch("/api/config/push_github_cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files,
        refresh_local: refreshLocal,
        commit_message: commitMsg
      })
    });

    const data = await res.json();
    if (logConsole) {
      const items = data.details || data.results || [];
      if (Array.isArray(items)) {
        items.forEach(r => {
          const mark = r.success ? "✔" : "✖";
          const shaText = r.commit_sha ? ` (Commit: ${r.commit_sha.substring(0, 7)})` : "";
          const sizeMb = r.size_bytes ? ` [${(r.size_bytes / (1024 * 1024)).toFixed(2)} MB]` : "";
          const msg = r.success ? "Sobrescrito con éxito" : (r.error || "Error al subir");
          logConsole.innerText += `[${new Date().toLocaleTimeString()}] ${mark} ${r.file}${sizeMb}: ${msg}${shaText}\n`;
        });
      }

      if (data.success) {
        logConsole.innerText += `[${new Date().toLocaleTimeString()}] ✔ ¡Todos los archivos de caché fueron actualizados en GitHub exitosamente!\n`;
        showToast("¡Archivos de caché actualizados en GitHub!");
      } else {
        logConsole.innerText += `[${new Date().toLocaleTimeString()}] ✖ Uno o más archivos de caché tuvieron advertencias.\n`;
        showToast("Atención: Revise el log de subida de caché.");
      }
    }
  } catch (err) {
    if (logConsole) logConsole.innerText += `[${new Date().toLocaleTimeString()}] ERROR de comunicación: ${err.message}\n`;
    showToast("Error de conexión al subir caché a GitHub.");
  } finally {
    if (btnPushCache) {
      btnPushCache.disabled = false;
      btnPushCache.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Actualizar y Reescribir JSON de Caché en GitHub (Quincenal)`;
    }
  }
}

// Guardado silencioso en backend para asegurar que los archivos en disco están al día antes de push
async function saveConfigDataSilently() {
  const dbPayload = collectDbConfigPayload();
  const publicPayload = collectPublicConfigPayload();
  await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      db_config: dbPayload,
      config: publicPayload
    })
  });
}

function collectDbConfigPayload() {
  return {
    database: {
      server: (document.getElementById("cfgDbHost")?.value || "172.200.6.135").trim(),
      port: (document.getElementById("cfgDbPort")?.value || "1433").trim(),
      username: (document.getElementById("cfgDbUser")?.value || "gesis").trim(),
      password: (document.getElementById("cfgDbPassword")?.value || "").trim(),
      driver: loadedSystemConfig?.db_config?.database?.driver || "ODBC Driver 17 for SQL Server",
      databases: {
        agendaweb: (document.getElementById("cfgDbAgenda")?.value || "BDAGENDAWEB").trim(),
        svces: (document.getElementById("cfgDbSvces")?.value || "BDSVCES").trim(),
        sap: (document.getElementById("cfgDbSap")?.value || "BDSAP").trim()
      }
    },
    github: {
      repo: (document.getElementById("cfgGhRepo")?.value || "unionsaludvida2/cierredehistorias").trim(),
      branch: (document.getElementById("cfgGhBranch")?.value || "main").trim(),
      token: (document.getElementById("cfgGhToken")?.value || "").trim()
    }
  };
}

function collectPublicConfigPayload() {
  const existing = (loadedSystemConfig && loadedSystemConfig.config) ? loadedSystemConfig.config : {};
  return {
    ...existing,
    text_cleaning_rules: currentCleaningRules,
    cis_mappings: currentCisMappings
  };
}

// Guardar configuración general con o sin reprocesamiento ETL
async function saveConfigData(reprocessAfter = false) {
  const btnSaveOnly = document.getElementById("btnSaveOnly");
  const btnSaveReprocess = document.getElementById("btnSaveReprocess");

  const origSaveOnlyText = btnSaveOnly ? btnSaveOnly.innerHTML : "";
  const origSaveRepText = btnSaveReprocess ? btnSaveReprocess.innerHTML : "";

  if (btnSaveOnly) btnSaveOnly.disabled = true;
  if (btnSaveReprocess) btnSaveReprocess.disabled = true;

  if (reprocessAfter && btnSaveReprocess) {
    btnSaveReprocess.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando y Reprocesando...`;
  } else if (btnSaveOnly) {
    btnSaveOnly.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando...`;
  }

  try {
    const dbPayload = collectDbConfigPayload();
    const publicPayload = collectPublicConfigPayload();

    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        db_config: dbPayload,
        config: publicPayload
      })
    });

    const data = await res.json();
    if (data.success) {
      loadedSystemConfig = data;

      if (reprocessAfter) {
        // Disparar ETL en segundo plano
        fetch("/api/config/apply_etl", { method: "POST" });
        showToast("Configuración guardada y reprocesamiento ETL iniciado.");
        closeConfigModal();
        // Recargar datos locales en el dashboard tras breve espera
        setTimeout(() => {
          cachedDashboardByPeriodo = {};
          fetchDashboardData(true);
        }, 2000);
      } else {
        showToast("Configuración guardada exitosamente.");
        closeConfigModal();
      }
    } else {
      alert("Error al guardar configuración: " + (data.error || "Fallo desconocido"));
    }
  } catch (err) {
    console.error("Error al guardar configuración:", err);
    alert("Error de conexión al intentar guardar la configuración.");
  } finally {
    if (btnSaveOnly) {
      btnSaveOnly.disabled = false;
      btnSaveOnly.innerHTML = origSaveOnlyText;
    }
    if (btnSaveReprocess) {
      btnSaveReprocess.disabled = false;
      btnSaveReprocess.innerHTML = origSaveRepText;
    }
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeJsString(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function triggerManualSync(force = false) {
  const btn = document.getElementById("btnManualSync");
  const btnForce = document.getElementById("btnForceSync");
  if (!btn && !btnForce) return;

  const originalContent = btn ? btn.innerHTML : "";
  const originalForceContent = btnForce ? btnForce.innerHTML : "";

  if (btn) btn.disabled = true;
  if (btnForce) btnForce.disabled = true;

  if (force) {
    if (btnForce) btnForce.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Extrayendo SQL...`;
    if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando SQL...`;
  } else {
    if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verificando BD...`;
  }

  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: !!force })
    });

    const data = await res.json();
    if (data.success) {
      if (data.updated) {
        alert(data.message + (data.total_pendientes !== undefined ? `\n\nTotal pendientes activas: ${data.total_pendientes.toLocaleString('es-CO')}` : ''));
        cachedDashboardByPeriodo = {};
        isUserSearching = false;
        const sDetalle = document.getElementById("searchDetalleCitas") || document.getElementById("searchDetalle");
        if (sDetalle) sDetalle.value = "";
        const bClear = document.getElementById("btnClearSearchDetalle");
        if (bClear) bClear.style.display = "none";
        await fetchDashboardData(true);
      } else {
        const wantForce = confirm(
          `${data.message}\n\n(Último registro en BD: ${data.max_fecha || 'N/A'})\n\n¿Desea FORZAR una extracción y sincronización completa desde el servidor SQL ahora?`
        );
        if (wantForce) {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
          }
          if (btnForce) {
            btnForce.disabled = false;
            btnForce.innerHTML = originalForceContent;
          }
          await triggerManualSync(true);
          return;
        }
      }
    } else {
      alert("Atención: " + (data.message || "No se pudo completar el chequeo en SQL Server."));
    }
  } catch (err) {
    console.error("Error en sincronización manual:", err);
    alert("Error de conexión al intentar verificar la base de datos.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalContent;
    }
    if (btnForce) {
      btnForce.disabled = false;
      btnForce.innerHTML = originalForceContent;
    }
  }
}

// =========================================================================
// TARJETAS KPI EJECUTIVAS Y FILTROS RÁPIDOS
// =========================================================================

function renderKpiCards(data) {
  if (!data) return;
  const kpis = data.kpis || { pendientes: 0, gestionadas: 0, pct_cobertura: 0 };
  const items = data.detalle_pendientes || [];

  // 1. Total Pendientes
  const totalValEl = document.getElementById("kpiValPendientes") || document.getElementById("kpiTotalPendientes");
  const totalSubEl = document.getElementById("kpiSubPendientes");
  if (totalValEl) totalValEl.innerText = (kpis.pendientes !== undefined ? kpis.pendientes : items.length).toLocaleString('es-CO');
  if (totalSubEl) totalSubEl.innerText = "Período seleccionado";

  // 2. Médicos con pendientes
  const medicosValEl = document.getElementById("kpiValMedicos");
  const medicosSubEl = document.getElementById("kpiSubMedicos");
  const medicosCount = new Set(items.map(it => it.profesional).filter(Boolean)).size;
  if (medicosValEl) medicosValEl.innerText = medicosCount.toLocaleString('es-CO');
  if (medicosSubEl) medicosSubEl.innerText = "Profesionales asistenciales";

  // 3. Sede con mayor rezago
  const topSedeEl = document.getElementById("kpiValTopSede") || document.getElementById("kpiTopSedeNombre");
  const topSedeSub = document.getElementById("kpiSubTopSede") || document.getElementById("kpiTopSedePendientes");
  const sedes = data.sedes_summary || [];
  if (sedes.length > 0) {
    const top = sedes[0];
    window._topSedeName = top["NOMBRE IPS"];
    if (topSedeEl) topSedeEl.innerText = top["NOMBRE IPS"] || "-";
    if (topSedeSub) topSedeSub.innerText = `${(top.pendientes || 0).toLocaleString('es-CO')} pendientes`;
  } else {
    window._topSedeName = null;
    if (topSedeEl) topSedeEl.innerText = "-";
    if (topSedeSub) topSedeSub.innerText = "0 pendientes";
  }

  // 4. % Avance de Auditoría
  const avanceValEl = document.getElementById("kpiValAvance") || document.getElementById("kpiAuditadas");
  const avanceProgEl = document.getElementById("kpiProgressBar");
  let totalGest = 0;
  if (typeof getFilteredFeedbackList === "function") {
    const fbl = getFilteredFeedbackList();
    totalGest = fbl ? fbl.length : 0;
  }
  if (!totalGest && kpis.gestionadas) {
    totalGest = kpis.gestionadas;
  }
  const univ = items.length + totalGest;
  const pctAvance = univ > 0 ? ((totalGest / univ) * 100).toFixed(1) : "0.0";
  if (avanceValEl) avanceValEl.innerText = `${pctAvance}%`;
  if (avanceProgEl) avanceProgEl.style.width = `${Math.min(100, Math.max(0, parseFloat(pctAvance)))}%`;

  // 5. Historias Auditadas / Gestionadas
  const auditValEl = document.getElementById("kpiValAuditadas") || document.getElementById("kpiValMoraCritica");
  const auditSubEl = document.getElementById("kpiSubAuditadas") || document.getElementById("kpiSubMoraCritica");
  if (auditValEl) auditValEl.innerText = Number(totalGest).toLocaleString('es-CO');
  if (auditSubEl) auditSubEl.innerText = `${pctAvance}% gestionadas`;
}

function filterByTopSede() {
  if (!window._topSedeName) return;
  currentFilters.sede = [window._topSedeName];
  updateMultiSelectTriggerLabel('sede');
  currentPage = 1;
  renderCurrentDataState();
}

function setQuickFilter(filterKey) {
  if (filterKey === "all") {
    currentQuickFilters.clear();
  } else {
    if (currentQuickFilters.has(filterKey)) {
      currentQuickFilters.delete(filterKey);
    } else {
      currentQuickFilters.add(filterKey);
    }
  }

  if (currentQuickFilters.size === 0) {
    currentQuickFilter = "all";
  } else if (currentQuickFilters.size === 1) {
    currentQuickFilter = Array.from(currentQuickFilters)[0];
  } else {
    currentQuickFilter = Array.from(currentQuickFilters).join(",");
  }

  document.querySelectorAll(".quick-pill").forEach(p => {
    const q = p.dataset.qfilter;
    if (q === "all") {
      p.classList.toggle("active", currentQuickFilters.size === 0);
    } else {
      p.classList.toggle("active", currentQuickFilters.has(q));
    }
  });

  currentPage = 1;
  renderCurrentDataState();
}

function onCustomDateRangeChange() {
  const df = document.getElementById("dateFrom");
  const dt = document.getElementById("dateTo");
  currentFilters.dateFrom = df ? df.value : "";
  currentFilters.dateTo = dt ? dt.value : "";
  userHasCustomDateFilter = true;

  // Desconflicto inteligente: si el rango manual de fechas seleccionado se amplía
  // más allá del día 15, limpiar filtros de Quincena y Día que pudieran recortar los datos
  if (currentFilters.dateTo) {
    const pTo = currentFilters.dateTo.split("-");
    if (pTo.length === 3) {
      const dToNum = parseInt(pTo[2], 10);
      if (dToNum > 15 && currentFilters.quincena && currentFilters.quincena.length > 0) {
        currentFilters.quincena = [];
        updateMultiSelectTriggerLabel('quincena');
        const qBox = document.getElementById("msBox_quincena");
        if (qBox) {
          const searchInput = document.getElementById("msSearch_quincena");
          renderMultiSelectOptions('quincena', searchInput ? searchInput.value : "");
        }
      }
      if (dToNum > 15 && currentFilters.dia && currentFilters.dia.length > 0) {
        const allLe15 = currentFilters.dia.every(d => Number(d) <= 15);
        if (allLe15) {
          currentFilters.dia = [];
          updateMultiSelectTriggerLabel('dia');
          const dBox = document.getElementById("msBox_dia");
          if (dBox) {
            const searchInput = document.getElementById("msSearch_dia");
            renderMultiSelectOptions('dia', searchInput ? searchInput.value : "");
          }
        }
      }
    }
  }

  // Si la fecha inicial seleccionada es anterior al último mes cargado, cambiar dinámicamente a "ambos" para disponer de todo el historial
  if (dynamicLatestMonthRange.dateFrom && currentFilters.dateFrom && currentFilters.dateFrom < dynamicLatestMonthRange.dateFrom && currentFilters.periodo !== "ambos") {
    currentFilters.periodo = "ambos";
    fetchDashboardData();
    return;
  }
  currentPage = 1;
  renderCurrentDataState();
}

// =========================================================================
// FILTROS FAVORITOS (LOCALSTORAGE)
// =========================================================================

const FAVORITE_FILTER_KEY = "agendaweb_favorite_filters";

function checkFavoriteFilterButton() {
  const btnApply = document.getElementById("btnApplyFavoriteFilter");
  if (!btnApply) return;
  try {
    const saved = localStorage.getItem(FAVORITE_FILTER_KEY);
    btnApply.style.display = saved ? "inline-flex" : "none";
  } catch (e) {
    btnApply.style.display = "none";
  }
}

function saveFavoriteFilter() {
  try {
    const toSave = {
      periodo: currentFilters.periodo,
      ano: [...(currentFilters.ano || [])],
      mes: [...(currentFilters.mes || [])],
      dia: [...(currentFilters.dia || [])],
      quincena: [...(currentFilters.quincena || [])],
      sede: [...(currentFilters.sede || [])],
      programa: [...(currentFilters.programa || [])],
      profesional: [...(currentFilters.profesional || [])],
      estado_phc: [...(currentFilters.estado_phc || [])],
      dateFrom: currentFilters.dateFrom || "",
      dateTo: currentFilters.dateTo || "",
      quickFilter: currentQuickFilter,
      quickFilters: Array.from(currentQuickFilters)
    };
    localStorage.setItem(FAVORITE_FILTER_KEY, JSON.stringify(toSave));
    checkFavoriteFilterButton();
    showToast("⭐ Filtros actuales guardados como favoritos");
  } catch (e) {
    alert("No fue posible guardar los filtros favoritos.");
  }
}

function applyFavoriteFilter() {
  try {
    const savedStr = localStorage.getItem(FAVORITE_FILTER_KEY);
    if (!savedStr) {
      alert("No hay filtros favoritos guardados.");
      return;
    }
    const saved = JSON.parse(savedStr);
    currentFilters.periodo = saved.periodo || "ultimo_mes";
    ['ano', 'mes', 'dia', 'quincena', 'sede', 'programa', 'profesional', 'estado_phc'].forEach(k => {
      currentFilters[k] = Array.isArray(saved[k]) ? [...saved[k]] : [];
    });
    currentFilters.dateFrom = saved.dateFrom || "";
    currentFilters.dateTo = saved.dateTo || "";
    const df = document.getElementById("dateFrom");
    const dt = document.getElementById("dateTo");
    if (df) df.value = currentFilters.dateFrom;
    if (dt) dt.value = currentFilters.dateTo;

    if (saved.quickFilters && Array.isArray(saved.quickFilters)) {
      currentQuickFilters = new Set(saved.quickFilters);
    } else if (saved.quickFilter && saved.quickFilter !== "all") {
      currentQuickFilters = new Set(saved.quickFilter.split(",").filter(Boolean));
    } else {
      currentQuickFilters.clear();
    }
    currentQuickFilter = currentQuickFilters.size === 0 ? "all" : (currentQuickFilters.size === 1 ? Array.from(currentQuickFilters)[0] : Array.from(currentQuickFilters).join(","));
    document.querySelectorAll(".quick-pill").forEach(p => {
      const q = p.dataset.qfilter;
      if (q === "all") {
        p.classList.toggle("active", currentQuickFilters.size === 0);
      } else {
        p.classList.toggle("active", currentQuickFilters.has(q));
      }
    });

    ['ano', 'mes', 'dia', 'quincena', 'sede', 'programa', 'profesional', 'estado_phc'].forEach(k => {
      updateMultiSelectTriggerLabel(k);
    });

    currentPage = 1;
    renderCurrentDataState();
    showToast("⭐ Filtros favoritos aplicados exitosamente");
  } catch (e) {
    console.error("Error al aplicar filtros favoritos:", e);
    alert("Error al cargar los filtros favoritos.");
  }
}

// =========================================================================
// SELECCIÓN GLOBAL MULTI-PÁGINA
// =========================================================================

function selectAllFilteredCitasGlobal() {
  isGlobalSelectionActive = true;
  filteredDetalleData.forEach(item => {
    selectedCitasSet.add(String(item.id_cita));
  });
  renderTblDetallePage();
  showToast(`✅ ${filteredDetalleData.length.toLocaleString('es-CO')} citas seleccionadas globalmente`);
}

function clearGlobalSelection() {
  isGlobalSelectionActive = false;
  selectedCitasSet.clear();
  renderTblDetallePage();
}

// =========================================================================
// PERSONALIZADOR DE COLUMNAS VISIBLES (COLUMN PICKER)
// =========================================================================

function toggleColumnPicker(e) {
  if (e) e.stopPropagation();
  const popover = document.getElementById("columnPickerPopover");
  if (!popover) return;
  const wasOpen = popover.classList.contains("open");
  popover.classList.toggle("open", !wasOpen);
}

function toggleColumnVisibility(colName, isVisible) {
  columnVisibility[colName] = !!isVisible;
  try {
    localStorage.setItem("agendaweb_column_prefs", JSON.stringify(columnVisibility));
  } catch (e) { }
  applyColumnVisibility();
}

function applyColumnVisibility() {
  Object.keys(columnVisibility).forEach(col => {
    const chk = document.getElementById(`chkCol_${col}`);
    if (chk) chk.checked = columnVisibility[col];
  });

  const table = document.getElementById("tblDetalle");
  if (!table) return;

  const colClasses = {
    hora: ".col-hora",
    sede: ".col-sede",
    doc: ".col-doc",
    programa: ".col-programa",
    estado_phc: ".col-estado-phc"
  };

  Object.entries(colClasses).forEach(([col, selector]) => {
    const show = columnVisibility[col] !== false;
    table.querySelectorAll(selector).forEach(el => {
      el.style.display = show ? "" : "none";
    });
  });
}

// =========================================================================
// ALTERNANCIA Y VISTAS DE GRÁFICOS (MORA Y AVANCE APILADO)
// =========================================================================

function switchChartProgramasMode(mode) {
  chartProgramasMode = "programas";
  renderCurrentDataState();
}

function renderChartMoraDistribution(items) {
  const canvas = document.getElementById("chartProgramas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartProgramasInst) chartProgramasInst.destroy();

  const brackets = {
    "<= 7 días (Reciente)": 0,
    "8 - 15 días (Moderada)": 0,
    "16 - 30 días (Alta)": 0,
    "> 30 días (Mora Crítica)": 0
  };

  items.forEach(it => {
    const m = calculateMoraDias(it.fecha);
    if (m.dias <= 7) brackets["<= 7 días (Reciente)"]++;
    else if (m.dias <= 15) brackets["8 - 15 días (Moderada)"]++;
    else if (m.dias <= 30) brackets["16 - 30 días (Alta)"]++;
    else brackets["> 30 días (Mora Crítica)"]++;
  });

  const labels = Object.keys(brackets);
  const dataVals = Object.values(brackets);
  const bgColors = ["#10b981", "#f59e0b", "#f97316", "#ef4444"];

  chartProgramasInst = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: "Citas Pendientes",
        data: dataVals,
        backgroundColor: bgColors,
        borderRadius: 6,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: currentTheme === 'dark' ? '#cbd5e1' : '#334155',
          font: { weight: 'bold', size: 11 },
          formatter: (v) => v > 0 ? v.toLocaleString('es-CO') : ''
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` Citas: ${ctx.parsed.y.toLocaleString('es-CO')}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: currentTheme === 'dark' ? '#94a3b8' : '#64748b', font: { size: 10.5 } },
          grid: { display: false }
        },
        y: {
          ticks: { color: currentTheme === 'dark' ? '#94a3b8' : '#64748b' },
          grid: { color: currentTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }
        }
      }
    },
    plugins: getChartPlugins()
  });
}

function switchChartSedesMode(mode) {
  chartSedesMode = (mode === "avance") ? "avance" : "total";
  const btnT = document.getElementById("btnChartSedesTotal");
  const btnA = document.getElementById("btnChartSedesStacked");
  const btnV = document.getElementById("btnChartSedesVsTotal");
  if (btnT) btnT.classList.toggle("active", chartSedesMode === "total");
  if (btnA) btnA.classList.toggle("active", chartSedesMode === "avance");
  if (btnV) btnV.classList.remove("active");
  renderCurrentDataState();
}

function renderChartSedesStacked(sedesData) {
  const canvas = document.getElementById("chartSedesPct");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartSedesPctInst) chartSedesPctInst.destroy();

  const list = [...(sedesData || [])].filter(s => (s.pendientes || 0) > 0);
  list.sort((a, b) => (b.pendientes || 0) - (a.pendientes || 0));

  const wrapper = document.getElementById("wrapperChartSedesPct");
  if (wrapper) {
    const calcHeight = Math.max(340, list.length * 28);
    wrapper.style.height = `${calcHeight}px`;
    canvas.style.height = `${calcHeight}px`;
  }

  const labels = list.map(s => s["NOMBRE IPS"] || s.sede || "Desconocida");
  const gestionadas = list.map(s => s.gestionadas || 0);
  const sinAuditar = list.map(s => s.sin_auditar !== undefined ? s.sin_auditar : Math.max(0, s.pendientes - (s.gestionadas || 0)));

  chartSedesPctInst = new Chart(ctx, {
    type: "bar",
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: [
        {
          label: "Auditadas",
          data: gestionadas,
          backgroundColor: "#10b981",
          borderRadius: 4
        },
        {
          label: "Sin Auditar",
          data: sinAuditar,
          backgroundColor: "#f59e0b",
          borderRadius: 4
        }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { left: 14, right: 40, top: 4, bottom: 4 }
      },
      onClick: (e, activeElements) => {
        if (activeElements.length > 0) {
          const index = activeElements[0].index;
          const clickedSede = labels[index];
          toggleFilter("sede", clickedSede);
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: currentTheme === 'dark' ? '#94a3b8' : '#64748b', font: { size: 9.5 } },
          grid: { color: currentTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }
        },
        y: {
          stacked: true,
          afterFit: function (axis) {
            if (axis.width < 145) axis.width = 145;
          },
          ticks: { color: currentTheme === 'dark' ? '#cbd5e1' : '#1e293b', font: { size: 9.5, weight: '600' }, padding: 6 },
          grid: { display: false }
        }
      },
      plugins: {
        legend: {
          position: "top",
          labels: { color: currentTheme === 'dark' ? '#cbd5e1' : '#334155', boxWidth: 12 }
        },
        datalabels: {
          display: true,
          anchor: 'center',
          align: 'center',
          color: '#ffffff',
          font: { weight: 'bold', size: 9.5 },
          formatter: (v) => (v > 0 ? v.toLocaleString('es-CO') : '')
        }
      }
    }
  });
}

function switchChartMesesMode(mode) {
  chartMesesMode = (mode === "avance") ? "avance" : "total";
  const btnT = document.getElementById("btnChartMesesTotal");
  const btnA = document.getElementById("btnChartMesesStacked");
  const btnV = document.getElementById("btnChartMesesVsTotal");
  if (btnT) btnT.classList.toggle("active", chartMesesMode === "total");
  if (btnA) btnA.classList.toggle("active", chartMesesMode === "avance");
  if (btnV) btnV.classList.remove("active");
  renderCurrentDataState();
}

function renderChartMesesStacked(mesesData) {
  const canvas = document.getElementById("chartMeses");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartMesesInst) chartMesesInst.destroy();

  if (!mesesData || mesesData.length === 0) return;

  const labels = mesesData.map(m => m["Nombre del mes"]);
  const gestionadas = mesesData.map(m => m.gestionadas || 0);
  const sinAuditar = mesesData.map(m => m.sin_auditar !== undefined ? m.sin_auditar : Math.max(0, (m.pendientes || 0) - (m.gestionadas || 0)));

  chartMesesInst = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Auditadas",
          data: gestionadas,
          backgroundColor: "#10b981",
          borderRadius: 4,
          stack: "stack1",
          barPercentage: 0.45,
          categoryPercentage: 0.6
        },
        {
          label: "Sin Auditar",
          data: sinAuditar,
          backgroundColor: "#f59e0b",
          borderRadius: 4,
          stack: "stack1",
          barPercentage: 0.45,
          categoryPercentage: 0.6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 10, right: 25, bottom: 10, left: 10 }
      },
      onClick: (e, activeElements) => {
        if (activeElements.length > 0) {
          const index = activeElements[0].index;
          const clickedMes = labels[index];
          toggleFilter("mes", clickedMes);
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            color: currentTheme === 'dark' ? '#94a3b8' : '#1e293b',
            font: { size: 10.5, weight: '600' }
          },
          grid: { display: false }
        },
        y: {
          stacked: true,
          ticks: {
            color: currentTheme === 'dark' ? '#94a3b8' : '#64748b'
          },
          grid: {
            color: currentTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
          }
        }
      },
      plugins: {
        legend: {
          position: "top",
          labels: {
            color: currentTheme === 'dark' ? '#cbd5e1' : '#334155',
            boxWidth: 12
          }
        },
        datalabels: {
          display: false
        }
      }
    }
  });
}

// =========================================================================
// MODOS DE REPORTE Y GRÁFICOS INDEPENDIENTES DE AVANCE DE AUDITORÍAS (SEDES Y MESES)
// =========================================================================
var avanceSedesMode = 'pct'; // 'pct' (porcentaje 100%) | 'count' (conteo historias)
var avanceMesesMode = 'pct'; // 'pct' (porcentaje 100%) | 'count' (conteo historias)

var lastAvanceSedesData = null;
var lastAvanceMesesData = null;

function setAvanceSedesMode(mode) {
  avanceSedesMode = (mode === 'count') ? 'count' : 'pct';
  const btnP = document.getElementById("btnAvanceSedesPct");
  const btnC = document.getElementById("btnAvanceSedesCount");
  if (btnP) btnP.classList.toggle("active", avanceSedesMode === 'pct');
  if (btnC) btnC.classList.toggle("active", avanceSedesMode === 'count');
  renderChartAvanceAuditoriasSedes(lastAvanceSedesData);
}

function setAvanceMesesMode(mode) {
  avanceMesesMode = (mode === 'count') ? 'count' : 'pct';
  const btnP = document.getElementById("btnAvanceMesesPct");
  const btnC = document.getElementById("btnAvanceMesesCount");
  if (btnP) btnP.classList.toggle("active", avanceMesesMode === 'pct');
  if (btnC) btnC.classList.toggle("active", avanceMesesMode === 'count');
  renderChartAvanceAuditoriasMeses(lastAvanceMesesData);
}

window.setAvanceSedesMode = setAvanceSedesMode;
window.setAvanceMesesMode = setAvanceMesesMode;

var chartAvanceAuditoriasSedesInst = null;
function renderChartAvanceAuditoriasSedes(sedesData) {
  if (sedesData) lastAvanceSedesData = sedesData;
  else sedesData = lastAvanceSedesData;

  const canvas = document.getElementById("chartAvanceAuditoriasSedes");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartAvanceAuditoriasSedesInst) chartAvanceAuditoriasSedesInst.destroy();

  const list = [...(sedesData || [])].filter(s => ((s.pendientes || s.total || 0) > 0 || (s.gestionadas || 0) > 0));

  // Ordenar el gráfico por porcentaje de historias auditadas, de mayor a menor
  const getSedePctAuditadas = (item) => {
    if (typeof item.pct_gestion === 'number') return item.pct_gestion;
    const a = item.gestionadas || 0;
    const sin = item.sin_auditar !== undefined ? item.sin_auditar : Math.max(0, (item.pendientes || item.total || 0) - a);
    const tot = sin + a;
    return tot > 0 ? (a / tot) * 100 : 0;
  };

  list.sort((a, b) => {
    const pctA = getSedePctAuditadas(a);
    const pctB = getSedePctAuditadas(b);
    if (Math.abs(pctB - pctA) > 0.0001) {
      return pctB - pctA; // De mayor a menor porcentaje de historias auditadas
    }
    const audDiff = (b.gestionadas || 0) - (a.gestionadas || 0);
    if (audDiff !== 0) return audDiff;
    const totA = (a.pendientes || a.total || 0) + (a.gestionadas || 0);
    const totB = (b.pendientes || b.total || 0) + (b.gestionadas || 0);
    if (totB !== totA) return totB - totA;
    const nameA = a["NOMBRE IPS"] || a.sede || "";
    const nameB = b["NOMBRE IPS"] || b.sede || "";
    return nameA.localeCompare(nameB);
  });

  const wrapper = document.getElementById("wrapperChartAvanceAuditoriasSedes");
  if (wrapper) {
    const calcHeight = Math.max(340, list.length * 28);
    wrapper.style.height = `${calcHeight}px`;
    canvas.style.height = `${calcHeight}px`;
  }

  if (list.length === 0) {
    chartAvanceAuditoriasSedesInst = new Chart(ctx, {
      type: "bar",
      data: {
        labels: ["Sin historias pendientes registradas en sedes"],
        datasets: [{ label: "Sin Auditar", data: [0], backgroundColor: "#f59e0b" }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    return;
  }

  const labels = list.map(s => s["NOMBRE IPS"] || s.sede || "Desconocida");
  const gestionadas = list.map(s => s.gestionadas || 0);
  const sinAuditar = list.map(s => s.sin_auditar !== undefined ? s.sin_auditar : Math.max(0, (s.pendientes || s.total || 0) - (s.gestionadas || 0)));

  const isPctMode = (avanceSedesMode === 'pct');

  let datasetSinAuditarData = [];
  let datasetAuditadasData = [];

  for (let i = 0; i < list.length; i++) {
    const s = sinAuditar[i] || 0;
    const a = gestionadas[i] || 0;
    const tot = s + a;
    if (isPctMode) {
      const pSin = tot > 0 ? (s / tot) * 100 : 0;
      const pAud = tot > 0 ? (a / tot) * 100 : 0;
      datasetSinAuditarData.push(pSin);
      datasetAuditadasData.push(pAud);
    } else {
      datasetSinAuditarData.push(s);
      datasetAuditadasData.push(a);
    }
  }

  chartAvanceAuditoriasSedesInst = new Chart(ctx, {
    type: "bar",
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: [
        {
          label: "Auditadas",
          data: datasetAuditadasData,
          backgroundColor: "#10b981",
          borderRadius: 4
        },
        {
          label: "Sin Auditar",
          data: datasetSinAuditarData,
          backgroundColor: "#f59e0b",
          borderRadius: 4
        }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { left: 14, right: 35, top: 4, bottom: 4 }
      },
      onClick: (e, activeElements) => {
        if (activeElements.length > 0) {
          const index = activeElements[0].index;
          const clickedSede = labels[index];
          toggleFilter("sede", clickedSede);
        }
      },
      scales: {
        x: {
          stacked: true,
          max: isPctMode ? 100 : undefined,
          ticks: {
            color: currentTheme === 'dark' ? '#94a3b8' : '#64748b',
            font: { size: 9.5 },
            callback: function(val) {
              return isPctMode ? `${val}%` : val.toLocaleString('es-CO');
            }
          },
          grid: { color: currentTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }
        },
        y: {
          stacked: true,
          afterFit: function (axis) {
            if (axis.width < 145) axis.width = 145;
          },
          ticks: { color: currentTheme === 'dark' ? '#cbd5e1' : '#1e293b', font: { size: 9.5, weight: '600' }, padding: 6 },
          grid: { display: false }
        }
      },
      plugins: {
        legend: {
          display: false // Inmovilizado en la cabecera sticky superior
        },
        tooltip: {
          callbacks: {
            label: function(item) {
              const idx = item.dataIndex;
              const s = sinAuditar[idx] || 0;
              const a = gestionadas[idx] || 0;
              const tot = s + a;
              const isAud = (item.dataset.label === "Auditadas");
              const countVal = isAud ? a : s;
              const pctVal = tot > 0 ? ((countVal / tot) * 100).toFixed(1) : "0.0";
              return ` ${item.dataset.label}: ${countVal.toLocaleString('es-CO')} (${pctVal}%)`;
            },
            afterBody: function(tooltipItems) {
              const idx = tooltipItems[0].dataIndex;
              const g = gestionadas[idx] || 0;
              const s = sinAuditar[idx] || 0;
              const tot = g + s;
              const pct = tot > 0 ? ((g / tot) * 100).toFixed(1) : "0.0";
              return [
                ` Total presentado sede: ${tot.toLocaleString('es-CO')}`,
                ` % Avance en sede: ${pct}%`
              ];
            }
          }
        },
        datalabels: {
          display: true,
          anchor: 'center',
          align: 'center',
          color: '#ffffff',
          font: { weight: 'bold', size: 9.5 },
          formatter: (v, ctx) => {
            const idx = ctx.dataIndex;
            const s = sinAuditar[idx] || 0;
            const a = gestionadas[idx] || 0;
            const tot = s + a;
            if (tot === 0) return '';
            const isAud = (ctx.dataset.label === "Auditadas");
            const countVal = isAud ? a : s;
            const pctOfBar = (countVal / tot) * 100;
            if (pctOfBar < 11) return '';
            return isPctMode ? `${Math.round(pctOfBar)}%` : countVal.toLocaleString('es-CO');
          }
        }
      }
    }
  });
}

var chartAvanceAuditoriasMesesInst = null;
function renderChartAvanceAuditoriasMeses(mesesData) {
  if (mesesData) lastAvanceMesesData = mesesData;
  else mesesData = lastAvanceMesesData;

  const canvas = document.getElementById("chartAvanceAuditoriasMeses");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartAvanceAuditoriasMesesInst) chartAvanceAuditoriasMesesInst.destroy();

  if (!mesesData || mesesData.length === 0) return;

  const labels = mesesData.map(m => m["Nombre del mes"]);
  const gestionadas = mesesData.map(m => m.gestionadas || 0);
  const sinAuditar = mesesData.map(m => m.sin_auditar !== undefined ? m.sin_auditar : Math.max(0, (m.pendientes || m.total || 0) - (m.gestionadas || 0)));

  const isPctMode = (avanceMesesMode === 'pct');

  let datasetSinAuditarData = [];
  let datasetAuditadasData = [];

  for (let i = 0; i < mesesData.length; i++) {
    const s = sinAuditar[i] || 0;
    const a = gestionadas[i] || 0;
    const tot = s + a;
    if (isPctMode) {
      const pSin = tot > 0 ? (s / tot) * 100 : 0;
      const pAud = tot > 0 ? (a / tot) * 100 : 0;
      datasetSinAuditarData.push(pSin);
      datasetAuditadasData.push(pAud);
    } else {
      datasetSinAuditarData.push(s);
      datasetAuditadasData.push(a);
    }
  }

  chartAvanceAuditoriasMesesInst = new Chart(ctx, {
    type: "bar",
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: [
        {
          label: "Auditadas",
          data: datasetAuditadasData,
          backgroundColor: "#10b981",
          borderRadius: 4,
          stack: "stack1",
          barPercentage: 0.45,
          categoryPercentage: 0.6
        },
        {
          label: "Sin Auditar",
          data: datasetSinAuditarData,
          backgroundColor: "#f59e0b",
          borderRadius: 4,
          stack: "stack1",
          barPercentage: 0.45,
          categoryPercentage: 0.6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 10, right: 25, bottom: 14, left: 10 }
      },
      onClick: (e, activeElements) => {
        if (activeElements.length > 0) {
          const index = activeElements[0].index;
          const clickedMes = labels[index];
          toggleFilter("mes", clickedMes);
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            color: currentTheme === 'dark' ? '#94a3b8' : '#1e293b',
            font: { size: 10.5, weight: '600' }
          },
          grid: { display: false }
        },
        y: {
          stacked: true,
          max: isPctMode ? 100 : undefined,
          ticks: {
            color: currentTheme === 'dark' ? '#94a3b8' : '#64748b',
            callback: function(val) {
              return isPctMode ? `${val}%` : val.toLocaleString('es-CO');
            }
          },
          grid: {
            color: currentTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
          }
        }
      },
      plugins: {
        legend: {
          display: false // Inmovilizado en la cabecera sticky superior
        },
        tooltip: {
          callbacks: {
            label: function(item) {
              const idx = item.dataIndex;
              const s = sinAuditar[idx] || 0;
              const a = gestionadas[idx] || 0;
              const tot = s + a;
              const isAud = (item.dataset.label === "Auditadas");
              const countVal = isAud ? a : s;
              const pctVal = tot > 0 ? ((countVal / tot) * 100).toFixed(1) : "0.0";
              return ` ${item.dataset.label}: ${countVal.toLocaleString('es-CO')} (${pctVal}%)`;
            },
            afterBody: function(tooltipItems) {
              const idx = tooltipItems[0].dataIndex;
              const g = gestionadas[idx] || 0;
              const s = sinAuditar[idx] || 0;
              const tot = g + s;
              const pct = tot > 0 ? ((g / tot) * 100).toFixed(1) : "0.0";
              return [
                ` Total cohort presentado: ${tot.toLocaleString('es-CO')}`,
                ` % Avance de auditoría: ${pct}%`
              ];
            }
          }
        },
        datalabels: {
          display: true,
          anchor: 'center',
          align: 'center',
          color: '#ffffff',
          font: { weight: 'bold', size: 10 },
          formatter: (v, ctx) => {
            const idx = ctx.dataIndex;
            const s = sinAuditar[idx] || 0;
            const a = gestionadas[idx] || 0;
            const tot = s + a;
            if (tot === 0) return '';
            const isAud = (ctx.dataset.label === "Auditadas");
            const countVal = isAud ? a : s;
            const pctOfBar = (countVal / tot) * 100;
            if (pctOfBar < 11) return '';
            return isPctMode ? `${Math.round(pctOfBar)}%` : countVal.toLocaleString('es-CO');
          }
        }
      }
    }
  });
}

// =========================================================================
// SNIPPETS DE OBSERVACIÓN RÁPIDA
// =========================================================================

function appendObservationSnippet(snippetText) {
  const obsInput = document.getElementById("modalObservacion");
  if (!obsInput) return;
  const cur = obsInput.value.trim();
  if (!cur) {
    obsInput.value = snippetText;
  } else if (!cur.includes(snippetText)) {
    obsInput.value = `${cur}. ${snippetText}`;
  }
  obsInput.focus();
}

// =========================================================================
// REPORTE DE PRODUCTIVIDAD DE AUDITORES
// =========================================================================

let currentProductivityData = [];

// =========================================================================
// PARSEO Y FORMATEO ESTANDARIZADO DE FECHAS (dd/mm/aaaa hh:mm a.m./p.m.)
// =========================================================================

function parseDateFlexible(s) {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
  if (typeof s !== 'string') return null;
  s = s.trim();

  // 1. Formato JS Date.toString() e.g. "Wed Sep 16 2026 12:38:55 GMT-0500..."
  const MONTHS_MAP = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };
  const mJs = s.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (mJs) {
    const mon = MONTHS_MAP[mJs[1].toLowerCase()] ?? 0;
    return new Date(parseInt(mJs[3], 10), mon, parseInt(mJs[2], 10), parseInt(mJs[4], 10), parseInt(mJs[5], 10), parseInt(mJs[6], 10));
  }

  // 2. Formato en español/local e.g. "19/10/2026, 3:46:54 p. m." o "2/9/2026 14:10:18"
  const mEs = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?)?/i);
  if (mEs) {
    let day = parseInt(mEs[1], 10);
    let mon = parseInt(mEs[2], 10) - 1;
    let yr = parseInt(mEs[3], 10);
    let hr = mEs[4] ? parseInt(mEs[4], 10) : 0;
    let min = mEs[5] ? parseInt(mEs[5], 10) : 0;
    let sec = mEs[6] ? parseInt(mEs[6], 10) : 0;
    const ampm = mEs[7];
    if (ampm) {
      const cleanAmpm = ampm.toLowerCase().replace(/[\s\.]/g, '');
      if (cleanAmpm === 'pm' && hr < 12) hr += 12;
      else if (cleanAmpm === 'am' && hr === 12) hr = 0;
    }
    return new Date(yr, mon, day, hr, min, sec);
  }

  // 3. Fallback ISO o estándar
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatLocalDateTime(val) {
  if (!val) return "N/A";
  const d = parseDateFlexible(val);
  if (!d || isNaN(d.getTime())) return String(val);

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  let hours = d.getHours();
  const ampm = hours >= 12 ? 'p.m.' : 'a.m.';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hoursStr = String(hours).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  return `${day}/${month}/${year} ${hoursStr}:${minutes} ${ampm}`;
}

async function openProductivityModal() {
  const modal = document.getElementById("productivityModal");
  if (modal) modal.classList.add("open");

  let records = [];
  let summary = null;

  try {
    const res = await fetch("/api/productivity");
    if (res.ok) {
      const data = await res.json();
      if (data) {
        if (Array.isArray(data.auditors)) {
          records = data.auditors;
        }
        if (data.summary) {
          summary = data.summary;
        }
      }
    }
  } catch (e) { }

  if (records.length === 0) {
    const audMap = {};
    const todayStr = new Date().toLocaleDateString('es-CO');
    let localTodayCount = 0;
    Object.values(localFeedbackStore).forEach(fb => {
      const aName = fb.auditor ? toNomPropio(fb.auditor) : "Sin Auditor Registrado";
      if (aName.toLowerCase().includes("prueba") || aName === "Test Runner" || String(fb.id_cita || '').startsWith('test_')) return;
      if (!audMap[aName]) {
        audMap[aName] = { auditor: aName, total: 0, finalizadas: 0, en_progreso: 0, novedades: 0, ultima_actividad: "", _last_dt: null, estado_predominante: "Finalizada" };
      }
      audMap[aName].total++;
      if (fb.fecha_gestion && fb.fecha_gestion.includes(todayStr)) {
        localTodayCount++;
      }
      const st = (fb.estado_phc || fb.estado || "").toLowerCase();
      if (st.includes("finalizada") || st.includes("cerrada") || st.includes("atendido")) {
        audMap[aName].finalizadas++;
      } else if (st.includes("progreso")) {
        audMap[aName].en_progreso++;
      } else {
        audMap[aName].novedades++;
      }
      if (fb.fecha_gestion) {
        const dt = parseDateFlexible(fb.fecha_gestion);
        if (dt && (!audMap[aName]._last_dt || dt > audMap[aName]._last_dt)) {
          audMap[aName]._last_dt = dt;
          audMap[aName].ultima_actividad = formatLocalDateTime(dt);
        }
      }
    });
    records = Object.values(audMap).sort((a, b) => b.total - a.total);
    records.forEach(r => {
      r.estado_predominante = r.finalizadas >= r.en_progreso ? "Finalizada" : "En progreso";
    });
    summary = {
      total_gestiones: records.reduce((acc, r) => acc + (r.total || 0), 0),
      auditores_activos: records.filter(r => r.auditor !== "Sin Auditor Registrado").length,
      gestiones_hoy: localTodayCount
    };
  }

  currentProductivityData = records;

  // Actualizar Tarjetas KPI de Productividad
  const totalAuditsEl = document.getElementById("prodTotalAudits");
  const activeAuditorsEl = document.getElementById("prodActiveAuditors");
  const todayAuditsEl = document.getElementById("prodTodayAudits");

  const totalGestiones = summary ? summary.total_gestiones : records.reduce((acc, r) => acc + (r.total || 0), 0);
  const totalAuditores = summary ? summary.auditores_activos : records.filter(r => r.auditor !== "Sin Auditor Registrado").length;
  const gestionesHoy = summary ? summary.gestiones_hoy : 0;

  if (totalAuditsEl) totalAuditsEl.innerText = totalGestiones.toLocaleString('es-CO');
  if (activeAuditorsEl) activeAuditorsEl.innerText = totalAuditores.toLocaleString('es-CO');
  if (todayAuditsEl) todayAuditsEl.innerText = gestionesHoy.toLocaleString('es-CO');

  // Actualizar Tabla con 4 columnas estandarizadas (sin Cédula)
  const tbody = document.querySelector("#tblProductivity tbody");
  if (tbody) {
    tbody.innerHTML = "";
    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="center">No hay registros de auditorías disponibles aún</td></tr>';
      return;
    }
    records.forEach(r => {
      const tr = document.createElement("tr");
      const stPred = r.estado_predominante || (r.finalizadas >= r.en_progreso ? "Finalizada" : "En progreso");
      let stBadgeClass = "badge-subtle-tag";
      if (stPred.toLowerCase().includes("finalizada")) stBadgeClass += " badge-status-resolved";
      else if (stPred.toLowerCase().includes("progreso")) stBadgeClass += " badge-status-in-progress";
      else stBadgeClass += " badge-reassigned";

      tr.innerHTML = `
        <td><strong>${escapeHtml(r.auditor)}</strong></td>
        <td class="num"><strong>${(r.total || 0).toLocaleString('es-CO')}</strong></td>
        <td class="center" style="font-size: 11.5px; color: #64748b;">${escapeHtml(formatLocalDateTime(r.ultima_actividad))}</td>
        <td><span class="${stBadgeClass}">${escapeHtml(stPred)}</span></td>
      `;
      tbody.appendChild(tr);
    });
  }
}

function closeProductivityModal() {
  const modal = document.getElementById("productivityModal");
  if (modal) modal.classList.remove("open");
}

function exportProductivityExcel() {
  if (!currentProductivityData || currentProductivityData.length === 0) {
    alert("No hay datos de productividad para exportar.");
    return;
  }
  const headers = ["Auditor", "Total Gestiones", "Historias Finalizadas", "En Progreso", "Inasistencias y Novedades", "Estado Predominante", "Última Actividad"];
  const rows = currentProductivityData.map(r => ({
    "Auditor": r.auditor,
    "Total Gestiones": r.total || 0,
    "Historias Finalizadas": r.finalizadas || 0,
    "En Progreso": r.en_progreso || 0,
    "Inasistencias y Novedades": r.novedades || 0,
    "Estado Predominante": r.estado_predominante || "",
    "Última Actividad": formatLocalDateTime(r.ultima_actividad)
  }));

  if (typeof XLSX !== "undefined") {
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productividad Auditores");
    XLSX.writeFile(wb, `Productividad_Auditores_AGENDAWEB_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
}

// =========================================================================
// MÓDULO DASHBOARD DE GESTIÓN Y ANÁLISIS GRÁFICO
// =========================================================================

// =========================================================================
// MÓDULO DASHBOARD EJECUTIVO DE GESTIÓN Y ANÁLISIS DE DATOS (PÁGINA INTEGRADA)
// =========================================================================

var currentMainView = "seguimiento";
var currentSedesMesesTab = "sedes";
var chartAuditoresGestionesInst = null;
var chartEstadosAuditoriaInst = null;
var chartInconsistenciasProgInst = null;
var chartDemoraMedicosInst = null;
var chartDemoraSedesInst = null;
var chartDemoraMesesInst = null;

var demoraMedicosMode = "volumen"; // "volumen" o "pct"
var demoraSedesMode = "volumen"; // "volumen" o "pct"
var demoraMesesMode = "comparativa"; // "comparativa" o "pct"

function switchMainView(viewName) {
  currentMainView = viewName;
  const viewSeg = document.getElementById("viewSeguimientoTablas");
  const viewDash = document.getElementById("viewDashboardAnalytics");
  const btnSeg = document.getElementById("btnViewSeguimiento");
  const btnDash = document.getElementById("btnViewDashboard") || document.getElementById("btnOpenDashboard");

  if (viewName === "dashboard") {
    if (viewSeg) {
      viewSeg.style.display = "none";
      viewSeg.classList.remove("active-view");
    }
    if (viewDash) {
      viewDash.style.display = "flex";
      viewDash.classList.add("active-view");
    }
    if (btnSeg) btnSeg.classList.remove("active");
    if (btnDash) btnDash.classList.add("active");

    const data = applyClientFiltersToData(rawDashboardData, currentFilters);
    updateDashboardAnalyticsView(data);

    const savedTab = localStorage.getItem('agendaweb_dash_tab') || 'general';
    switchDashboardTab(savedTab);

    setTimeout(() => {
      resizeActiveDashboardCharts();
    }, 100);
  } else {
    if (viewDash) {
      viewDash.style.display = "none";
      viewDash.classList.remove("active-view");
    }
    if (viewSeg) {
      viewSeg.style.display = "flex";
      viewSeg.classList.add("active-view");
    }
    if (btnDash) btnDash.classList.remove("active");
    if (btnSeg) btnSeg.classList.add("active");
  }
}

function openDashboardModal() {
  switchMainView("dashboard");
}

function closeDashboardModal() {
  switchMainView("seguimiento");
}

function switchSedesMesesTab(tab) {
  currentSedesMesesTab = tab;
  const wrapSedes = document.getElementById("wrapperChartSedes");
  const wrapMeses = document.getElementById("wrapperChartMeses");
  const btnSedes = document.getElementById("btnTabSedesChart");
  const btnMeses = document.getElementById("btnTabMesesChart");
  const title = document.getElementById("chartSedesTitle");

  if (tab === "meses") {
    if (wrapSedes) wrapSedes.style.display = "none";
    if (wrapMeses) wrapMeses.style.display = "block";
    if (btnSedes) btnSedes.classList.remove("active");
    if (btnMeses) btnMeses.classList.add("active");
    if (title) title.innerHTML = '<i class="fa-solid fa-calendar-days"></i> PENDIENTES ATENCIÓN POR MES';
    if (chartMesesInst) {
      chartMesesInst.resize();
      chartMesesInst.update();
    }
  } else {
    if (wrapMeses) wrapMeses.style.display = "none";
    if (wrapSedes) wrapSedes.style.display = "block";
    if (btnMeses) btnMeses.classList.remove("active");
    if (btnSedes) btnSedes.classList.add("active");
    if (title) title.innerHTML = '<i class="fa-solid fa-hospital"></i> SEDES CON MAYOR NÚMERO DE PENDIENTES';
    if (chartSedesPctInst) {
      chartSedesPctInst.resize();
      chartSedesPctInst.update();
    }
  }
}

function getFilteredFeedbackList() {
  const allFb = Object.values(localFeedbackStore || {});
  if (!allFb.length) return [];

  // Helper de búsqueda rápida de datos de cita en rawDashboardData
  const apptLookup = {};
  if (rawDashboardData && Array.isArray(rawDashboardData.detalle_pendientes)) {
    rawDashboardData.detalle_pendientes.forEach(item => {
      if (item && item.id_cita) apptLookup[String(item.id_cita)] = item;
    });
  }

  // Pre-procesar conjuntos de filtros activos
  const sedeFilterList = (Array.isArray(currentFilters.sede) ? currentFilters.sede : (currentFilters.sede ? [currentFilters.sede] : []))
    .map(s => removeAccents(normalizeSedeName(s)))
    .filter(s => s && s !== "todas" && s !== "todos");

  const progFilterList = (Array.isArray(currentFilters.programa) ? currentFilters.programa : (currentFilters.programa ? [currentFilters.programa] : []))
    .map(p => removeAccents(p))
    .filter(p => p && p !== "todas" && p !== "todos");

  const profFilterList = (Array.isArray(currentFilters.profesional) ? currentFilters.profesional : (currentFilters.profesional ? [currentFilters.profesional] : []))
    .map(p => removeAccents(String(p).trim()))
    .filter(p => p && p !== "todas" && p !== "todos");

  const estadoPhcFilterList = (Array.isArray(currentFilters.estado_phc) ? currentFilters.estado_phc : (currentFilters.estado_phc ? [currentFilters.estado_phc] : []))
    .map(e => removeAccents(String(e).trim()))
    .filter(e => e && e !== "todas" && e !== "todos");

  const anoFilterList = (Array.isArray(currentFilters.ano) ? currentFilters.ano : (currentFilters.ano ? [currentFilters.ano] : []))
    .map(a => String(a).trim())
    .filter(a => a && a.toLowerCase() !== "todos");

  const mesFilterList = (Array.isArray(currentFilters.mes) ? currentFilters.mes : (currentFilters.mes ? [currentFilters.mes] : []))
    .map(m => removeAccents(String(m).trim().toLowerCase()))
    .filter(m => m && m !== "todas" && m !== "todos");

  const diaFilterList = (Array.isArray(currentFilters.dia) ? currentFilters.dia : (currentFilters.dia ? [currentFilters.dia] : []))
    .map(d => parseInt(d, 10))
    .filter(d => !isNaN(d));

  const quinFilterList = (Array.isArray(currentFilters.quincena) ? currentFilters.quincena : (currentFilters.quincena ? [currentFilters.quincena] : []))
    .map(q => removeAccents(String(q).trim().toLowerCase()))
    .filter(q => q && q !== "todas" && q !== "todos");

  // Filtros rápidos
  const activeQFilters = (typeof currentQuickFilters !== 'undefined' && currentQuickFilters.size > 0)
    ? currentQuickFilters
    : (currentQuickFilter && currentQuickFilter !== 'all' ? new Set(currentQuickFilter.split(',').filter(Boolean)) : new Set());

  return allFb.filter(fb => {
    if (!fb || !fb.id_cita) return false;
    const cid = String(fb.id_cita);
    const aud = String(fb.auditor || "").trim();
    if (cid.startsWith("test_") || cid.startsWith("TEST_") || aud === "Test Runner" || aud.toLowerCase().includes("prueba")) {
      return false;
    }

    const appt = apptLookup[cid] || null;

    // Resolver campos completos de la cita
    const progRaw = fb.programa || (appt ? appt.programa : "");
    const progSanitized = typeof sanitizeProgramaName === "function" ? sanitizeProgramaName(progRaw) : progRaw;
    const progNorm = removeAccents(progSanitized);
    const isEsp = isProgramaEspecialistas(progSanitized);

    const sedeRaw = isEsp ? "Especialistas" : (fb.sede || (appt ? appt.sede : ""));
    const sedeNorm = removeAccents(normalizeSedeName(sedeRaw));

    const profRaw = fb.nombre_profesional || (appt ? appt.profesional : "");
    const profNorm = removeAccents(profRaw);
    const docRaw = String(fb.id_profesional || (appt ? (appt.cedula_profesional || appt.id_profesional) : "")).trim();

    const phcRaw = fb.estado_phc || (appt ? appt.estado_phc : "") || fb.estado || "Confirmada";
    const phcNorm = removeAccents(phcRaw);

    // 1. Filtro Sede
    if (sedeFilterList.length > 0) {
      const matchSede = sedeFilterList.some(s => {
        if (s === "especialistas") return isEsp || sedeNorm === "especialistas";
        return s === sedeNorm;
      });
      if (!matchSede) return false;
    }

    // 2. Filtro Programa
    if (progFilterList.length > 0) {
      const matchProg = progFilterList.some(p => p === progNorm || progNorm.includes(p) || p.includes(progNorm));
      if (!matchProg) return false;
    }

    // 3. Filtro Profesional (Nombre o Cédula)
    if (profFilterList.length > 0) {
      const matchProf = profFilterList.some(p => p === profNorm || profNorm.includes(p) || (docRaw && docRaw === p));
      if (!matchProf) return false;
    }

    // 4. Filtro Estado PHC
    if (estadoPhcFilterList.length > 0) {
      const matchEst = estadoPhcFilterList.some(e => phcNorm.includes(e));
      if (!matchEst) return false;
    }

    // 5. Filtros de Fecha (Rango, Año, Mes, Día, Quincena)
    // Las auditorías y gestiones se miden por la fecha en que se realizaron (fecha_gestion),
    // no por la fecha de la cita médica original.
    const fgRaw = (fb.fecha_gestion || fb.fecha_cita || (appt ? (appt.fecha || appt.fecha_cita) : "") || "").slice(0, 10);
    const isoDate = parseIsoDate ? parseIsoDate(fgRaw) : fgRaw;

    if (currentFilters.dateFrom && isoDate && isoDate < currentFilters.dateFrom) return false;
    if (currentFilters.dateTo && isoDate && isoDate > currentFilters.dateTo) return false;

    if (anoFilterList.length > 0 || mesFilterList.length > 0 || diaFilterList.length > 0 || quinFilterList.length > 0) {
      const dp = parseDateParts(fgRaw);
      if (dp) {
        if (anoFilterList.length > 0 && !anoFilterList.includes(String(dp.ano))) return false;
        if (mesFilterList.length > 0) {
          const mNorm = removeAccents(String(dp.mesName || "").toLowerCase());
          if (!mesFilterList.includes(mNorm)) return false;
        }
        if (diaFilterList.length > 0 && !diaFilterList.includes(dp.dia)) return false;
        if (quinFilterList.length > 0) {
          const is1Q = dp.dia <= 15;
          const match1Q = quinFilterList.some(q => q.includes("1ra") || q.includes("primera")) && is1Q;
          const match2Q = quinFilterList.some(q => q.includes("2da") || q.includes("segunda")) && !is1Q;
          if (!match1Q && !match2Q) return false;
        }
      } else {
        return false;
      }
    }

    // 6. Quick Filters
    if (activeQFilters.size > 0) {
      if (activeQFilters.has("sin_auditar") && !activeQFilters.has("auditadas")) return false; // ya está auditada
      if (activeQFilters.has("en_progreso")) {
        const estProg = ((fb.estado || "") + " " + phcRaw).toLowerCase();
        if (!estProg.includes("progreso")) return false;
      }
      if (activeQFilters.has("especialistas") && !activeQFilters.has("medicos_generales") && !isEsp) return false;
      if (activeQFilters.has("medicos_generales") && !activeQFilters.has("especialistas") && isEsp) return false;
    }

    return true;
  });
}

function updateDashboardAnalyticsView(data) {
  if (!data) return;
  const detalle = data.detalle_pendientes || [];

  // Obtener universo completo de auditorías aplicando los filtros actuales
  const filteredFb = getFilteredFeedbackList();
  const totalAuditadas = filteredFb.length;

  // 1. Tarjetas Ejecutivas PowerBI
  const elTot = document.getElementById("dashExecKpiTotal");
  const elAvance = document.getElementById("dashExecKpiAvance");
  const elBadgeAvance = document.getElementById("dashExecKpiBadgeAvance");
  const elProgress = document.getElementById("dashExecProgressBar");
  const elAuditadas = document.getElementById("dashExecKpiAuditadas");
  const elAuditoresCount = document.getElementById("dashExecKpiAuditoresCount");
  const elCerradas = document.getElementById("dashExecKpiCerradas");
  const elBadgeCerradas = document.getElementById("dashExecKpiBadgeCerradas");
  const elSubCerradas = document.getElementById("dashExecKpiSubCerradas");
  const elSedes = document.getElementById("dashExecKpiSedes");
  const elIncons = document.getElementById("dashExecKpiInconsistencias");
  const elMora = document.getElementById("dashExecKpiMora");
  const elInd = document.getElementById("dashFilterIndicator");

  // TOTAL CITAS PENDIENTES
  const totalPendientes = detalle.length;
  if (elTot) elTot.textContent = Number(totalPendientes).toLocaleString("es-CO");

  // % AVANCE DE AUDITORÍA
  const totalGestionadas = totalAuditadas;
  const universoTotal = totalPendientes + totalGestionadas;
  const pctAvance = universoTotal > 0 ? ((totalGestionadas / universoTotal) * 100).toFixed(1) : "0.0";

  if (elAvance) elAvance.textContent = `${pctAvance}%`;
  if (elBadgeAvance) elBadgeAvance.textContent = `${totalGestionadas.toLocaleString("es-CO")} auditadas`;
  if (elProgress) elProgress.style.width = `${Math.min(100, Math.max(0, parseFloat(pctAvance)))}%`;

  // AUDITORÍAS REALIZADAS
  if (elAuditadas) elAuditadas.textContent = Number(totalGestionadas).toLocaleString("es-CO");
  const auditoresSet = new Set(filteredFb.map(f => f.auditor ? toNomPropio(f.auditor) : "").filter(Boolean));
  if (elAuditoresCount) {
    elAuditoresCount.textContent = `${auditoresSet.size} auditor(es) activo(s)`;
  }

  // NUEVA TARJETA: CASOS AUDITADOS YA CERRADOS EN PHC AL MOMENTO DE AUDITORÍA
  const cerradasAlAuditarList = filteredFb.filter(fb => {
    const est = removeAccents(fb.estado || "");
    const nota = removeAccents(fb.nota_aclaratoria || "");
    const stPhc = removeAccents(fb.estado_phc || "");
    return est.includes("ya cerrada") || nota.includes("ya cerrada") || (stPhc === "finalizada" && est.includes("cerrada"));
  });
  const countCerradas = cerradasAlAuditarList.length;
  const pctCerradas = totalGestionadas > 0 ? ((countCerradas / totalGestionadas) * 100).toFixed(1) : "0.0";

  if (elCerradas) elCerradas.textContent = Number(countCerradas).toLocaleString("es-CO");
  if (elBadgeCerradas) elBadgeCerradas.textContent = `${pctCerradas}%`;
  if (elSubCerradas) elSubCerradas.textContent = `Reportadas pendientes pero ya cerradas`;

  // SEDES IMPACTADAS CON CASOS PENDIENTES
  if (elSedes) {
    const sedesSet = new Set(detalle.map(c => c.sede || c["NOMBRE IPS"]).filter(Boolean));
    elSedes.textContent = Number(sedesSet.size).toLocaleString("es-CO");
  }

  // ERRORES EN DATOS (Novedad / error en auditorías excluyendo divergencias CUP)
  const inconsList = getInconsistenciasByPrograma(detalle, filteredFb);
  const totalInconsistencias = inconsList.reduce((acc, p) => acc + p.errores, 0);
  if (elIncons) elIncons.textContent = Number(totalInconsistencias).toLocaleString("es-CO");
  const elInconsSub = elIncons && elIncons.closest('.exec-kpi-data') ? elIncons.closest('.exec-kpi-data').querySelector('.exec-kpi-sub') : null;
  const pctIncons = totalGestionadas > 0 ? ((totalInconsistencias / totalGestionadas) * 100).toFixed(1) : "0.0";
  if (elInconsSub) elInconsSub.textContent = `${pctIncons}% de auditorías`;

  // KPI: HISTORIAS AUDITADAS (Gestiones registradas)
  const elAuditExec = document.getElementById("dashExecKpiAuditadas") || elMora;
  if (elAuditExec) elAuditExec.textContent = Number(totalGestionadas).toLocaleString("es-CO");
  const elAuditSub = elAuditExec && elAuditExec.closest('.exec-kpi-data') ? elAuditExec.closest('.exec-kpi-data').querySelector('.exec-kpi-sub') : null;
  const pctAuditGlobal = (totalPendientes + totalGestionadas) > 0 ? ((totalGestionadas / (totalPendientes + totalGestionadas)) * 100).toFixed(1) : "0.0";
  if (elAuditSub) elAuditSub.textContent = `${pctAuditGlobal}% de cobertura`;

  // Indicador de filtros activos
  if (elInd) {
    const activeFilters = [];
    if (currentFilters.sede && currentFilters.sede.length > 0) activeFilters.push(`Sede: ${currentFilters.sede.slice(0, 2).join(", ")}${currentFilters.sede.length > 2 ? ` (+${currentFilters.sede.length - 2})` : ''}`);
    if (currentFilters.programa && currentFilters.programa.length > 0) activeFilters.push(`Programa: ${currentFilters.programa.slice(0, 2).join(", ")}${currentFilters.programa.length > 2 ? ` (+${currentFilters.programa.length - 2})` : ''}`);
    if (currentFilters.profesional && currentFilters.profesional.length > 0) activeFilters.push(`Médico: ${currentFilters.profesional.slice(0, 1).join(", ")}${currentFilters.profesional.length > 1 ? ` (+${currentFilters.profesional.length - 1})` : ''}`);
    if (currentFilters.fechas && (currentFilters.fechas.desde || currentFilters.fechas.hasta)) activeFilters.push(`Fechas: ${currentFilters.fechas.desde || ''} a ${currentFilters.fechas.hasta || ''}`);
    if (currentFilters.estado_phc && currentFilters.estado_phc.length > 0) activeFilters.push(`Estado: ${currentFilters.estado_phc.join(", ")}`);

    if (activeFilters.length > 0) {
      elInd.innerHTML = `<i class="fa-solid fa-filter"></i> Filtros activos: <strong>${escapeHtml(activeFilters.join(" | "))}</strong> (${detalle.length.toLocaleString("es-CO")} citas pendientes | ${totalGestionadas.toLocaleString("es-CO")} auditorías)`;
    } else {
      elInd.innerHTML = `<i class="fa-solid fa-layer-group"></i> Mostrando datos del período seleccionado (${detalle.length.toLocaleString("es-CO")} citas pendientes | ${totalGestionadas.toLocaleString("es-CO")} auditorías)`;
    }
  }

  // Renderizar gráficos especializados de auditorías e inconsistencias
  renderChartAuditoresGestiones(filteredFb);
  renderChartEstadosAuditoria(filteredFb, detalle);
  renderChartInconsistenciasProgramas(detalle, filteredFb);
  renderTblInconsistenciasProgramas(detalle, filteredFb);

  // Renderizar gráficos especializados de demoras en cierre (médicos, sedes, meses)
  renderChartDemoraMedicos(data.demora_medicos, demoraMedicosMode);
  renderChartDemoraSedes(data.demora_sedes, demoraSedesMode);
  renderChartDemoraMeses(data.demora_meses, demoraMesesMode);

  // Actualizar badges informativos de cierre de historias
  const elBadgeMed = document.getElementById("badgeDemoraMedicos");
  if (elBadgeMed && data.demora_medicos) {
    const totalMedsConDemora = data.demora_medicos.filter(m => m.pendientes > 0).length;
    elBadgeMed.textContent = `${totalMedsConDemora.toLocaleString("es-CO")} Médicos`;
  }
  const elBadgeSed = document.getElementById("badgeDemoraSedes");
  if (elBadgeSed && data.demora_sedes) {
    const totalSedesConDemora = data.demora_sedes.filter(s => s.pendientes > 0).length;
    elBadgeSed.textContent = `${totalSedesConDemora.toLocaleString("es-CO")} Sedes con Pendientes`;
  }
  const elBadgeMes = document.getElementById("badgeDemoraMeses");
  if (elBadgeMes && data.demora_totales) {
    elBadgeMes.textContent = `100% Cierre vs Pendientes`;
  }

  // Actualizar badges de la tarjeta matriz de indicadores operativos
  const elResMora = document.getElementById("badgeResumenMoraCritica");
  if (elResMora) elResMora.textContent = `${Number(moraCriticaCount).toLocaleString("es-CO")} casos (${pctMora}%)`;
  const elResCerr = document.getElementById("badgeResumenCerradasPHC");
  if (elResCerr) elResCerr.textContent = `${Number(countCerradas).toLocaleString("es-CO")} cerradas (${pctCerradas}%)`;
  const elBadgeMedCount = document.getElementById("badgeDemoraMedicosCount");
  if (elBadgeMedCount) {
    elBadgeMedCount.style.display = "none";
  }
}

function updateDashboardModalKPIs() {
  const data = applyClientFiltersToData(rawDashboardData, currentFilters);
  updateDashboardAnalyticsView(data);
}

// =========================================================================
// GESTIÓN DE PESTAÑAS DEL DASHBOARD (TABBED ANALYTICS)
// =========================================================================
var currentDashboardTab = 'general';

function switchDashboardTab(tabName) {
  if (!tabName) tabName = 'general';
  currentDashboardTab = tabName;

  document.querySelectorAll('.dash-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.dashTab === tabName);
  });

  // En 'Resumen General' se muestran TODOS los gráficos en sus filas para análisis globales;
  // en pestañas específicas se filtra la vista por categoría.
  const sections = document.querySelectorAll('.dash-analytics-section');
  sections.forEach(sec => {
    const secTags = (sec.dataset.dashSection || '').split(/\s+/);
    if (tabName === 'general') {
      sec.style.display = '';
      sec.style.gridTemplateColumns = '';
      sec.querySelectorAll('.dashboard-card').forEach(card => card.style.display = '');
    } else {
      const matchesSection = secTags.includes(tabName);
      if (!matchesSection) {
        sec.style.display = 'none';
      } else {
        sec.style.display = '';
        let visibleCount = 0;
        sec.querySelectorAll('.dashboard-card').forEach(card => {
          const cardTags = (card.dataset.dashCategory || sec.dataset.dashSection || '').split(/\s+/);
          const isVis = cardTags.includes(tabName);
          card.style.display = isVis ? '' : 'none';
          if (isVis) visibleCount++;
        });
        if (visibleCount === 1) {
          sec.style.gridTemplateColumns = '1fr';
        } else if (visibleCount === 2) {
          sec.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        } else if (visibleCount === 3) {
          sec.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
        } else {
          sec.style.gridTemplateColumns = '';
        }
      }
    }
  });

  // Compatibilidad con panes tradicionales
  document.querySelectorAll('.dash-tab-pane').forEach(pane => {
    pane.classList.toggle('active', tabName === 'general' || pane.dataset.dashPane === tabName);
  });

  try {
    localStorage.setItem('agendaweb_dash_tab', tabName);
  } catch (e) { }

  setTimeout(() => {
    resizeActiveDashboardCharts();
  }, 40);
}

function resizeActiveDashboardCharts() {
  const chartInstances = [
    chartAuditoresGestionesInst,
    chartEstadosAuditoriaInst,
    chartInconsistenciasProgInst,
    chartDemoraMedicosInst,
    chartDemoraSedesInst,
    chartDemoraMesesInst,
    chartProgramasInst,
    chartSedesPctInst,
    chartMesesInst,
    chartAvanceAuditoriasSedesInst,
    chartAvanceAuditoriasMesesInst
  ];
  chartInstances.forEach(inst => {
    if (inst && typeof inst.resize === 'function') {
      try { inst.resize(); } catch (e) { }
    }
  });
}

var lastDemoraMedicosData = null;
var lastDemoraMedicosMode = 'volumen';
var searchMedicoDashQuery = '';

function filterDemoraMedicosChart(query) {
  searchMedicoDashQuery = (query || '').trim().toLowerCase();
  if (lastDemoraMedicosData) {
    let filtered = lastDemoraMedicosData;
    if (searchMedicoDashQuery) {
      filtered = lastDemoraMedicosData.filter(m => {
        const name = (m["NOMBRE PROFESIONAL"] || "").toLowerCase();
        const doc = String(m.identificacion || m.id_medico || m.cedula || m["IDENTIFICACION"] || "").toLowerCase();
        return name.includes(searchMedicoDashQuery) || doc.includes(searchMedicoDashQuery);
      });
    }
    const countBadge = document.getElementById("badgeDemoraMedicos") || document.getElementById("badgeDemoraMedicosCount");
    if (countBadge) {
      countBadge.textContent = searchMedicoDashQuery ? `${filtered.length} encontrados` : `${lastDemoraMedicosData.filter(m => m.pendientes > 0).length.toLocaleString("es-CO")} Médicos`;
    }
    renderChartDemoraMedicos(filtered, lastDemoraMedicosMode, true);
  }
}

function filterInconsistenciasTable(query) {
  const q = (query || '').trim().toLowerCase();
  const rows = document.querySelectorAll("#tbodyInconsistenciasProgramas tr");
  rows.forEach(tr => {
    const text = tr.textContent.toLowerCase();
    tr.style.display = (!q || text.includes(q)) ? "" : "none";
  });
}

// 1. GRÁFICO DE AUDITORÍAS REALIZADAS POR AUDITOR
function renderChartAuditoresGestiones(filteredFb) {
  const canvas = document.getElementById("chartAuditoresGestiones");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartAuditoresGestionesInst) chartAuditoresGestionesInst.destroy();

  const auditorCounts = {};
  (filteredFb || []).forEach(rec => {
    if (rec && rec.auditor && rec.auditor.trim()) {
      const aName = toNomPropio(rec.auditor.trim());
      auditorCounts[aName] = (auditorCounts[aName] || 0) + 1;
    }
  });

  const sortedAuditores = Object.entries(auditorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const badge = document.getElementById("badgeTotalAuditorias");
  const totalGest = Object.values(auditorCounts).reduce((a, b) => a + b, 0);
  if (badge) badge.textContent = `${totalGest.toLocaleString("es-CO")} Gestiones`;

  if (sortedAuditores.length === 0) {
    chartAuditoresGestionesInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Sin auditorías registradas'],
        datasets: [{ data: [0], backgroundColor: '#94a3b8' }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      }
    });
    return;
  }

  const labels = sortedAuditores.map(a => a[0]);
  const dataVals = sortedAuditores.map(a => a[1]);

  chartAuditoresGestionesInst = new Chart(ctx, {
    type: 'bar',
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: [{
        label: 'Auditorías Realizadas',
        data: dataVals,
        backgroundColor: '#0284c7',
        borderColor: '#0369a1',
        borderWidth: 1,
        borderRadius: 4,
        barThickness: 18
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 55, top: 4, bottom: 12, left: 10 } },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end',
          align: 'end',
          clip: false,
          color: currentTheme === 'dark' ? '#f1f5f9' : '#0f172a',
          font: { weight: 'bold', size: 10.5 },
          formatter: (v) => (typeof v === 'number' ? v.toLocaleString('es-CO') : v)
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { display: false } },
        y: {
          grid: { display: false },
          ticks: {
            autoSkip: false,
            color: currentTheme === 'dark' ? '#cbd5e1' : '#1e293b',
            font: { size: 10, weight: '600' }
          }
        }
      }
    }
  });
}

// 2. GRÁFICO DE ANÁLISIS DE RESULTADOS DE AUDITORÍA (DONUT)
function renderChartEstadosAuditoria(filteredFb, detalle) {
  const canvas = document.getElementById("chartEstadosAuditoria");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartEstadosAuditoriaInst) chartEstadosAuditoriaInst.destroy();

  const counts = {
    "Historia ya cerrada en PHC": 0,
    "Paciente con inasistencia": 0,
    "Historia en progreso": 0,
    "Divergencia CUP / Profesional": 0,
    "Restricción registro PHC": 0,
    "Confirmada sin evidencia": 0,
    "Novedad Médica": 0,
    "Error de Dato / Informe": 0,
    "Paciente reagendado": 0,
    "Otros hallazgos": 0
  };

  (filteredFb || []).forEach(fb => {
    const est = (fb.estado || fb.nota_aclaratoria || "").toLowerCase();
    const stPhc = (fb.estado_phc || "").toLowerCase();

    if (est.includes("ya cerrada") || est.includes("cerrada en phc") || est.includes("cerrada en sistema")) {
      counts["Historia ya cerrada en PHC"]++;
    } else if (est.includes("inasistencia") || stPhc.includes("inasistencia")) {
      counts["Paciente con inasistencia"]++;
    } else if (est.includes("progreso") || stPhc.includes("progreso")) {
      counts["Historia en progreso"]++;
    } else if (est.includes("otro codigo") || est.includes("otro profesional") || est.includes("divergencia")) {
      counts["Divergencia CUP / Profesional"]++;
    } else if (est.includes("no se permite registrar")) {
      counts["Restricción registro PHC"]++;
    } else if (est.includes("sin evidencia")) {
      counts["Confirmada sin evidencia"]++;
    } else if (est.includes("novedad") || stPhc.includes("novedad")) {
      counts["Novedad Médica"]++;
    } else if (est.includes("error") || stPhc.includes("error")) {
      counts["Error de Dato / Informe"]++;
    } else if (est.includes("reagendad") || est.includes("reprogramad")) {
      counts["Paciente reagendado"]++;
    } else {
      counts["Otros hallazgos"]++;
    }
  });

  const activeCategories = Object.entries(counts)
    .filter(x => x[1] > 0)
    .sort((a, b) => b[1] - a[1]);

  const labels = activeCategories.map(x => x[0]);
  const dataVals = activeCategories.map(x => x[1]);

  const colorPaletteMap = {
    "Historia ya cerrada en PHC": "#0d9488",
    "Paciente con inasistencia": "#64748b",
    "Historia en progreso": "#f59e0b",
    "Divergencia CUP / Profesional": "#8b5cf6",
    "Restricción registro PHC": "#ea580c",
    "Confirmada sin evidencia": "#94a3b8",
    "Novedad Médica": "#0284c7",
    "Error de Dato / Informe": "#e11d48",
    "Paciente reagendado": "#06b6d4",
    "Otros hallazgos": "#a855f7"
  };
  const bgColors = labels.map(l => colorPaletteMap[l] || "#0078d4");

  const totalAudits = (filteredFb || []).length;
  const badge = document.getElementById("badgeEstadosAuditoria");
  if (badge) badge.textContent = `${totalAudits.toLocaleString("es-CO")} Casos Auditados`;

  if (activeCategories.length === 0) {
    chartEstadosAuditoriaInst = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Sin auditorías'],
        datasets: [{ data: [1], backgroundColor: ['#cbd5e1'] }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    return;
  }

  chartEstadosAuditoriaInst = new Chart(ctx, {
    type: 'doughnut',
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: [{
        data: dataVals,
        backgroundColor: bgColors,
        borderWidth: 2,
        borderColor: currentTheme === 'dark' ? '#1e293b' : '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      layout: { padding: { left: 4, right: 6, top: 4, bottom: 10 } },
      plugins: {
        legend: {
          position: 'right',
          labels: {
            boxWidth: 10,
            font: { size: 9, weight: '500' },
            color: currentTheme === 'dark' ? '#cbd5e1' : '#334155',
            padding: 4
          }
        },
        datalabels: {
          display: true,
          color: '#ffffff',
          font: { weight: 'bold', size: 10 },
          formatter: (v) => {
            const pct = totalAudits > 0 ? ((v / totalAudits) * 100).toFixed(0) : 0;
            return pct >= 4 ? `${pct}%` : '';
          }
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              const val = context.raw || 0;
              const pct = totalAudits > 0 ? ((val / totalAudits) * 100).toFixed(1) : 0;
              return ` ${context.label}: ${val.toLocaleString('es-CO')} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// 3. ANÁLISIS DE ERRORES EN DATOS POR PROGRAMA VS TOTALIDAD DE AUDITORÍAS
function getInconsistenciasByPrograma(detalle, filteredFb) {
  const mapProg = {};

  // Lookup rápido de citas para resolver programa si falta
  const apptProgLookup = {};
  if (rawDashboardData && Array.isArray(rawDashboardData.detalle_pendientes)) {
    rawDashboardData.detalle_pendientes.forEach(item => {
      if (item && item.id_cita && item.programa) {
        apptProgLookup[String(item.id_cita)] = item.programa;
      }
    });
  }

  // Iterar sobre las auditorías filtradas para comparar Errores de Dato vs Totalidad de Auditorías
  (filteredFb || []).forEach(r => {
    if (!r) return;
    const cid = String(r.id_cita || "");

    let progRaw = r.programa || (localFeedbackStore[cid] && localFeedbackStore[cid].programa) || apptProgLookup[cid];
    let prog = progRaw ? String(progRaw).trim() : "Consulta Medicina General";
    if (typeof sanitizeProgramaName === "function") {
      prog = sanitizeProgramaName(prog);
    }
    if (!prog) prog = "Sin Programa";

    if (!mapProg[prog]) {
      mapProg[prog] = {
        programa: prog,
        errores: 0,
        totalAuditorias: 0,
        pctError: 0,
        cupDiff: 0,
        novedadError: 0,
        total: 0
      };
    }

    mapProg[prog].totalAuditorias++;

    const est = ((r.estado || "") + " " + (r.nota_aclaratoria || "")).toLowerCase();
    const stPhc = (r.estado_phc || "").toLowerCase();

    // Solo tener en cuenta los errores de datos / novedades (excluyendo divergencias de CUP)
    const isError = est.includes("novedad") || est.includes("error") || stPhc.includes("novedad") || stPhc.includes("error");
    if (isError) {
      mapProg[prog].errores++;
      mapProg[prog].novedadError++;
      mapProg[prog].total++;
    }

    const isCupDiff = est.includes("otro codigo") || est.includes("otro profesional") || est.includes("divergencia");
    if (isCupDiff) {
      mapProg[prog].cupDiff++;
    }
  });

  // Calcular porcentaje de error: errores / totalidad de auditorías del programa
  const list = Object.values(mapProg).map(p => {
    p.pctError = p.totalAuditorias > 0 ? ((p.errores / p.totalAuditorias) * 100) : 0;
    return p;
  });

  // Ordenar por porcentaje de error de mayor a menor (y en empate por volumen de errores)
  return list.filter(p => p.errores > 0).sort((a, b) => b.pctError - a.pctError || b.errores - a.errores);
}

function renderChartInconsistenciasProgramas(detalle, filteredFb) {
  const canvas = document.getElementById("chartInconsistenciasProgramas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartInconsistenciasProgInst) chartInconsistenciasProgInst.destroy();

  const allProgs = getInconsistenciasByPrograma(detalle, filteredFb);
  const totalIncons = allProgs.reduce((acc, p) => acc + p.errores, 0);
  const totalAudits = (filteredFb || []).length;
  const pctGlobal = totalAudits > 0 ? ((totalIncons / totalAudits) * 100).toFixed(1) : "0.0";

  // Mostrar todos los programas con errores registrados
  const progs = allProgs;
  const badge = document.getElementById("badgeInconsistenciasProg");
  if (badge) {
    badge.textContent = `${totalIncons.toLocaleString("es-CO")} Errores (${pctGlobal}% de ${totalAudits.toLocaleString("es-CO")} Aud.)`;
  }

  // Dimensionar dinámicamente el contenedor con scroll vertical para evitar que Chart.js omita etiquetas
  const wrapper = document.getElementById("wrapperChartInconsistencias");
  if (wrapper) {
    const dynamicHeight = Math.max(320, progs.length * 42 + 50);
    wrapper.style.height = `${dynamicHeight}px`;
  }

  if (progs.length === 0) {
    chartInconsistenciasProgInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Sin errores de datos registrados'],
        datasets: [{ data: [0], backgroundColor: '#10b981' }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      }
    });
    return;
  }

  const labels = progs.map(p => formatChartProgramLabel(p.programa));
  const rawLabels = progs.map(p => p.programa);
  const errorPctVals = progs.map(p => p.totalAuditorias > 0 ? Number(((p.errores / p.totalAuditorias) * 100).toFixed(1)) : 0);
  const sinErrorPctVals = progs.map(p => p.totalAuditorias > 0 ? Number(Math.max(0, 100 - ((p.errores / p.totalAuditorias) * 100)).toFixed(1)) : 100);

  chartInconsistenciasProgInst = new Chart(ctx, {
    type: 'bar',
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Errores de Dato',
          data: errorPctVals,
          backgroundColor: '#e11d48',
          borderRadius: (ctx) => {
            const idx = ctx.dataIndex;
            return sinErrorPctVals[idx] === 0 ? 4 : { topLeft: 4, bottomLeft: 4, topRight: 0, bottomRight: 0 };
          },
          barPercentage: 0.65,
          categoryPercentage: 0.75
        },
        {
          label: 'Auditorías Sin Error',
          data: sinErrorPctVals,
          backgroundColor: '#0284c7',
          borderRadius: (ctx) => {
            const idx = ctx.dataIndex;
            return errorPctVals[idx] === 0 ? 4 : { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 };
          },
          barPercentage: 0.65,
          categoryPercentage: 0.75
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 145, top: 6, bottom: 6, left: 10 } },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            boxWidth: 12,
            font: { size: 10, weight: '600' },
            color: currentTheme === 'dark' ? '#cbd5e1' : '#334155'
          }
        },
        datalabels: {
          display: (ctx) => {
            // Renderizar la etiqueta consolidada al final de la barra apilada al 100%
            if (ctx.datasetIndex === 1) return true;
            if (ctx.datasetIndex === 0 && sinErrorPctVals[ctx.dataIndex] === 0) return true;
            return false;
          },
          anchor: 'end',
          align: 'end',
          offset: 8,
          clip: false,
          color: (ctx) => {
            const p = progs[ctx.dataIndex];
            if (p.pctError >= 50) return currentTheme === 'dark' ? '#fb7185' : '#e11d48';
            if (p.pctError >= 20) return currentTheme === 'dark' ? '#fbbf24' : '#d97706';
            return currentTheme === 'dark' ? '#cbd5e1' : '#1e293b';
          },
          font: { weight: 'bold', size: 10 },
          formatter: (value, context) => {
            const p = progs[context.dataIndex];
            return `${p.errores.toLocaleString('es-CO')} / ${p.totalAuditorias.toLocaleString('es-CO')} (${p.pctError.toFixed(1)}%)`;
          }
        },
        tooltip: {
          callbacks: {
            title: function (contexts) {
              if (contexts.length > 0) {
                return progs[contexts[0].dataIndex].programa;
              }
              return '';
            },
            label: function (context) {
              const p = progs[context.dataIndex];
              if (context.datasetIndex === 0) {
                return ` Errores de Dato: ${p.errores.toLocaleString('es-CO')} (${p.pctError.toFixed(1)}%)`;
              } else {
                const sinErr = Math.max(0, p.totalAuditorias - p.errores);
                const pctSinErr = p.totalAuditorias > 0 ? ((sinErr / p.totalAuditorias) * 100).toFixed(1) : "0.0";
                return ` Auditorías Sin Error: ${sinErr.toLocaleString('es-CO')} (${pctSinErr}%)`;
              }
            },
            afterBody: function (contexts) {
              if (contexts.length > 0) {
                const p = progs[contexts[0].dataIndex];
                return [
                  ` ─────────────────────`,
                  ` Total Auditorías: ${p.totalAuditorias.toLocaleString('es-CO')} (100%)`
                ];
              }
            }
          }
        }
      },
      onClick: (e, activeElements) => {
        if (activeElements.length > 0) {
          const index = activeElements[0].index;
          const prog = rawLabels[index];
          toggleFilter("programa", prog);
        }
      },
      scales: {
        x: {
          stacked: true,
          min: 0,
          max: 100,
          grid: {
            display: true,
            color: currentTheme === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            display: true,
            stepSize: 25,
            callback: (val) => val + '%',
            color: currentTheme === 'dark' ? '#94a3b8' : '#64748b',
            font: { size: 9, weight: '600' }
          }
        },
        y: {
          stacked: true,
          grid: { display: false },
          ticks: {
            autoSkip: false,
            color: currentTheme === 'dark' ? '#cbd5e1' : '#1e293b',
            font: { size: 9.5, weight: '600' }
          }
        }
      }
    }
  });
}

function renderTblInconsistenciasProgramas(detalle, filteredFb) {
  const tbody = document.getElementById("tbodyInconsistenciasProgramas");
  if (!tbody) return;
  tbody.innerHTML = "";

  const progs = getInconsistenciasByPrograma(detalle, filteredFb);

  if (progs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 18px; color: #64748b;">No se detectaron errores de datos con los filtros seleccionados</td></tr>';
    return;
  }

  progs.forEach(p => {
    const pctStr = p.pctError.toFixed(1);
    let badgeStyle = "background: #e0f2fe; color: #0369a1; font-weight: 600;";
    if (p.pctError >= 50) {
      badgeStyle = "background: #ffe4e6; color: #be123c; font-weight: 700;";
    } else if (p.pctError >= 20) {
      badgeStyle = "background: #fef3c7; color: #b45309; font-weight: 700;";
    }

    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.title = `Haz clic para filtrar por el programa ${p.programa}`;
    tr.onclick = () => toggleFilter("programa", p.programa);

    tr.innerHTML = `
      <td style="font-weight: 600; color: #0284c7;">${escapeHtml(p.programa)}</td>
      <td style="text-align: right; font-weight: 600;">${p.totalAuditorias.toLocaleString("es-CO")}</td>
      <td style="text-align: right;"><span class="badge-analytics" style="background:#ffe4e6; color:#be123c; font-weight:700;">${p.errores.toLocaleString("es-CO")}</span></td>
      <td style="text-align: right;"><span class="badge-analytics" style="${badgeStyle}">${pctStr}%</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// =========================================================================
// MÓDULO ANÁLISIS DE DEMORAS EN EL CIERRE DE ATENCIONES (MÉDICOS, SEDES, MESES)
// =========================================================================

function switchDemoraMedicosMode(mode) {
  demoraMedicosMode = mode;
  const btnV = document.getElementById("btnDemoraMedicosVol");
  const btnP = document.getElementById("btnDemoraMedicosPct");
  if (btnV) btnV.classList.toggle("active", mode === "volumen");
  if (btnP) btnP.classList.toggle("active", mode === "pct");
  const data = applyClientFiltersToData(rawDashboardData, currentFilters);
  renderChartDemoraMedicos(data.demora_medicos, mode);
}

function switchDemoraSedesMode(mode) {
  demoraSedesMode = mode;
  const btnV = document.getElementById("btnDemoraSedesVol");
  const btnP = document.getElementById("btnDemoraSedesPct");
  if (btnV) btnV.classList.toggle("active", mode === "volumen");
  if (btnP) btnP.classList.toggle("active", mode === "pct");
  const data = applyClientFiltersToData(rawDashboardData, currentFilters);
  renderChartDemoraSedes(data.demora_sedes, mode);
}

function switchDemoraMesesMode(mode) {
  demoraMesesMode = mode;
  const btnC = document.getElementById("btnDemoraMesesComp");
  const btnP = document.getElementById("btnDemoraMesesPct");
  if (btnC) btnC.classList.toggle("active", mode === "comparativa");
  if (btnP) btnP.classList.toggle("active", mode === "pct");
  const data = applyClientFiltersToData(rawDashboardData, currentFilters);
  renderChartDemoraMeses(data.demora_meses, mode);
}

// 1. GRÁFICO DE MÉDICOS - CIERRE DE HISTORIAS (HISTORIAS CERRADAS VS PENDIENTES)
function renderChartDemoraMedicos(medicosData, mode = "volumen", isInternalFilter = false) {
  const canvas = document.getElementById("chartDemoraMedicos");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (chartDemoraMedicosInst) chartDemoraMedicosInst.destroy();

  if (!isInternalFilter) {
    lastDemoraMedicosData = medicosData;
    lastDemoraMedicosMode = mode;
  }

  let list = (medicosData || []).filter(m => {
    if (!m) return false;
    if (m.pendientes > 0) return true;
    if (isInternalFilter || (medicosData.length === 1 && m.total > 0)) return true;
    return false;
  });

  // Ordenar de menor a mayor porcentaje de historias cerradas (mayor % de pendientes primero), priorizando registros de mayor volumen
  const medsConVolumen = list.filter(m => (m.total || 0) >= 25 || (m.pendientes || 0) >= 4);
  const medsBajoVolumen = list.filter(m => !((m.total || 0) >= 25 || (m.pendientes || 0) >= 4));

  medsConVolumen.sort((a, b) => {
    const diffPct = (a.pct_cerradas || 0) - (b.pct_cerradas || 0);
    if (Math.abs(diffPct) > 0.001) return diffPct;
    return (b.pendientes || 0) - (a.pendientes || 0) || (b.total || 0) - (a.total || 0);
  });

  medsBajoVolumen.sort((a, b) => {
    const diffPct = (a.pct_cerradas || 0) - (b.pct_cerradas || 0);
    if (Math.abs(diffPct) > 0.001) return diffPct;
    return (b.pendientes || 0) - (a.pendientes || 0) || (b.total || 0) - (a.total || 0);
  });

  // Mostrar todos los médicos con pendientes, priorizando mayor volumen al inicio
  const topMeds = [...medsConVolumen, ...medsBajoVolumen];

  const wrapper = document.getElementById("wrapperChartDemoraMedicos");

  if (topMeds.length === 0) {
    if (wrapper) wrapper.style.height = "260px";
    canvas.style.height = "260px";
    chartDemoraMedicosInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Sin historias en progreso registradas en médicos'],
        datasets: [{ data: [100], backgroundColor: '#10b981' }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      }
    });
    return;
  }

  // Altura dinámica: 28px por barra dentro del contenedor scrollable
  const calcHeight = Math.max(260, topMeds.length * 28);
  if (wrapper) {
    wrapper.style.height = `${calcHeight}px`;
  }
  canvas.style.height = `${calcHeight}px`;

  const labels = topMeds.map(m => toNomPropio(m["NOMBRE PROFESIONAL"] || ""));
  const rawLabels = topMeds.map(m => m["NOMBRE PROFESIONAL"] || "");
  const cerradasPctVals = topMeds.map(m => Number(m.pct_cerradas !== undefined ? m.pct_cerradas : (100.0 - (m.pct_demora || 0)).toFixed(1)));
  const demoraPctVals = topMeds.map(m => Number((m.pct_demora || 0).toFixed(1)));

  chartDemoraMedicosInst = new Chart(ctx, {
    type: 'bar',
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Historias Cerradas (%)',
          data: cerradasPctVals,
          backgroundColor: currentTheme === 'dark' ? '#0d9488' : '#059669',
          borderColor: currentTheme === 'dark' ? '#14b8a6' : '#047857',
          borderWidth: 1,
          borderRadius: (ctx) => {
            const idx = ctx.dataIndex;
            return demoraPctVals[idx] === 0 ? 4 : { topLeft: 4, bottomLeft: 4, topRight: 0, bottomRight: 0 };
          },
          barPercentage: 0.72,
          categoryPercentage: 0.85
        },
        {
          label: 'Historias En Progreso (%)',
          data: demoraPctVals,
          backgroundColor: currentTheme === 'dark' ? '#f43f5e' : '#e11d48',
          borderColor: currentTheme === 'dark' ? '#fb7185' : '#be123c',
          borderWidth: 1,
          borderRadius: (ctx) => {
            const idx = ctx.dataIndex;
            return cerradasPctVals[idx] === 0 ? 4 : { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 };
          },
          barPercentage: 0.72,
          categoryPercentage: 0.85
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 16, right: 38, top: 4, bottom: 4 } },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            boxWidth: 10,
            font: { size: 9.5, weight: '600' },
            color: currentTheme === 'dark' ? '#cbd5e1' : '#334155'
          }
        },
        datalabels: {
          display: (ctx) => {
            // Renderizar la etiqueta consolidada al final de la barra apilada al 100%
            if (ctx.datasetIndex === 1) return true;
            if (ctx.datasetIndex === 0 && (demoraPctVals[ctx.dataIndex] === 0 || !demoraPctVals[ctx.dataIndex])) return true;
            return false;
          },
          anchor: 'end',
          align: 'end',
          offset: 8,
          clip: false,
          color: (ctx) => {
            const m = topMeds[ctx.dataIndex];
            const pct = Number(m.pct_demora !== undefined ? m.pct_demora : (100.0 - (m.pct_cerradas || 0)));
            if (pct >= 50) return currentTheme === 'dark' ? '#fb7185' : '#e11d48';
            if (pct >= 20) return currentTheme === 'dark' ? '#fbbf24' : '#d97706';
            if (pct >= 10) return currentTheme === 'dark' ? '#f59e0b' : '#b45309';
            return currentTheme === 'dark' ? '#cbd5e1' : '#1e293b';
          },
          font: { weight: 'bold', size: 9.5 },
          formatter: (value, context) => {
            const m = topMeds[context.dataIndex];
            const pct = Number(m.pct_demora !== undefined ? m.pct_demora : (100.0 - (m.pct_cerradas || 0))).toFixed(1);
            return `${pct}%`;
          }
        },
        tooltip: {
          callbacks: {
            title: (contexts) => contexts.length ? topMeds[contexts[0].dataIndex]["NOMBRE PROFESIONAL"] : '',
            label: (context) => {
              const m = topMeds[context.dataIndex];
              const cerradasCount = m.cerradas !== undefined ? m.cerradas : Math.max(0, m.total - m.pendientes);
              if (context.datasetIndex === 0) {
                return ` ✅ Historias Cerradas: ${cerradasCount.toLocaleString('es-CO')} (${context.raw}%)`;
              } else {
                return ` ⏳ En Progreso: ${m.pendientes.toLocaleString('es-CO')} (${context.raw}%)`;
              }
            },
            afterBody: (contexts) => {
              if (!contexts.length) return [];
              const m = topMeds[contexts[0].dataIndex];
              const sedeInfo = m["NOMBRE IPS"] ? ` 🏥 Sede: ${m["NOMBRE IPS"]}` : "";
              const idInfo = m.identificacion && m.identificacion !== "N/A" ? ` 🪪 Cédula: ${m.identificacion}` : "";
              return [
                ` ─────────────────────────`,
                ` 📋 Total Citas Asignadas: ${m.total.toLocaleString('es-CO')} (100.0%)`,
                sedeInfo,
                idInfo
              ].filter(Boolean);
            }
          }
        }
      },
      onClick: (e, activeElements) => {
        if (activeElements.length > 0) {
          const index = activeElements[0].index;
          const prof = rawLabels[index];
          toggleFilter("profesional", prof);
        }
      },
      scales: {
        x: {
          stacked: true,
          min: 0,
          max: 100,
          grid: { color: currentTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
          ticks: {
            stepSize: 25,
            callback: (v) => v + '%',
            color: currentTheme === 'dark' ? '#cbd5e1' : '#1e293b',
            font: { size: 9 }
          }
        },
        y: {
          stacked: true,
          grid: { display: false },
          afterFit: function (axis) {
            if (axis.width < 185) {
              axis.width = 185;
            }
          },
          ticks: {
            color: currentTheme === 'dark' ? '#cbd5e1' : '#1e293b',
            font: { size: 9.5, weight: '600' },
            padding: 6
          }
        }
      }
    }
  });
}

// 2. GRÁFICO DE SEDES - CIERRE DE HISTORIAS (HISTORIAS CERRADAS VS PENDIENTES)
function renderChartDemoraSedes(sedesData, mode = "volumen", targetCanvasId = "chartDemoraSedes") {
  const canvas = document.getElementById(targetCanvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  if (targetCanvasId === "chartSedesPct") {
    if (chartSedesPctInst) chartSedesPctInst.destroy();
  } else {
    if (chartDemoraSedesInst) chartDemoraSedesInst.destroy();
  }

  let list = (sedesData || []).filter(s => {
    if (!s) return false;
    if (s.pendientes > 0) return true;
    if (sedesData.length === 1 && s.total > 0) return true;
    return false;
  });

  // Ordenar de menor a mayor porcentaje de historias cerradas (mayor % de pendientes primero), priorizando registros de mayor volumen
  const sedesConVolumen = list.filter(s => (s.total || 0) >= 1000 || (s.pendientes || 0) >= 15);
  const sedesBajoVolumen = list.filter(s => !((s.total || 0) >= 1000 || (s.pendientes || 0) >= 15));

  sedesConVolumen.sort((a, b) => {
    const diffPct = (a.pct_cerradas || 0) - (b.pct_cerradas || 0);
    if (Math.abs(diffPct) > 0.001) return diffPct;
    return (b.pendientes || 0) - (a.pendientes || 0) || (b.total || 0) - (a.total || 0);
  });

  sedesBajoVolumen.sort((a, b) => {
    const diffPct = (a.pct_cerradas || 0) - (b.pct_cerradas || 0);
    if (Math.abs(diffPct) > 0.001) return diffPct;
    return (b.pendientes || 0) - (a.pendientes || 0) || (b.total || 0) - (a.total || 0);
  });

  const fullSortedSedes = [...sedesConVolumen, ...sedesBajoVolumen];
  const topSedes = fullSortedSedes;

  const wrapper = (targetCanvasId === "chartDemoraSedes")
    ? document.getElementById("wrapperChartDemoraSedes")
    : (targetCanvasId === "chartSedesPct" ? document.getElementById("wrapperChartSedesPct") : null);

  if (topSedes.length === 0) {
    if (wrapper) wrapper.style.height = "260px";
    canvas.style.height = "260px";
    const emptyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Sin historias pendientes registradas en sedes'],
        datasets: [{ data: [100], backgroundColor: '#10b981' }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    if (targetCanvasId === "chartSedesPct") chartSedesPctInst = emptyChart;
    else chartDemoraSedesInst = emptyChart;
    return;
  }

  if (wrapper) {
    const calcHeight = Math.max(260, topSedes.length * 28);
    wrapper.style.height = `${calcHeight}px`;
    canvas.style.height = `${calcHeight}px`;
  }

  const labels = topSedes.map(s => s["NOMBRE IPS"] || s.sede || "Desconocida");
  const cerradasPctVals = topSedes.map(s => Number(s.pct_cerradas !== undefined ? s.pct_cerradas : (100.0 - (s.pct_demora || 0)).toFixed(1)));
  const demoraPctVals = topSedes.map(s => Number((s.pct_demora || 0).toFixed(1)));

  const newChart = new Chart(ctx, {
    type: 'bar',
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Historias Cerradas (%)',
          data: cerradasPctVals,
          backgroundColor: currentTheme === 'dark' ? '#0d9488' : '#059669',
          borderColor: currentTheme === 'dark' ? '#14b8a6' : '#047857',
          borderWidth: 1,
          borderRadius: { topLeft: 4, bottomLeft: 4 },
          barPercentage: 0.72,
          categoryPercentage: 0.85,
          datalabels: {
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] >= 10.0,
            anchor: 'center',
            align: 'center',
            color: '#ffffff',
            font: { weight: 'bold', size: 9 },
            formatter: (value) => `${value}%`
          }
        },
        {
          label: 'Historias Pendientes (%)',
          data: demoraPctVals,
          backgroundColor: currentTheme === 'dark' ? '#f43f5e' : '#e11d48',
          borderColor: currentTheme === 'dark' ? '#fb7185' : '#be123c',
          borderWidth: 1,
          borderRadius: { topRight: 4, bottomRight: 4 },
          barPercentage: 0.72,
          categoryPercentage: 0.85,
          datalabels: {
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
            anchor: (ctx) => (ctx.dataset.data[ctx.dataIndex] >= 6.0 ? 'center' : 'end'),
            align: (ctx) => (ctx.dataset.data[ctx.dataIndex] >= 6.0 ? 'center' : 'end'),
            offset: (ctx) => (ctx.dataset.data[ctx.dataIndex] >= 6.0 ? 0 : 4),
            color: (ctx) => (ctx.dataset.data[ctx.dataIndex] >= 6.0 ? '#ffffff' : (currentTheme === 'dark' ? '#fb7185' : '#e11d48')),
            font: { weight: 'bold', size: 9 },
            formatter: (value) => `${value}%`
          }
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 48, top: 4, bottom: 4, left: 6 } },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            boxWidth: 10,
            font: { size: 9.5, weight: '600' },
            color: currentTheme === 'dark' ? '#cbd5e1' : '#334155'
          }
        },
        tooltip: {
          callbacks: {
            title: (contexts) => contexts.length ? topSedes[contexts[0].dataIndex]["NOMBRE IPS"] : '',
            label: (context) => {
              const s = topSedes[context.dataIndex];
              const cerradasCount = s.cerradas !== undefined ? s.cerradas : Math.max(0, s.total - s.pendientes);
              if (context.datasetIndex === 0) {
                return ` ✅ Historias Cerradas: ${cerradasCount.toLocaleString('es-CO')} (${context.raw}%)`;
              } else {
                return ` ⏳ Historias Pendientes: ${s.pendientes.toLocaleString('es-CO')} (${context.raw}%)`;
              }
            },
            afterBody: (contexts) => {
              if (!contexts.length) return [];
              const s = topSedes[contexts[0].dataIndex];
              return [
                ` ─────────────────────────`,
                ` 📋 Total Citas Asignadas: ${s.total.toLocaleString('es-CO')} (100.0%)`
              ];
            }
          }
        }
      },
      onClick: (e, activeElements) => {
        if (activeElements.length > 0) {
          const index = activeElements[0].index;
          const sede = labels[index];
          toggleFilter("sede", sede);
        }
      },
      scales: {
        x: {
          stacked: true,
          min: 0,
          max: 100,
          grid: { color: currentTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
          ticks: {
            callback: (v) => v + '%',
            color: currentTheme === 'dark' ? '#cbd5e1' : '#1e293b',
            font: { size: 9 }
          }
        },
        y: {
          stacked: true,
          grid: { display: false },
          ticks: {
            color: currentTheme === 'dark' ? '#cbd5e1' : '#1e293b',
            font: { size: 9.5, weight: '600' }
          }
        }
      }
    }
  });

  if (targetCanvasId === "chartSedesPct") chartSedesPctInst = newChart;
  else chartDemoraSedesInst = newChart;
}

// 3. GRÁFICO DE MESES - CIERRE DE HISTORIAS (HISTORIAS CERRADAS VS PENDIENTES)
function renderChartDemoraMeses(mesesData, mode = "comparativa", targetCanvasId = "chartDemoraMeses") {
  const canvas = document.getElementById(targetCanvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  if (targetCanvasId === "chartMeses") {
    if (chartMesesInst) chartMesesInst.destroy();
  } else {
    if (chartDemoraMesesInst) chartDemoraMesesInst.destroy();
  }

  const list = (mesesData || []).filter(m => m && (m.pendientes > 0 || m.total > 0));

  if (list.length === 0) {
    const emptyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Sin datos mensuales'],
        datasets: [{ data: [100], backgroundColor: '#10b981' }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    if (targetCanvasId === "chartMeses") chartMesesInst = emptyChart;
    else chartDemoraMesesInst = emptyChart;
    return;
  }

  const labels = list.map(m => {
    const mesNom = m["Nombre del mes"] || "";
    return mesNom.charAt(0).toUpperCase() + mesNom.slice(1);
  });
  const cerradasPctVals = list.map(m => Number(m.pct_cerradas !== undefined ? m.pct_cerradas : (100.0 - (m.pct_demora || 0)).toFixed(1)));
  const demoraPctVals = list.map(m => Number((m.pct_demora || 0).toFixed(1)));

  let chartDatasets = [];
  let isStacked = true;

  if (mode === "pct") {
    isStacked = false;
    const bgColors = demoraPctVals.map(p => {
      if (p >= 50) return '#e11d48';
      if (p >= 20) return '#f59e0b';
      return '#10b981';
    });
    chartDatasets = [
      {
        label: '% Historias Pendientes',
        data: demoraPctVals,
        backgroundColor: bgColors,
        borderRadius: 4,
        barPercentage: 0.5,
        categoryPercentage: 0.6
      }
    ];
  } else {
    // 100% Stacked Bar Chart
    chartDatasets = [
      {
        label: 'Historias Cerradas (%)',
        data: cerradasPctVals,
        backgroundColor: currentTheme === 'dark' ? '#0d9488' : '#059669',
        borderColor: currentTheme === 'dark' ? '#14b8a6' : '#047857',
        borderWidth: 1,
        borderRadius: { topLeft: 4, bottomLeft: 4 },
        barPercentage: 0.65,
        categoryPercentage: 0.75
      },
      {
        label: 'Historias Pendientes (%)',
        data: demoraPctVals,
        backgroundColor: currentTheme === 'dark' ? '#f43f5e' : '#e11d48',
        borderColor: currentTheme === 'dark' ? '#fb7185' : '#be123c',
        borderWidth: 1,
        borderRadius: { topRight: 4, bottomRight: 4 },
        barPercentage: 0.65,
        categoryPercentage: 0.75
      }
    ];
  }

  const newChart = new Chart(ctx, {
    type: 'bar',
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: chartDatasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20, right: 15, bottom: 15, left: 10 } },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            boxWidth: 12,
            font: { size: 10, weight: '600' },
            color: currentTheme === 'dark' ? '#cbd5e1' : '#334155'
          }
        },
        datalabels: {
          display: (ctx) => {
            const val = ctx.dataset.data[ctx.dataIndex];
            return val >= 4.0;
          },
          anchor: isStacked ? 'center' : 'end',
          align: isStacked ? 'center' : 'top',
          color: isStacked ? '#ffffff' : (currentTheme === 'dark' ? '#cbd5e1' : '#0f172a'),
          font: { weight: 'bold', size: 10 },
          formatter: (value) => `${value}%`
        },
        tooltip: {
          callbacks: {
            title: (contexts) => contexts.length ? labels[contexts[0].dataIndex] : '',
            label: (context) => {
              const m = list[context.dataIndex];
              const cerradasCount = m.cerradas !== undefined ? m.cerradas : Math.max(0, m.total - m.pendientes);
              if (mode === "pct") {
                return ` 📊 Historias Pendientes: ${context.raw}%`;
              }
              if (context.datasetIndex === 0) {
                return ` ✅ Historias Cerradas: ${cerradasCount.toLocaleString('es-CO')} (${context.raw}%)`;
              } else {
                return ` ⏳ Historias Pendientes: ${m.pendientes.toLocaleString('es-CO')} (${context.raw}%)`;
              }
            },
            afterBody: (contexts) => {
              if (!contexts.length) return [];
              const m = list[contexts[0].dataIndex];
              return [
                ` ─────────────────────────`,
                ` 📋 Total Citas Asignadas: ${m.total.toLocaleString('es-CO')} (100.0%)`
              ];
            }
          }
        }
      },
      onClick: (e, activeElements) => {
        if (activeElements.length > 0) {
          const index = activeElements[0].index;
          const clickedMes = list[index]["Nombre del mes"];
          toggleFilter("mes", clickedMes);
        }
      },
      scales: {
        x: {
          stacked: isStacked,
          grid: { display: false },
          ticks: {
            color: currentTheme === 'dark' ? '#cbd5e1' : '#1e293b',
            font: { size: 10.5, weight: '600' }
          }
        },
        y: {
          stacked: isStacked,
          min: 0,
          max: isStacked ? 100 : undefined,
          grid: { color: currentTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
          ticks: {
            callback: (v) => v + '%',
            color: currentTheme === 'dark' ? '#94a3b8' : '#64748b'
          }
        }
      }
    }
  });

  if (targetCanvasId === "chartMeses") chartMesesInst = newChart;
  else chartDemoraMesesInst = newChart;
}

// =========================================================================
// MODO OSCURO (DARK MODE)
// =========================================================================

function updateThemeButtonUI() {
  const btn = document.getElementById("btnToggleTheme");
  if (!btn) return;
  const isDark = (currentTheme === "dark");
  btn.innerHTML = isDark
    ? '<i class="fa-solid fa-sun" id="themeIcon"></i> <span id="themeLabel">Modo Claro</span>'
    : '<i class="fa-solid fa-moon" id="themeIcon"></i> <span id="themeLabel">Modo Oscuro</span>';
  btn.title = isDark ? "Cambiar a Modo Claro (Alt+D)" : "Cambiar a Modo Oscuro (Alt+D)";
}

function initTheme() {
  const saved = localStorage.getItem("agendaweb_theme") || "light";
  currentTheme = saved;
  document.body.classList.toggle("dark-theme", saved === "dark");
  updateThemeButtonUI();
}

function toggleTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem("agendaweb_theme", currentTheme);
  } catch (e) { }
  document.body.classList.toggle("dark-theme", currentTheme === "dark");
  updateThemeButtonUI();
  renderCurrentDataState();
}

// =========================================================================
// IMPRESIÓN Y REPORTE EJECUTIVO PDF
// =========================================================================

function printExecutiveReport() {
  window.print();
}

// =========================================================================
// NAVEGACIÓN Y TECLAS RÁPIDAS GLOBALES
// =========================================================================

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeFeedbackModal();
    closeConfigModal();
    closeProductivityModal();
    closeDashboardModal();
    closeAllMultiSelects();
    const popover = document.getElementById("columnPickerPopover");
    if (popover) popover.classList.remove("open");
    return;
  }

  // Alt+D -> Alternar Modo Oscuro
  if (e.altKey && (e.key === "d" || e.key === "D")) {
    e.preventDefault();
    toggleTheme();
    return;
  }

  // Alt+P -> Abrir Productividad
  if (e.altKey && (e.key === "p" || e.key === "P")) {
    e.preventDefault();
    openProductivityModal();
    return;
  }

  // Alt+B -> Abrir Dashboard de Gestión
  if (e.altKey && (e.key === "b" || e.key === "B")) {
    e.preventDefault();
    openDashboardModal();
    return;
  }
});
