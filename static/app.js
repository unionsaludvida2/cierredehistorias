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

var currentFilters = window.currentFilters || {
  periodo: "ultimo_mes", // ultimo_mes, fechas_previas, ambos
  ano: [],
  mes: [],
  dia: [],
  quincena: [],
  sede: [],
  programa: [],
  profesional: []
};

// Normalizar filtros existentes para garantizar arrays
(function normalizeCurrentFilters() {
  ['ano', 'mes', 'dia', 'quincena', 'sede', 'programa', 'profesional'].forEach(k => {
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
var expandedMonths = window.expandedMonths || {};

var currentDetalleData = window.currentDetalleData || [];
var filteredDetalleData = window.filteredDetalleData || [];
var currentPage = 1;
var pageSize = 50;
var selectedCita = null;
var selectedCitasSet = new Set();
var isBulkAuditMode = false;

var localFeedbackStore = {};
try {
  localFeedbackStore = JSON.parse(localStorage.getItem("agendaweb_local_feedbacks") || "{}");
} catch (e) { }

function saveLocalFeedback(idCita, rec) {
  localFeedbackStore[String(idCita)] = rec;
  try {
    localStorage.setItem("agendaweb_local_feedbacks", JSON.stringify(localFeedbackStore));
  } catch (e) { }
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
    null,
    null,
    { key: "estado_fb", type: "string" },
    null
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
  fetchDashboardData();
  fetchConfig();

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".multi-select-box")) {
      closeAllMultiSelects();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllMultiSelects();
    }
  });
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  initApp();
} else {
  document.addEventListener("DOMContentLoaded", initApp);
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

function sanitizeRawDashboardData(data) {
  if (!data) return data;

  // 1. Normalizar detalle_pendientes
  if (Array.isArray(data.detalle_pendientes)) {
    data.detalle_pendientes.forEach(d => {
      if (d.sede) d.sede = normalizeSedeName(d.sede);
      if (d.profesional && d.cedula_profesional) {
        userCedulaMap[d.profesional] = d.cedula_profesional;
        userCedulaMap[toNomPropio(d.profesional)] = d.cedula_profesional;
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
      new Set(data.filter_options.sedes.map(normalizeSedeName).filter(Boolean))
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
        return new Set(v.map(x => normalizeSedeName(x).toLowerCase().trim()));
      }
      return new Set(v.map(x => String(x).toLowerCase().trim()));
    }
    if (k === 'sede') {
      return new Set([normalizeSedeName(v).toLowerCase().trim()]);
    }
    return new Set([String(v).toLowerCase().trim()]);
  };

  const sedeSet = getFilterSet('sede');
  const profSet = getFilterSet('profesional');
  const progSet = getFilterSet('programa');
  const anoSet = getFilterSet('ano');
  const mesSet = getFilterSet('mes');
  const diaSet = exceptKey !== 'dia' && filters.dia && (Array.isArray(filters.dia) ? filters.dia.length > 0 : true)
    ? new Set((Array.isArray(filters.dia) ? filters.dia : [filters.dia]).map(Number))
    : null;
  const quinSet = getFilterSet('quincena');

  return items.filter(d => {
    if (sedeSet && !sedeSet.has(normalizeSedeName(d.sede || "").toLowerCase().trim())) return false;
    if (profSet && !profSet.has(String(d.profesional || "").toLowerCase().trim())) return false;
    if (progSet && !progSet.has(String(d.programa || "").toLowerCase().trim())) return false;

    const dp = parseDateParts(d.fecha);
    if (dp) {
      if (anoSet && !anoSet.has(String(dp.ano))) return false;
      if (mesSet && !mesSet.has(dp.mesName.toLowerCase())) return false;
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
    return true;
  });
}

function computeDynamicFilterOptions(allItems, filters, baseUserCedulaMap) {
  const subsetSedes = getFilteredSubsetExcept(allItems, filters, 'sede');
  const subsetProgs = getFilteredSubsetExcept(allItems, filters, 'programa');
  const subsetProfs = getFilteredSubsetExcept(allItems, filters, 'profesional');
  const subsetMeses = getFilteredSubsetExcept(allItems, filters, 'mes');
  const subsetDias = getFilteredSubsetExcept(allItems, filters, 'dia');
  const subsetAnos = getFilteredSubsetExcept(allItems, filters, 'ano');

  const sedes = Array.from(new Set(subsetSedes.map(d => normalizeSedeName(d.sede)).filter(Boolean))).sort();
  const programas = Array.from(new Set(subsetProgs.map(d => d.programa).filter(Boolean))).sort();
  const profesionales = Array.from(new Set(subsetProfs.map(d => d.profesional).filter(Boolean))).sort();

  const mesesSet = new Set();
  subsetMeses.forEach(d => {
    const dp = parseDateParts(d.fecha);
    if (dp && dp.mesName) mesesSet.add(dp.mesName);
  });
  const meses = SPANISH_MONTH_NAMES.filter(m => mesesSet.has(m));

  const diasSet = new Set();
  subsetDias.forEach(d => {
    const dp = parseDateParts(d.fecha);
    if (dp && !isNaN(dp.dia)) diasSet.add(dp.dia);
  });
  const dias = Array.from(diasSet).sort((a, b) => a - b);

  const anosSet = new Set();
  subsetAnos.forEach(d => {
    const dp = parseDateParts(d.fecha);
    if (dp && !isNaN(dp.ano)) anosSet.add(dp.ano);
  });
  const anos = Array.from(anosSet).sort((a, b) => a - b);

  return {
    sedes,
    programas,
    profesionales,
    meses: meses.length > 0 ? meses : ["agosto"],
    dias: dias.length > 0 ? dias : Array.from({ length: 31 }, (_, i) => i + 1),
    anos: anos.length > 0 ? anos : [2026],
    quincenas: ["1ra Quincena", "2da Quincena"],
    user_cedula_map: baseUserCedulaMap || {}
  };
}

const EXCLUDED_AUDIT_KEYWORDS = [
  "cerrada",
  "novedad",
  "atendido",
  "inasistencia",
  "reagendado",
  "error"
];

function isResolvedAuditState(estadoFb) {
  if (!estadoFb || estadoFb === "Sin Auditar" || estadoFb === "Sin Gestión" || estadoFb === "Historia en progreso") {
    return false;
  }
  const st = estadoFb.toLowerCase().trim();
  return EXCLUDED_AUDIT_KEYWORDS.some(ex => st.includes(ex));
}

function sanitizeProgramaName(prog) {
  if (!prog) return "Consulta Medicina General";
  if (prog.includes("AIEPI")) {
    return "Consulta Médica No Programada";
  }
  return prog;
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
      item.estado_fb = lfb.estado;
      if (lfb.observacion) item.observacion_fb = lfb.observacion;
      if (lfb.auditor) item.auditor_fb = lfb.auditor;
      if (lfb.fecha_gestion) item.fecha_fb = lfb.fecha_gestion;
    }
  });


  // Excluir de los indicadores, gráficos y tablas de pendientes aquellas citas auditadas con notas de resolución/aclaración
  const activePendingItems = allItemsUnfiltered.filter(item => !isResolvedAuditState(item.estado_fb));

  const dynamicFilterOptions = computeDynamicFilterOptions(activePendingItems, filters, data.filter_options ? data.filter_options.user_cedula_map : {});
  if (data.filter_options && data.filter_options.auditores) {
    dynamicFilterOptions.auditores = data.filter_options.auditores;
  }

  const getFilterSet = (k) => {
    const v = filters[k];
    if (!v) return null;
    if (Array.isArray(v)) {
      if (v.length === 0) return null;
      if (k === 'sede') {
        return new Set(v.map(x => normalizeSedeName(x).toLowerCase().trim()));
      }
      return new Set(v.map(x => String(x).toLowerCase().trim()));
    }
    if (k === 'sede') {
      return new Set([normalizeSedeName(v).toLowerCase().trim()]);
    }
    return new Set([String(v).toLowerCase().trim()]);
  };

  const sedeSet = getFilterSet('sede');
  const profSet = getFilterSet('profesional');
  const progSet = getFilterSet('programa');
  const anoSet = getFilterSet('ano');
  const mesSet = getFilterSet('mes');
  const diaSet = filters.dia && (Array.isArray(filters.dia) ? filters.dia.length > 0 : true)
    ? new Set((Array.isArray(filters.dia) ? filters.dia : [filters.dia]).map(Number))
    : null;
  const quinSet = getFilterSet('quincena');

  let items = activePendingItems.filter(d => {
    if (sedeSet && !sedeSet.has(normalizeSedeName(d.sede || "").toLowerCase().trim())) return false;
    if (profSet && !profSet.has(String(d.profesional || "").toLowerCase().trim())) return false;
    if (progSet && !progSet.has(String(d.programa || "").toLowerCase().trim())) return false;

    const dp = parseDateParts(d.fecha);
    if (dp) {
      if (anoSet && !anoSet.has(String(dp.ano))) return false;
      if (mesSet && !mesSet.has(dp.mesName.toLowerCase())) return false;
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
    return true;
  });

  const totalPend = items.length;

  let totalGest = 0;
  let totalProg = 0;

  const sedesMap = {};
  items.forEach(it => {
    const sName = normalizeSedeName(it.sede) || "Desconocida";
    const isGest = !!(it.estado_fb && it.estado_fb !== "Sin Gestión" && it.estado_fb !== "Sin Auditar");
    const isProg = it.estado_fb === "Historia en progreso" ||
      it.estado_fb === "Paciente confirmado sin evidencia de historia ni notas aclaratorias" ||
      it.estado_fb === "Historia pendiente por caída del sistema";







    if (isGest) totalGest += 1;
    if (isProg) totalProg += 1;

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

  const totalSin = Math.max(0, totalPend - totalGest);
  const pctCob = totalPend > 0 ? (Math.round(totalGest / totalPend * 1000) / 10) : 0;

  const cedMap = (data && data.filter_options && data.filter_options.user_cedula_map) || {};
  const medicosMap = {};
  items.forEach(it => {
    const pName = it.profesional || "Desconocido";
    if (!medicosMap[pName]) {
      const docCedula = cedMap[pName] || cedMap[toNomPropio(pName)] || userCedulaMap[pName] || userCedulaMap[toNomPropio(pName)] || it.cedula_profesional || "";
      medicosMap[pName] = { "NOMBRE PROFESIONAL": pName, identificacion: docCedula, "NOMBRE IPS": normalizeSedeName(it.sede) || "", pendientes: 0, pct_pendientes: 0 };
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

      if (!treeMap[monthName]) {
        treeMap[monthName] = { mes: monthName, total_pendientes: 0, diasMap: {}, order: monthIdx };
      }
      treeMap[monthName].total_pendientes += 1;

      if (!treeMap[monthName].diasMap[dayNum]) {
        treeMap[monthName].diasMap[dayNum] = { fecha_fmt: it.fecha, dia_num: dayNum, pendientes: 0 };
      }
      treeMap[monthName].diasMap[dayNum].pendientes += 1;
    }
  });

  const fechasTree = Object.values(treeMap)
    .sort((a, b) => a.order - b.order)
    .map(mObj => {
      const diasList = Object.values(mObj.diasMap).sort((a, b) => a.dia_num - b.dia_num);
      return {
        mes: mObj.mes,
        total_pendientes: mObj.total_pendientes,
        dias: diasList
      };
    });

  const mesesChart = fechasTree.map(m => ({
    "Nombre del mes": m.mes,
    "pendientes": m.total_pendientes,
    "pct_pendientes": 0.0
  }));

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
    sedes_chart: sedesSummary.slice(0, 10),
    medicos_pending: medicosPending,
    fechas_tree: fechasTree,
    programas_chart: programasChart,
    meses_chart: mesesChart,
    detalle_pendientes: items
  };
}



var cachedDashboardByPeriodo = {};

// --- OBTENER DATOS DE LA API ---
async function fetchDashboardData(forceRefresh = false) {
  const pVal = currentFilters.periodo || "ultimo_mes";

  if (!forceRefresh && cachedDashboardByPeriodo[pVal]) {
    rawDashboardData = cachedDashboardByPeriodo[pVal];
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
      tbody.innerHTML = '<tr><td colspan="13" class="center">No fue posible conectar con los datos. Por favor verifique su conexión o recargue la página.</td></tr>';
    }
    return;
  }
  rawData = sanitizeRawDashboardData(rawData);
  cachedDashboardByPeriodo[pVal] = rawData;
  rawDashboardData = rawData;
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
    if (reapply) {
      data = applyClientFiltersToData(rawDashboardData, currentFilters);
    }
  }

  try { updateHeaderMeta(data.data_source, data.last_update_info); } catch (e) { console.error("Error header meta:", e); }
  try { updateFilterOptions(data.filter_options || rawDashboardData.filter_options); } catch (e) { console.error("Error filter options:", e); }

  try { renderActiveFilterChips(); } catch (e) { console.error("Error filter chips:", e); }

  try { renderTblSedes(data.sedes_summary); } catch (e) { console.error("Error tbl sedes:", e); }
  try { renderTblMedicos(data.medicos_pending); } catch (e) { console.error("Error tbl medicos:", e); }
  try { renderTreeView(data.fechas_tree, data.kpis ? data.kpis.pendientes : 0); } catch (e) { console.error("Error tree view:", e); }

  currentDetalleData = data.detalle_pendientes || [];
  try { applyClientSearchAndPaginate(); } catch (e) { console.error("Error detalle paginate:", e); }

  try { renderChartProgramas(data.programas_chart); } catch (e) { console.error("Error chart programas:", e); }
  try { renderChartSedesPct(data.sedes_chart || data.sedes_summary); } catch (e) { console.error("Error chart sedes:", e); }
  try { renderChartMeses(data.meses_chart); } catch (e) { console.error("Error chart meses:", e); }
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
      json.records.forEach(r => {
        if (r.id_cita) {
          const cid = String(r.id_cita);
          remoteMap[cid] = r;
          saveLocalFeedback(cid, {
            estado: r.estado,
            observacion: r.observacion,
            auditor: r.auditor,
            fecha_gestion: r.fecha_gestion
          });
        }
      });

      if (rawDashboardData && rawDashboardData.detalle_pendientes) {
        rawDashboardData.detalle_pendientes.forEach(item => {
          const r = remoteMap[String(item.id_cita)];
          if (r) {
            item.estado_fb = r.estado;
            item.observacion_fb = r.observacion || "";
            item.auditor_fb = r.auditor || "";
            item.fecha_fb = r.fecha_gestion || "";
            updatedCount++;
          }
        });
      }

      if (updatedCount > 0 || isManual) {
        console.log(`[Google Sheets Live Sync] ${updatedCount} registros de auditoría sincronizados en vivo desde Google Sheets por ID Cita.`);
        renderCurrentDataState();
      }
      return json.records.length;
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
        formattedDate = dateObj.toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      }
      updateDateElem.innerHTML = `${formattedDate}<br><small>Última actualización de datos</small>`;
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
      }
    } catch (e) { }

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
        currentCisMappings = cfg.cis_mappings;
        if (rawDashboardData) {
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
  auditores: []
};

function updateFilterOptions(opts) {
  if (!opts) return;

  currentFilterOptions.ano = opts.anos || [];
  currentFilterOptions.mes = opts.meses || [];
  currentFilterOptions.dia = opts.dias || [];
  currentFilterOptions.quincena = opts.quincenas || ["1ra Quincena", "2da Quincena"];
  currentFilterOptions.sede = Array.from(new Set((opts.sedes || []).map(normalizeSedeName).filter(Boolean))).sort();
  currentFilterOptions.programa = opts.programas || [];
  currentFilterOptions.profesional = opts.profesionales || [];

  rawComboOptions.sedes = currentFilterOptions.sede;
  rawComboOptions.programas = currentFilterOptions.programa;
  rawComboOptions.profesionales = currentFilterOptions.profesional;

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

  // Refrescar cada uno de los 7 seccionadores multi-select
  ['ano', 'mes', 'dia', 'quincena', 'sede', 'programa', 'profesional'].forEach(key => {
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
  const valStr = String(val).toLowerCase().trim();
  return arr.some(x => String(x).toLowerCase().trim() === valStr);
}

function updateMultiSelectTriggerLabel(key) {
  const labelEl = document.getElementById(`msLabel_${key}`);
  const triggerEl = document.querySelector(`#msBox_${key} .multi-select-trigger`);
  if (!labelEl || !triggerEl) return;

  const sel = currentFilters[key] || [];
  const defaultText = (key === 'ano' || key === 'dia') ? "Todos" : "Todas";

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

const removeAccents = (str) => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";

function renderMultiSelectOptions(key, searchQuery = "") {
  const container = document.getElementById(`msOptions_${key}`);
  if (!container) return;

  const rawOpts = currentFilterOptions[key] || [];
  const normQuery = removeAccents((searchQuery || "").trim());

  const filteredOpts = normQuery
    ? rawOpts.filter(o => removeAccents(String(o)).includes(normQuery))
    : rawOpts;

  container.innerHTML = "";

  if (filteredOpts.length === 0) {
    container.innerHTML = `<div class="multi-select-empty">Sin coincidencias</div>`;
    const selectAllBox = document.getElementById(`msCheckAll_${key}`);
    if (selectAllBox) {
      selectAllBox.checked = false;
      selectAllBox.indeterminate = false;
    }
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

  const displayOpts = (!normQuery && filteredOpts.length > 250) ? filteredOpts.slice(0, 250) : filteredOpts;

  displayOpts.forEach(optVal => {
    const isChecked = isOptionSelected(key, optVal);
    const row = document.createElement("label");
    row.className = "multi-select-option" + (isChecked ? " is-selected" : "");
    row.title = String(optVal);

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = isChecked;
    chk.onchange = (e) => {
      e.stopPropagation();
      toggleMultiSelectOption(key, optVal);
    };

    const span = document.createElement("span");
    span.innerText = String(optVal);

    row.appendChild(chk);
    row.appendChild(span);

    row.onclick = (e) => {
      if (e.target === chk) return;
      e.preventDefault();
      e.stopPropagation();
      chk.checked = !chk.checked;
      toggleMultiSelectOption(key, optVal);
    };

    container.appendChild(row);
  });
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
    const searchInput = document.getElementById(`msSearch_${key}`);
    if (searchInput) {
      searchInput.value = "";
      setTimeout(() => searchInput.focus(), 50);
    }
    renderMultiSelectOptions(key, "");
  }
}

function closeAllMultiSelects() {
  document.querySelectorAll(".multi-select-box.open").forEach(b => b.classList.remove("open"));
}

function onMultiSelectSearch(key) {
  const input = document.getElementById(`msSearch_${key}`);
  const q = input ? input.value : "";
  renderMultiSelectOptions(key, q);
}

function toggleSelectAll(key) {
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
      const set = new Set((currentFilters[key] || []).map(x => String(x).toLowerCase().trim()));
      visibleOpts.forEach(o => {
        if (!set.has(String(o).toLowerCase().trim())) {
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
      const visibleSet = new Set(visibleOpts.map(o => String(o).toLowerCase().trim()));
      currentFilters[key] = (currentFilters[key] || []).filter(o => !visibleSet.has(String(o).toLowerCase().trim()));
    }
  }

  updateMultiSelectTriggerLabel(key);
  renderMultiSelectOptions(key, query);
  renderCurrentDataState();
}

function toggleMultiSelectOption(key, optVal) {
  let arr = [...(currentFilters[key] || [])];
  const valStr = String(optVal).toLowerCase().trim();

  const idx = arr.findIndex(x => String(x).toLowerCase().trim() === valStr);
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
    const has1Q = currentFilters.quincena.includes("1ra Quincena");
    const has2Q = currentFilters.quincena.includes("2da Quincena");
    if (has1Q && !has2Q) {
      currentFilters.dia = currentFilters.dia.filter(d => Number(d) <= 15);
    } else if (has2Q && !has1Q) {
      currentFilters.dia = currentFilters.dia.filter(d => Number(d) > 15);
    }
  }

  updateMultiSelectTriggerLabel(key);
  const searchInput = document.getElementById(`msSearch_${key}`);
  renderMultiSelectOptions(key, searchInput ? searchInput.value : "");
  renderCurrentDataState();
}

// Alias para compatibilidad
function toggleFilter(key, value) {
  toggleMultiSelectOption(key, value);
}

// --- BOTONES BORRADOR INDIVIDUALES (RESETEO POR SEGMENTADOR) ---
function resetSingleFilter(key) {
  if (key === "periodo") {
    selectedPeriodos = { ultimo_mes: true, fechas_previas: false };
    document.getElementById("btnUltimoMes").classList.add("active");
    document.getElementById("btnFechasPrevias").classList.remove("active");
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

  document.getElementById("btnUltimoMes").classList.toggle("active", selectedPeriodos.ultimo_mes);
  document.getElementById("btnFechasPrevias").classList.toggle("active", selectedPeriodos.fechas_previas);

  // Al cambiar de período, resetear filtros específicos de fecha para ver todas las opciones del nuevo período
  if (currentFilters.periodo !== prevPeriodo) {
    currentFilters.mes = [];
    currentFilters.dia = [];
    currentFilters.quincena = [];
  }

  fetchDashboardData();
}

function resetFilters() {
  currentFilters = {
    periodo: "ultimo_mes",
    ano: [],
    mes: [],
    dia: [],
    quincena: [],
    sede: [],
    programa: [],
    profesional: []
  };
  selectedPeriodos = { ultimo_mes: true, fechas_previas: false };
  const btnU = document.getElementById("btnUltimoMes");
  const btnF = document.getElementById("btnFechasPrevias");
  if (btnU) btnU.classList.add("active");
  if (btnF) btnF.classList.remove("active");

  ['ano', 'mes', 'dia', 'quincena', 'sede', 'programa', 'profesional'].forEach(k => {
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

    tr.innerHTML = `
      <td>
        <span style="margin-right: 6px; display: inline-block;">
          <i class="fa-solid fa-building" style="color: var(--pbi-blue); font-size: 12px;"></i>
        </span>
        <strong>${sedeName}</strong>
      </td>
      <td class="num"><strong>${(s.pendientes || 0).toLocaleString('es-CO')}</strong></td>
      <td class="num">${(s.en_progreso || 0).toLocaleString('es-CO')}</td>
      <td class="num">${(s.sin_auditar || 0).toLocaleString('es-CO')}</td>
      <td class="num">${pctG}%</td>
    `;

    tr.onclick = (e) => {
      toggleFilter("sede", sedeName);
    };

    tbody.appendChild(tr);
  });

  const totPctG = totPend > 0 ? (Math.round(totGest / totPend * 1000) / 10) : 0;

  const trTot = document.createElement("tr");
  trTot.style.fontWeight = "bold";
  trTot.style.backgroundColor = "#f1f5f9";
  trTot.innerHTML = `
    <td>Total</td>
    <td class="num"><strong>${totPend.toLocaleString('es-CO')}</strong></td>
    <td class="num">${totProg.toLocaleString('es-CO')}</td>
    <td class="num">${totSin.toLocaleString('es-CO')}</td>
    <td class="num">${totPctG}%</td>
  `;
  tbody.appendChild(trTot);

}



// --- FUNCIONES DE COPIADO AL PORTAPAPELES Y NOTIFICACIÓN TOAST ---
function copyDocToClipboard(e, text) {
  if (e) {
    if (typeof e.stopPropagation === "function") e.stopPropagation();
    if (typeof e.preventDefault === "function") e.preventDefault();
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
      <td>${m["NOMBRE PROFESIONAL"]}</td>
      <td style="user-select: text;">
        <span class="doc-badge" title="Haz clic para copiar cédula del médico" onclick="copyDocToClipboard(event, '${docCed}')">
          ${docCed} <i class="fa-regular fa-copy"></i>
        </span>
      </td>
      <td>${m["NOMBRE IPS"]}</td>
      <td class="num"><strong>${m.pendientes.toLocaleString('es-CO')}</strong></td>
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

  const query = (isUserSearching && input) ? input.value.toLowerCase().trim() : "";
  if (!query) {
    filteredDetalleData = [...currentDetalleData];
  } else {
    filteredDetalleData = currentDetalleData.filter(item =>
      (item.paciente && item.paciente.toLowerCase().includes(query)) ||
      (item.identificacion && item.identificacion.includes(query)) ||
      (item.profesional && item.profesional.toLowerCase().includes(query)) ||
      (item.sede && item.sede.toLowerCase().includes(query)) ||
      (item.programa && item.programa.toLowerCase().includes(query))
    );
  }

  const cfg = tableSortConfig.tblDetalle;
  if (cfg.colIndex >= 0 && cfg.dir !== 'default') {
    const colInfo = tableColumnKeys.tblDetalle[cfg.colIndex];
    if (colInfo) {
      const k = colInfo.key;
      filteredDetalleData.sort((a, b) => {
        let valA = a[k] || '', valB = b[k] || '';
        if (colInfo.type === 'date') {
          valA = parseDateTime(a.fecha, a.hora);
          valB = parseDateTime(b.fecha, b.hora);
        } else if (typeof valA === 'string') {
          valA = valA.toLowerCase();
          valB = valB.toLowerCase();
        }
        if (valA < valB) return cfg.dir === 'asc' ? -1 : 1;
        if (valA > valB) return cfg.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }
  } else {
    filteredDetalleData.sort((a, b) => {
      const tA = parseDateTime(a.fecha, a.hora);
      const tB = parseDateTime(b.fecha, b.hora);
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
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageItems = filteredDetalleData.slice(startIdx, endIdx);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="center">No se encontraron historias pendientes que coincidan con los filtros</td></tr>';
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

    tr.innerHTML = `
      <td class="center" style="width: 36px; min-width: 36px; padding: 4px !important;">
        <input type="checkbox" class="table-checkbox row-check" data-id="${item.id_cita}" ${isChecked ? 'checked' : ''} onchange="onRowCheckChange('${item.id_cita}', this.checked)">
      </td>
      <td>${item.fecha}</td>
      <td>${item.hora}</td>
      <td>${item.sede}</td>
      <td>${item.doc}</td>
      <td style="user-select: text;">
        <span class="doc-badge" title="Haz clic para copiar documento del paciente" onclick="copyDocToClipboard(event, '${item.identificacion}')">
          ${item.identificacion} <i class="fa-regular fa-copy"></i>
        </span>
      </td>
      <td><strong>${item.paciente}</strong></td>
      <td>${item.programa}</td>
      <td>${item.profesional}</td>
      <td class="center"><span class="badge-green">SI</span></td>
      <td class="center"><span class="badge-grey" style="background:#fee2e2; color:#dc2626;">NO</span></td>
      <td class="center"><span class="status-badge ${badgeClass}">${item.estado_fb}</span></td>
      <td class="center">
        <button class="btn-action" onclick="openFeedbackModal('${item.id_cita}')">
          <i class="fa-solid ${btnIcon}"></i> ${btnText}
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });

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

  updateBulkActionButton();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  document.getElementById("pageInfo").innerText = `Mostrando ${startIdx + 1} - ${endIdx} de ${total.toLocaleString('es-CO')} (Página ${currentPage} de ${totalPages})`;
  document.getElementById("currentPageNum").innerText = `${currentPage} de ${totalPages}`;
  document.getElementById("btnPrevPage").disabled = currentPage === 1;
  document.getElementById("btnNextPage").disabled = currentPage >= totalPages;
}


function changePage(delta) {
  currentPage += delta;
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
    const calcHeight = Math.max(250, allProgs.length * 28);
    wrapper.style.height = `${calcHeight}px`;
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
        borderRadius: 3,
        barThickness: 16
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { right: 65, top: 5, bottom: 5, left: 10 }
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end',
          align: 'end',
          clip: false,
          color: '#0f172a',
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
          ticks: {
            color: '#1e293b',
            font: { size: 9, weight: '600' },
            callback: function (val) {
              const label = this.getLabelForValue(val);
              if (label && label.length > 24) {
                const words = label.split(' ');
                let line1 = '';
                let line2 = '';
                words.forEach(w => {
                  if ((line1 + ' ' + w).length <= 22) {
                    line1 += (line1 ? ' ' : '') + w;
                  } else {
                    line2 += (line2 ? ' ' : '') + w;
                  }
                });
                return line2 ? [line1, line2] : line1;
              }
              return label;
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

  const top10 = sedesData.slice(0, 10);
  const labels = top10.map(s => s["NOMBRE IPS"] || s.sede);
  const dataVals = top10.map(s => s.pendientes || 0);

  chartSedesPctInst = new Chart(ctx, {
    type: 'bar',
    plugins: getChartPlugins(),
    data: {
      labels: labels,
      datasets: [{
        label: 'Citas Pendientes',
        data: dataVals,
        backgroundColor: '#0078d4',
        borderColor: '#005a9e',
        borderWidth: 1,
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 35, right: 10, bottom: 22, left: 10 }
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end',
          align: 'end',
          clip: false,
          color: '#0f172a',
          font: { weight: 'bold', size: 10.5 },
          formatter: (v) => (typeof v === 'number' ? v.toLocaleString('es-CO') : v)
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
        y: {
          grace: '35%',
          grid: { display: false },
          ticks: { display: false }
        },
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: false,
            color: '#1e293b',
            font: { size: 9, weight: '600' },
            maxRotation: 0,
            minRotation: 0,
            callback: function (val) {
              const label = this.getLabelForValue(val);
              if (!label) return '';
              if (label.length > 10) {
                const words = label.split(' ');
                if (words.length > 1) {
                  const lines = [];
                  let currentLine = '';
                  words.forEach(word => {
                    if (currentLine && (currentLine + ' ' + word).length > 10) {
                      lines.push(currentLine);
                      currentLine = word;
                    } else {
                      currentLine += (currentLine ? ' ' : '') + word;
                    }
                  });
                  if (currentLine) lines.push(currentLine);
                  return lines;
                }
              }
              return label;
            }
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

  document.getElementById("modalEstado").value = item.estado_fb || "Historia en progreso";
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
  document.getElementById("modalCitaDetalle").innerText = `Se aplicará el mismo estado y observación a todas las ${count} historias clínicas seleccionadas.`;

  document.getElementById("modalEstado").value = "Novedad médica (incapacidad, calamidad, etc.)";
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
  selectedCita = null;
  isBulkAuditMode = false;
}

async function saveFeedback() {
  if (!isBulkAuditMode && !selectedCita) return;
  if (isBulkAuditMode && selectedCitasSet.size === 0) return;

  const saveBtn = document.getElementById("btnSubmitFeedback") || document.querySelector("#feedbackForm button[type='submit']");
  const origHtml = saveBtn ? saveBtn.innerHTML : 'Guardar y Sincronizar';

  const estado = document.getElementById("modalEstado").value;
  const observacion = (document.getElementById("modalObservacion").value || "").trim();
  const auditor = (document.getElementById("modalAuditorInput").value || "").trim();
  const cedula_last4 = (document.getElementById("modalAuditorCedula").value || "").trim();

  if (!auditor) {
    alert("Por favor ingrese o seleccione su Nombre de Auditor / Usuario.");
    return;
  }

  if (!cedula_last4 || cedula_last4.length !== 4 || !/^\d{4}$/.test(cedula_last4)) {
    alert("Por favor ingrese únicamente los 4 últimos dígitos numéricos de su Cédula.");
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
          body: JSON.stringify({ ids_citas, estado, observacion, auditor, cedula_auditor })
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
        const batchRecords = ids_citas.map(id => ({
          id_cita: id,
          estado: estado,
          observacion: observacion,
          auditor: auditor,
          cedula_auditor: cedula_auditor,
          fecha_gestion: new Date().toLocaleString('es-CO'),
          ip_equipo: "Web App (GitHub Pages)",
          usuario_pc: "Usuario Web",
          nombre_equipo: "Navegador Web"
        }));

        // Enviar cada registro en paralelo usando el formato individual compatible con la versión activa de Google Apps Script
        const postPromises = batchRecords.map(rec =>
          fetch(OFFICIAL_APPS_SCRIPT_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rec)
          }).catch(err => console.warn("Error enviando registro individual a Apps Script:", err))
        );
        await Promise.all(postPromises);

        success = true;
      }

      if (success) {
        const todayStr = new Date().toLocaleDateString('es-CO');
        ids_citas.forEach(id => {
          saveLocalFeedback(id, {
            estado: estado,
            observacion: observacion,
            auditor: auditor,
            fecha_gestion: todayStr
          });

          const itm = currentDetalleData.find(d => String(d.id_cita) === String(id));
          if (itm) {
            itm.estado_fb = estado;
            itm.observacion_fb = observacion;
            itm.auditor_fb = auditor;
            itm.fecha_fb = todayStr;
          }
        });

        selectedCitasSet.clear();
        updateBulkActionButton();
        closeFeedbackModal();
        fetchDashboardData();
      }

    } else {
      // Modo auditoría individual
      const id_cita = selectedCita.id_cita;
      let success = false;
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_cita, estado, observacion, auditor, cedula_auditor })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) success = true;
        }
      } catch (e) {
        console.warn("Backend Python local no disponible. Enviando directo a Google Apps Script...", e);
      }

      if (!success) {
        const payload = {
          id_cita: id_cita,
          estado: estado,
          observacion: observacion,
          auditor: auditor,
          cedula_auditor: cedula_auditor,
          fecha_gestion: new Date().toLocaleString('es-CO'),
          ip_equipo: "Web App (GitHub Pages)",
          usuario_pc: "Usuario Web",
          nombre_equipo: "Navegador Web"
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
        saveLocalFeedback(id_cita, {
          estado: estado,
          observacion: observacion,
          auditor: auditor,
          fecha_gestion: todayStr
        });

        if (selectedCita) {
          selectedCita.estado_fb = estado;
          selectedCita.observacion_fb = observacion;
          selectedCita.auditor_fb = auditor;
          selectedCita.fecha_fb = todayStr;
        }
        selectedCitasSet.delete(String(id_cita));
        updateBulkActionButton();
        closeFeedbackModal();
        fetchDashboardData();
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

    const headers = [
      "Fecha", "Hora", "Sede", "Tipo Doc", "Identificación",
      "Paciente", "Programa", "Profesional", "Estado Gestión",
      "Observación Auditor", "Auditor"
    ];

    const rows = detalles.map(item => ({
      "Fecha": item.fecha || "",
      "Hora": item.hora || "",
      "Sede": item.sede || "",
      "Tipo Doc": item.doc || item.tipo_doc || "CC",
      "Identificación": item.identificacion || "",
      "Paciente": item.paciente || "",
      "Programa": item.programa || "",
      "Profesional": item.profesional || "",
      "Estado Gestión": item.estado_fb || item.estado || "Sin Auditar",
      "Observación Auditor": item.observacion_fb || item.observacion || "",
      "Auditor": item.auditor_fb || item.auditor || ""
    }));

    if (typeof XLSX !== "undefined") {
      const ws = XLSX.utils.json_to_sheet(rows, { header: headers });

      // Autoajustar ancho de columnas
      ws['!cols'] = headers.map(h => ({
        wch: Math.max(h.length + 3, ...rows.map(r => String(r[h] || '').length + 2))
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Citas Pendientes");

      XLSX.writeFile(wb, `Citas_Pendientes_AGENDAWEB_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } else {
      // Respaldo secundario a archivo CSV compatible con Excel (BOM UTF-8)
      let csvContent = "\uFEFF" + headers.join(";") + "\n";
      rows.forEach(r => {
        const line = headers.map(h => `"${String(r[h] || "").replace(/"/g, '""')}"`).join(";");
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
    inputInline.onkeydown = function(e) {
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

async function triggerManualSync() {
  const btn = document.getElementById("btnManualSync");
  if (!btn) return;

  const originalContent = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verificando BD...`;

  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    const data = await res.json();
    if (data.success) {
      if (data.updated) {
        alert(data.message);
      } else {
        alert(data.message + (data.max_fecha ? `\n\n(Último registro en BD: ${data.max_fecha})` : ''));
      }
      cachedDashboardByPeriodo = {};
      isUserSearching = false;
      const sDetalle = document.getElementById("searchDetalleCitas") || document.getElementById("searchDetalle");
      if (sDetalle) sDetalle.value = "";
      const bClear = document.getElementById("btnClearSearchDetalle");
      if (bClear) bClear.style.display = "none";
      await fetchDashboardData(true);
    } else {
      alert("Atención: " + (data.message || "No se pudo completar el chequeo en SQL Server."));
    }
  } catch (err) {
    console.error("Error en sincronización manual:", err);
    alert("Error de conexión al intentar verificar la base de datos.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalContent;
  }
}
