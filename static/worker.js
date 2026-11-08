// =========================================================================

// CIERRE DE HISTORIAS - WEB WORKER EN SEGUNDO PLANO (CÓMPUTO ASÍNCRONO)

// Procesa filtros, métricas de demoras y avances fuera del hilo principal

// =========================================================================



const SPANISH_MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];



let userCedulaMap = {};

let workerRawData = null;

let workerLocalFbStore = {};

let _fbLookupVersion = 1;



let currentQuickFilters = new Set();

let currentQuickFilter = "all";

let userHasCustomDateFilter = false;

let localFeedbackStore = {};

let rawDashboardData = null;



function toNomPropio(str) {

  if (!str) return "";

  return str.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

}



const _accentCache = new Map();

function removeAccents(str) {

  if (!str) return "";

  const s = String(str);

  const cached = _accentCache.get(s);

  if (cached !== undefined) return cached;

  let res;

  if (/^[\x00-\x7F]*$/.test(s)) {

    res = s.toLowerCase().trim();

  } else {

    res = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  }

  if (_accentCache.size < 60000) _accentCache.set(s, res);

  return res;

}



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



function parseIsoDate(str) {

  if (!str) return "";

  const s = String(str).trim();

  if (s.includes("/")) {

    const p = s.split("/");

    if (p.length === 3) {

      return `${p[2].padStart(4, '20')}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;

    }

  } else if (s.includes("-")) {

    const p = s.split("-");

    if (p.length === 3) {

      if (p[0].length === 4) return s;

      return `${p[2].padStart(4, '20')}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;

    }

  }

  return "";

}



function parseDateTime(dStr, hStr) {

  if (!dStr) return 0;

  const parts = dStr.split("/");

  let timeStr = hStr || "00:00:00";

  if (parts.length === 3) {

    return new Date(`${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}T${timeStr}`).getTime() || 0;

  }

  return new Date(`${dStr} ${timeStr}`).getTime() || 0;

}



const CANONICAL_CENCOS_MAP = {
  "apa": "Apartado",
  "apartado": "Apartado",
  "apartado comfa plaza": "Salud Plaza Apartado",
  "comfa plaza": "Salud Plaza Apartado",
  "plaza": "Salud Plaza Apartado",
  "salud plaza apartado": "Salud Plaza Apartado",
  "cis comfama salud plaza apartado": "Salud Plaza Apartado",
  "cent integ de salud comfa plaza apartado": "Salud Plaza Apartado",
  "apartado especializada": "Ips Especializada Apartado-Sede Alterna",
  "ips especializada apartado": "Ips Especializada Apartado-Sede Alterna",
  "ips especializada apartado-sede alterna": "Ips Especializada Apartado-Sede Alterna",
  "ips especializada comfama apartado - se": "Ips Especializada Apartado-Sede Alterna",
  "ips especializada comfama apartado-sede": "Ips Especializada Apartado-Sede Alterna",
  "cis - comfama apa": "Apartado",
  "centro integral de salud - comfama apa": "Apartado",
  "centro integral de salud - comfama  apa": "Apartado",
  "cis apartado": "Apartado",
  "centro integral de salud apartado": "Apartado",
  "city plaza envigado": "City Plaza",
  "city plaza": "City Plaza",
  "san ignacio - ciami": "CIAMI San Ignacio",
  "ciami san ignacio": "CIAMI San Ignacio",
  "ciami bello": "CIAMI Bello",
  "ciami caldas": "CIAMI Caldas",
  "caldas - ciami": "CIAMI Caldas",
  "ciami cordoba": "CIAMI Cordoba",
  "cordoba - ciami": "CIAMI Cordoba",
  "ciami itagui": "CIAMI Itagui",
  "ciami itagüi": "CIAMI Itagui",
  "ciami molinos": "CIAMI Molinos",
  "ciami rionegro": "CIAMI Rionegro",
  "rionegro - ciami": "CIAMI Rionegro",
  "capf comfama rionegro - ciami rionegro": "CIAMI Rionegro",
  "ciami sabaneta norte": "CIAMI Sabaneta Norte",
  "sabaneta norte - ciami": "CIAMI Sabaneta Norte",
  "ciami saman": "CIAMI Saman",
  "saman - ciami": "CIAMI Saman",
  "san antonio de prado - itag": "San Antonio De Prado",
  "san antonio de prado": "San Antonio De Prado",
  "santuario los farallones": "Santuario Farallones",
  "el santuario los farallones": "Santuario Farallones",
  "santuario farallones": "Santuario Farallones",
  "santuario": "Santuario",
  "monteria - ciami": "Monteria",
  "monteria": "Monteria",
  "montería": "Monteria",
  "comfama - monteria": "Monteria",
  "comfama monteria": "Monteria",
  "cis comfama monteria": "Monteria",
  "el porvenir - rionegro": "El Porvenir",
  "el porvenir": "El Porvenir",
  "santa maria - itagui": "Santa Maria Itagui",
  "santa maria itagui": "Santa Maria Itagui",
  "la estrella central": "La Estrella Central De Servicios Sur",
  "la estrella central de serv": "La Estrella Central De Servicios Sur",
  "cis la estrella central de servicios sur": "La Estrella Central De Servicios Sur",
  "la estrella central de servicios sur": "La Estrella Central De Servicios Sur",
  "la estrella": "La Estrella",
  "la estrella parque": "La Estrella",
  "itagui sede alterna": "Itagui",
  "cis comfama itagui sede alterna": "Itagui",
  "itagui": "Itagui",
  "sabaneta sur": "Sabaneta",
  "sabaneta": "Sabaneta",
  "sabaneta norte": "Sabaneta Norte",
  "carepa": "Carepa Operativo",
  "carepa operativo": "Carepa Operativo",
  "carepa centro": "Carepa Centro",
  "carepa sede centro": "Carepa Centro",
  "comfama carepa centro": "Carepa Centro",
  "chigorodo": "Chigorodo",
  "chigorodó": "Chigorodo",
  "chigorodo centro": "Chigorodo Centro",
  "cis chigorodo - ci": "Chigorodo",
  "cis chigorodo-cent": "Chigorodo Centro",
  "cis chigorodo cent": "Chigorodo Centro",
  "el retiro": "El Retiro",
  "retiro": "El Retiro",
  "el retiro los robles": "El Retiro Los Robles",
  "la union": "La Union",
  "la unión": "La Union",
  "la union vallejuelo": "La Union Vallejuelo",
  "la unión vallejuelo": "La Union Vallejuelo",
  "2161": "Especialistas Operativo",
  "especialistas": "Especialistas",
  "especialistas operativo": "Especialistas Operativo",
  "especialistas admon": "Especialistas Admon",
  "especialistas ops": "Especialistas Ops"
};

const _sedeCache = new Map();
function normalizeSedeName(name) {
  if (!name) return "";
  const s = String(name).trim();
  if (!s) return "";
  const cached = _sedeCache.get(s);
  if (cached !== undefined) return cached;

  const sNorm = removeAccents(s);
  if (CANONICAL_CENCOS_MAP[sNorm]) {
    const res = CANONICAL_CENCOS_MAP[sNorm];
    if (_sedeCache.size < 3000) _sedeCache.set(s, res);
    return res;
  }

  // Desprender prefijos comunes
  let stripped = sNorm;
  for (const prefix of ['cis comfama ', 'cis - comfama ', 'centro integral de salud ', 'cis ', 'comfama - ', 'comfama ']) {
    if (stripped.startsWith(prefix)) {
      stripped = stripped.substring(prefix.length).trim();
      break;
    }
  }
  if (CANONICAL_CENCOS_MAP[stripped]) {
    const res = CANONICAL_CENCOS_MAP[stripped];
    if (_sedeCache.size < 3000) _sedeCache.set(s, res);
    return res;
  }

  // Comprobación contra currentCisMappings personalizado si existe
  if (typeof currentCisMappings === 'object' && currentCisMappings) {
    for (const [canon, variants] of Object.entries(currentCisMappings)) {
      if (removeAccents(canon) === sNorm || removeAccents(canon) === stripped) {
        if (_sedeCache.size < 3000) _sedeCache.set(s, canon);
        return canon;
      }
      if (Array.isArray(variants)) {
        for (const v of variants) {
          const vNorm = removeAccents(String(v));
          if (vNorm === sNorm || vNorm === stripped) {
            if (_sedeCache.size < 3000) _sedeCache.set(s, canon);
            return canon;
          }
        }
      }
    }
  }

  if (_sedeCache.size < 3000) _sedeCache.set(s, s);
  return s;
}

var currentCisMappings = {};



function sanitizeProgramaName(name) {

  if (!name) return "";

  return String(name).trim().replace(/\s+/g, " ");

}



function isProgramaEspecialistas(prog) {

  if (!prog) return false;

  const p = removeAccents(String(prog));

  return p.includes("especialist") || p.includes("interconsulta") || p.includes("subespecial");

}



function isResolvedAuditState(estado, phc) {

  if (!estado && !phc) return false;

  const estLower = String(estado || "").toLowerCase();

  const phcLower = String(phc || "").toLowerCase();

  return (

    estLower.includes("finalizada") ||

    phcLower.includes("finalizada") ||

    estLower.includes("cerrada") ||

    phcLower.includes("cerrada") ||

    estLower.includes("inasistencia") ||

    phcLower.includes("inasistencia") ||

    estLower.includes("novedad") ||

    phcLower.includes("novedad") ||

    estLower.includes("error de dato") ||

    phcLower.includes("error de dato")

  );

}



function isConfirmedPendingAudit(it) {
  if (!it) return false;
  const stFb = String(it.estado_fb || "").trim();
  if (!stFb || stFb === "Sin Auditar" || stFb === "Sin Gestión") return false;
  return !isResolvedAuditState(stFb, it.estado_phc);
}



function getRecordIsoRange(r) {

  const y = String(r["Año"] || r["Ao"] || r["A\u00f1o"] || "2026").trim();

  const mesName = removeAccents(String(r["Nombre del mes"] || "").trim());

  const mesIdx = SPANISH_MONTH_NAMES.indexOf(mesName);

  if (mesIdx === -1) return null;

  const m = String(mesIdx + 1).padStart(2, '0');

  const quin = String(r["Quincena"] || "").toLowerCase();

  const lastDay = new Date(Number(y), mesIdx + 1, 0).getDate();



  if (quin.includes("1ra") || quin.includes("1")) {

    return { start: `${y}-${m}-01`, end: `${y}-${m}-15` };

  } else if (quin.includes("2da") || quin.includes("2")) {

    return { start: `${y}-${m}-16`, end: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };

  } else {

    return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };

  }

}



function getOrBuildApptLookup(data) {

  if (!data || !Array.isArray(data.detalle_pendientes)) return {};

  if (data._apptLookup) return data._apptLookup;

  const lookup = {};

  data.detalle_pendientes.forEach(item => {

    if (!item) return;

    if (item.id_cita) lookup[String(item.id_cita)] = item;

    if (item.id_cita_legacy) lookup[String(item.id_cita_legacy)] = item;

    if (item.orden_phc) lookup[String(item.orden_phc)] = item;

  });

  try {

    Object.defineProperty(data, "_apptLookup", { value: lookup, writable: true, configurable: true, enumerable: false });

  } catch (e) {

    data._apptLookup = lookup;

  }

  return lookup;

}



function parseAuditDate(dStr) {
  if (!dStr) return 0;
  if (dStr instanceof Date) return dStr.getTime();
  const s = String(dStr).trim();
  const t = Date.parse(s);
  if (!isNaN(t)) return t;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const y = parseInt(m[3], 10);
    const h = m[4] ? parseInt(m[4], 10) : 0;
    const mi = m[5] ? parseInt(m[5], 10) : 0;
    const sec = m[6] ? parseInt(m[6], 10) : 0;
    return new Date(y, mo, d, h, mi, sec).getTime();
  }
  return 0;
}

function getFeedbackForAppointment(item, fbStore) {

  if (!item || !fbStore) return null;

  const cid = String(item.id_cita || "").trim();

  if (cid && fbStore[cid]) return fbStore[cid];

  if (item.id_cita_legacy) {

    const leg = String(item.id_cita_legacy).trim();

    if (leg && fbStore[leg]) return fbStore[leg];

  }

  if (item.orden_phc) {

    const ord = String(item.orden_phc).trim();

    if (ord && fbStore[ord]) return fbStore[ord];

  }

  return null;

}



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



  // Filtrar rawMedicos evaluando todas las dimensiones en sincronía ultra-rápida O(1) con Sets

  const sedeSet = sedeFilterList.length > 0 ? new Set(sedeFilterList) : null;

  const progSet = progFilterList.length > 0 ? new Set(progFilterList) : null;

  const profSet = profFilterList.length > 0 ? new Set(profFilterList) : null;

  const anoSet = anoFilterList.length > 0 ? new Set(anoFilterList) : null;

  const mesSet = mesFilterList.length > 0 ? new Set(mesFilterList) : null;

  const has1Q = quinFilterList.some(q => q.includes("1") || q.includes("primera") || q.includes("1ra"));

  const has2Q = quinFilterList.some(q => q.includes("2") || q.includes("segunda") || q.includes("2da"));

  const hasExplicitMes = !userHasCustomDateFilter && mesSet !== null;



  const filteredMedicos = rawMedicos.filter(r => {

    // 1. Filtro Profesional (Nombre o Documento de Identificación)

    if (profSet) {

      const pNorm = r._profNorm !== undefined ? r._profNorm : removeAccents(String(r["NOMBRE PROFESIONAL"] || "").trim());

      const idDoc = r._idDoc !== undefined ? r._idDoc : String(r["id_medico"] || "").trim();

      if (!profSet.has(pNorm) && (!idDoc || !profSet.has(idDoc))) return false;

    }



    // 2. Filtro Sede

    if (sedeSet) {

      const isEsp = r._isEsp !== undefined ? r._isEsp : isProgramaEspecialistas(r["PROGRAMA"]);

      const effSede = r._effSedeNorm !== undefined ? r._effSedeNorm : removeAccents(isEsp ? "Especialistas" : normalizeSedeName(r["NOMBRE IPS"] || ""));

      const rawSede = r._rawSedeNorm !== undefined ? r._rawSedeNorm : removeAccents(normalizeSedeName(r["NOMBRE IPS"] || ""));

      const matchSede = (sedeSet.has("especialistas") && isEsp) || sedeSet.has(effSede) || sedeSet.has(rawSede);

      if (!matchSede) return false;

    }



    // 3. Filtro Programa

    if (progSet) {

      const pgNorm = r._progNorm !== undefined ? r._progNorm : removeAccents(String(r["PROGRAMA"] || "").trim());

      if (!progSet.has(pgNorm)) return false;

    }



    // 4. Filtro Año

    if (anoSet) {

      const aStr = r._anoStr !== undefined ? r._anoStr : String(r["Año"] || r["Ao"] || r["A\u00f1o"] || "").trim();

      if (!anoSet.has(aStr)) return false;

    }



    // 5. Filtro Mes

    if (mesSet) {

      const mNorm = r._mesNorm !== undefined ? r._mesNorm : removeAccents(String(r["Nombre del mes"] || "").trim().toLowerCase());

      if (!mesSet.has(mNorm)) return false;

    }



    // 6. Filtro Quincena

    if (quinFilterList.length > 0) {

      const is1Q = r._is1Q !== undefined ? r._is1Q : (String(r["Quincena"] || "").toLowerCase().includes("1"));

      const is2Q = r._is2Q !== undefined ? r._is2Q : (String(r["Quincena"] || "").toLowerCase().includes("2"));

      if (!((has1Q && is1Q) || (has2Q && is2Q))) return false;

    }



    // 7. Filtro Rango de Fechas (Desde / Hasta)

    if (!hasExplicitMes && (dateFrom || dateTo)) {

      const range = r._isoRange !== undefined ? r._isoRange : getRecordIsoRange(r);

      if (range) {

        if (dateFrom && range.end < dateFrom) return false;

        if (dateTo && range.start > dateTo) return false;

      }

    }



    // 8. Filtros Rápidos (Quick Filters)

    if (activeQFilters.size > 0) {

      const isEsp = r._isEsp !== undefined ? r._isEsp : isProgramaEspecialistas(r["PROGRAMA"]);

      if (activeQFilters.has('especialistas') && !activeQFilters.has('medicos_generales') && !isEsp) return false;

      if (activeQFilters.has('medicos_generales') && !activeQFilters.has('especialistas') && isEsp) return false;

      if (activeQFilters.has('sin_auditar') && !activeQFilters.has('auditadas') && Number(r.pendientes || 0) <= 0) return false;

      if (activeQFilters.has('auditadas') && !activeQFilters.has('sin_auditar') && Number(r.cerradas || 0) <= 0) return false;

    }



    return true;

  });



  // Regla de negocio: HISTÓRICO DE REGISTROS EN PROGRESO (POR MESES, SEDES, PROFESIONALES)

  // Visualiza en porcentaje el acumulado del TOTAL de historias que quedaron con estado específico

  // "En progreso" en SQL SIN tener en cuenta los estados de auditoría vs la cantidad de historias generadas

  // (excluyendo bloqueos, gestiones, inasistencias y estados que no corresponden a elaboración de historias).



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

    if (m.total < m.pendientes) {

      m.total = m.pendientes;

    }

    m.cerradas = Math.max(0, m.total - m.pendientes);

    const rawPct = m.total > 0 ? (Math.round((m.pendientes / m.total) * 1000) / 10) : 0;

    m.pct_demora = (m.pendientes > 0 && rawPct === 0) ? 0.1 : rawPct;

    m.pct_cerradas = m.total > 0 ? (Math.round((100.0 - m.pct_demora) * 10) / 10) : 100.0;

    return m;

  }).sort((a, b) => (b.pct_demora - a.pct_demora) || (b.pendientes - a.pendientes));



  // Agrupar Sedes dinámicamente desde filteredMedicos

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

    if (s.total < s.pendientes) {

      s.total = s.pendientes;

    }

    s.cerradas = Math.max(0, s.total - s.pendientes);

    const rawPct = s.total > 0 ? (Math.round((s.pendientes / s.total) * 1000) / 10) : 0;

    s.pct_demora = (s.pendientes > 0 && rawPct === 0) ? 0.1 : rawPct;

    s.pct_cerradas = s.total > 0 ? (Math.round((100.0 - s.pct_demora) * 10) / 10) : 100.0;

    return s;

  }).sort((a, b) => (b.pct_demora - a.pct_demora) || (b.pendientes - a.pendientes));



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



  const demoraMeses = Object.values(mesesMap).filter(m => m.total > 0 || m.pendientes > 0).map(m => {

    if (m.total < m.pendientes) {

      m.total = m.pendientes;

    }

    m.cerradas = Math.max(0, m.total - m.pendientes);

    m.pct_demora = m.total > 0 ? (Math.round((m.pendientes / m.total) * 1000) / 10) : 0;

    m.pct_cerradas = m.total > 0 ? (Math.round((100.0 - m.pct_demora) * 10) / 10) : 100.0;

    return m;

  }).sort((a, b) => a.order - b.order);



  const totAsig = filteredMedicos.reduce((acc, r) => acc + Number(r.total || 0), 0);

  const totPend = filteredMedicos.reduce((acc, r) => acc + Number(r.pendientes || 0), 0);

  const totCerr = Math.max(0, totAsig - totPend);

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

  const apptLookup = (rawDashboardData && rawDashboardData._apptLookup) ? rawDashboardData._apptLookup : getOrBuildApptLookup(rawDashboardData || { detalle_pendientes: allItemsUnfiltered });



  const activeQFilters = (typeof currentQuickFilters !== 'undefined' && currentQuickFilters && currentQuickFilters.size > 0)

    ? currentQuickFilters

    : (currentQuickFilter && currentQuickFilter !== 'all' ? new Set(currentQuickFilter.split(',').filter(Boolean)) : new Set());



  // Pre-procesar conjuntos de filtros activos en Sets O(1)

  const sedeFilterList = (Array.isArray(filters.sede) ? filters.sede : (filters.sede ? [filters.sede] : []))

    .map(s => removeAccents(normalizeSedeName(s)))

    .filter(s => s && s !== "todas" && s !== "todos");

  const sedeSet = sedeFilterList.length > 0 ? new Set(sedeFilterList) : null;



  const progFilterList = (Array.isArray(filters.programa) ? filters.programa : (filters.programa ? [filters.programa] : []))

    .map(p => removeAccents(p))

    .filter(p => p && p !== "todas" && p !== "todos");

  const progSet = progFilterList.length > 0 ? new Set(progFilterList) : null;



  const profFilterList = (Array.isArray(filters.profesional) ? filters.profesional : (filters.profesional ? [filters.profesional] : []))

    .map(p => removeAccents(String(p).trim()))

    .filter(p => p && p !== "todas" && p !== "todos");

  const profSet = profFilterList.length > 0 ? new Set(profFilterList) : null;



  const estadoPhcFilterList = (Array.isArray(filters.estado_phc) ? filters.estado_phc : (filters.estado_phc ? [filters.estado_phc] : []))

    .map(e => removeAccents(String(e).trim()))

    .filter(e => e && e !== "todas" && e !== "todos");

  const estadoPhcSet = estadoPhcFilterList.length > 0 ? new Set(estadoPhcFilterList) : null;



  const anoFilterList = (Array.isArray(filters.ano) ? filters.ano : (filters.ano ? [filters.ano] : []))

    .map(a => String(a).trim())

    .filter(a => a && a.toLowerCase() !== "todos");

  const anoSet = anoFilterList.length > 0 ? new Set(anoFilterList) : null;



  const mesFilterList = (Array.isArray(filters.mes) ? filters.mes : (filters.mes ? [filters.mes] : []))

    .map(m => removeAccents(String(m).trim().toLowerCase()))

    .filter(m => m && m !== "todas" && m !== "todos");

  const mesSet = mesFilterList.length > 0 ? new Set(mesFilterList) : null;



  const diaFilterList = (Array.isArray(filters.dia) ? filters.dia : (filters.dia ? [filters.dia] : []))

    .map(d => parseInt(d, 10))

    .filter(d => !isNaN(d));

  const diaSet = diaFilterList.length > 0 ? new Set(diaFilterList) : null;



  const quinFilterList = (Array.isArray(filters.quincena) ? filters.quincena : (filters.quincena ? [filters.quincena] : []))

    .map(q => removeAccents(String(q).trim().toLowerCase()))

    .filter(q => q && q !== "todas" && q !== "todos");

  const has1Q = quinFilterList.some(q => q.includes("1ra") || q.includes("primera") || q.includes("1"));

  const has2Q = quinFilterList.some(q => q.includes("2da") || q.includes("segunda") || q.includes("2"));



  const hasExplicitMes = !userHasCustomDateFilter && mesSet !== null;

  const hasDateRange = !hasExplicitMes && (filters.dateFrom || filters.dateTo);



  const monthsMap = {};

  const sedesMap = {};

  const auditedCidSet = new Set();



  // 1. Acumular Auditorías Realizadas (Auditadas / Gestionadas) con memoización O(1)

  const totalFb = allFb.length;

  for (let i = 0; i < totalFb; i++) {

    const fb = allFb[i];

    if (!fb || !fb.id_cita) continue;

    const cid = String(fb.id_cita);

    const aud = String(fb.auditor || "").trim();

    if (cid.startsWith("test_") || cid.startsWith("TEST_") || aud === "Test Runner" || aud.toLowerCase().includes("prueba")) {

      continue;

    }



    if (!fb._precomputed) {

      const appt = apptLookup[cid] || (fb.orden_phc && apptLookup[String(fb.orden_phc)]) || null;

      const prog = fb.programa || (appt ? appt.programa : "");

      const isEsp = isProgramaEspecialistas(prog);

      const sede = isEsp ? "Especialistas" : (fb.sede || (appt ? appt.sede : "Desconocida"));

      const prof = fb.nombre_profesional || (appt ? appt.profesional : "");

      const doc = fb.id_profesional || (appt ? (appt.cedula_profesional || appt.id_profesional) : "");

      const phc = fb.estado_phc || (appt ? appt.estado_phc : "") || "Confirmada";

      const fechaAtencion = fb.fecha_cita || (appt ? (appt.fecha || appt.fecha_cita) : "") || fb.fecha_gestion || "";

      const dp = parseDateParts(fechaAtencion);



      fb._isEsp = isEsp;

      fb._sedeNorm = removeAccents(normalizeSedeName(isEsp ? "Especialistas" : sede));

      fb._progNorm = removeAccents(sanitizeProgramaName(prog));

      fb._profNorm = removeAccents(String(prof || "").trim());

      fb._doc = String(doc || "").trim();

      fb._phcNorm = removeAccents(String(phc || "").trim());

      fb._isoDate = parseIsoDate(fechaAtencion);

      fb._dp = dp;

      fb._anoStr = dp ? String(dp.ano) : "";

      fb._mesNorm = dp ? removeAccents(String(dp.mesName || "").toLowerCase()) : "";

      fb._mesName = dp ? dp.mesName : "desconocido";

      fb._mesIdx = dp && dp.mesNum ? (dp.mesNum - 1) : 99;

      fb._dia = dp ? dp.dia : null;

      fb._is1Q = dp ? (dp.dia <= 15) : false;

      fb._sName = isEsp ? "Especialistas" : (normalizeSedeName(sede) || "Desconocida");

      fb._precomputed = true;

    }



    // Validación O(1) de filtros

    if (sedeSet && !((sedeSet.has("especialistas") && fb._isEsp) || sedeSet.has(fb._sedeNorm))) continue;

    if (activeQFilters.size > 0) {

      if (activeQFilters.has('especialistas') && !activeQFilters.has('medicos_generales') && !fb._isEsp) continue;

      if (activeQFilters.has('medicos_generales') && !activeQFilters.has('especialistas') && fb._isEsp) continue;

    }

    if (progSet && !progSet.has(fb._progNorm)) continue;

    if (profSet && !profSet.has(fb._profNorm) && (!fb._doc || !profSet.has(fb._doc))) continue;

    if (estadoPhcSet && !estadoPhcSet.has(fb._phcNorm)) continue;

    if (hasDateRange && fb._isoDate) {

      if (filters.dateFrom && fb._isoDate < filters.dateFrom) continue;

      if (filters.dateTo && fb._isoDate > filters.dateTo) continue;

    }

    if (anoSet && !anoSet.has(fb._anoStr)) continue;

    if (mesSet && !mesSet.has(fb._mesNorm)) continue;

    if (diaSet && (fb._dia === null || !diaSet.has(fb._dia))) continue;

    if (quinFilterList.length > 0 && !((has1Q && fb._is1Q) || (has2Q && !fb._is1Q))) continue;



    auditedCidSet.add(cid);

    if (fb.orden_phc) auditedCidSet.add(String(fb.orden_phc));

    const appt = apptLookup[cid] || (fb.orden_phc && apptLookup[String(fb.orden_phc)]) || null;

    if (appt && appt.id_cita) auditedCidSet.add(String(appt.id_cita));

    if (appt && appt.id_cita_legacy) auditedCidSet.add(String(appt.id_cita_legacy));

    if (appt && appt.orden_phc) auditedCidSet.add(String(appt.orden_phc));



    const sName = fb._sName;

    if (!sedesMap[sName]) {

      sedesMap[sName] = { "NOMBRE IPS": sName, sede: sName, gestionadas: 0, sin_auditar: 0, pendientes: 0, total: 0, pct_gestion: 0 };

    }

    sedesMap[sName].gestionadas++;



    const monthName = fb._mesName;

    const monthIdx = fb._mesIdx;

    if (!monthsMap[monthName]) {

      monthsMap[monthName] = { "Nombre del mes": monthName, gestionadas: 0, sin_auditar: 0, pendientes: 0, total: 0, order: monthIdx };

    }

    monthsMap[monthName].gestionadas++;

  }



  // 2. Acumular Historias Pendientes Sin Auditar evaluadas en O(1) con atributos precalculados

  if (Array.isArray(allItemsUnfiltered)) {

    const totalItems = allItemsUnfiltered.length;

    for (let i = 0; i < totalItems; i++) {

      const it = allItemsUnfiltered[i];

      if (!it) continue;

      const cid = String(it.id_cita || "");

      const legId = it.id_cita_legacy ? String(it.id_cita_legacy) : "";

      const ordId = it.orden_phc ? String(it.orden_phc) : "";

      if (auditedCidSet.has(cid) || (legId && auditedCidSet.has(legId)) || (ordId && auditedCidSet.has(ordId))) continue;



      const stFb = it.estado_fb || "";

      if (stFb && stFb !== "Sin Auditar" && stFb !== "Sin Gestión") continue;



      const isEsp = isProgramaEspecialistas(it.programa);

      if (sedeSet && !((sedeSet.has("especialistas") && (isEsp || it.sede === "Especialistas")) || sedeSet.has(it._sedeNorm))) continue;

      if (activeQFilters.size > 0) {

        if (activeQFilters.has('especialistas') && !activeQFilters.has('medicos_generales') && !isEsp) continue;

        if (activeQFilters.has('medicos_generales') && !activeQFilters.has('especialistas') && isEsp) continue;

      }

      if (progSet && !progSet.has(it._progNorm)) continue;

      const doc = it.cedula_profesional || it.id_profesional || "";

      if (profSet && !profSet.has(it._profNorm) && (!doc || !profSet.has(String(doc).trim()))) continue;

      if (estadoPhcSet && !estadoPhcSet.has(it._phcNorm)) continue;

      if (hasDateRange && it._isoDate) {

        if (filters.dateFrom && it._isoDate < filters.dateFrom) continue;

        if (filters.dateTo && it._isoDate > filters.dateTo) continue;

      }

      if (anoSet && !anoSet.has(it._anoStr)) continue;

      if (mesSet && !mesSet.has(it._mesNorm)) continue;

      if (diaSet && (it._dia === null || !diaSet.has(it._dia))) continue;

      if (quinFilterList.length > 0 && !((has1Q && it._is1Q) || (has2Q && !it._is1Q))) continue;



      const sName = isEsp ? "Especialistas" : (normalizeSedeName(it.sede) || "Desconocida");

      if (!sedesMap[sName]) {

        sedesMap[sName] = { "NOMBRE IPS": sName, sede: sName, gestionadas: 0, sin_auditar: 0, pendientes: 0, total: 0, pct_gestion: 0 };

      }

      sedesMap[sName].sin_auditar++;



      const monthName = it._mesName || "desconocido";

      const monthIdx = it._dp && it._dp.mesNum ? (it._dp.mesNum - 1) : 99;

      if (!monthsMap[monthName]) {

        monthsMap[monthName] = { "Nombre del mes": monthName, gestionadas: 0, sin_auditar: 0, pendientes: 0, total: 0, order: monthIdx };

      }

      monthsMap[monthName].sin_auditar++;

    }

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

  if (data._enrichedForFbVer !== _fbLookupVersion) {

    allItemsUnfiltered.forEach(item => {

      if (item.programa) {

        item.programa = sanitizeProgramaName(item.programa);

      }

      const lfb = getFeedbackForAppointment(item, localFeedbackStore);

      if (lfb) {

        item.estado_fb = lfb.estado;

        if (!isResolvedAuditState(lfb.estado, lfb.estado_phc)) {

          const auditedPhc = String(lfb.estado_phc || "").trim();

          if (auditedPhc.toLowerCase() === "en progreso" || String(lfb.estado || "").toLowerCase().includes("progreso")) {

            item.estado_phc = "En progreso";

          } else {

            item.estado_phc = "Pendiente";

          }

        } else if (lfb.estado_phc) {

          item.estado_phc = lfb.estado_phc;

        }

        if (lfb.nota_aclaratoria) item.nota_aclaratoria = lfb.nota_aclaratoria;

        if (lfb.observacion) item.observacion_fb = lfb.observacion;

        if (lfb.auditor) item.auditor_fb = lfb.auditor;

        if (lfb.fecha_gestion) item.fecha_fb = lfb.fecha_gestion;

        if (lfb.historial) item.historial = lfb.historial;

      } else if (isConfirmedPendingAudit(item)) {

        const fbStr = String(item.estado_fb || "").toLowerCase();

        const phcStr = String(item.estado_phc || "").toLowerCase();

        item.estado_phc = (fbStr.includes("progreso") || phcStr.includes("progreso")) ? "En progreso" : "Pendiente";

      }

      if (!item.estado_phc || item.estado_phc === "Sin Registro") {

        item.estado_phc = "Confirmada";

        item._phcNorm = "confirmada";

      } else {

        item._phcNorm = removeAccents(item.estado_phc);

      }

    });

    data._enrichedForFbVer = _fbLookupVersion;

    data._activePendingItems = allItemsUnfiltered.filter(item => !isResolvedAuditState(item.estado_fb, item.estado_phc));

  }



  // Excluir de los indicadores, gráficos y tablas de pendientes aquellas citas auditadas con notas de resolución/aclaración

  const activePendingItems = data._activePendingItems || allItemsUnfiltered.filter(item => !isResolvedAuditState(item.estado_fb, item.estado_phc));



  // --- MOTOR DE FILTRADO Y CONTEO POR FACETAS EN 1 SOLA PASADA O(N) ---

  const getFilterSet = (k) => {

    const v = filters[k];

    if (!v) return null;

    if (Array.isArray(v)) {

      if (v.length === 0) return null;

      if (k === 'sede') return new Set(v.map(x => removeAccents(normalizeSedeName(x))));

      return new Set(v.map(x => removeAccents(String(x))));

    }

    if (k === 'sede') return new Set([removeAccents(normalizeSedeName(v))]);

    return new Set([removeAccents(String(v))]);

  };



  const sedeSet = getFilterSet('sede');

  const profSet = getFilterSet('profesional');

  const progSet = getFilterSet('programa');

  const estadoPhcSet = getFilterSet('estado_phc');

  const anoSet = getFilterSet('ano');

  const mesSet = getFilterSet('mes');

  const diaSet = filters.dia && (Array.isArray(filters.dia) ? filters.dia.length > 0 : true)

    ? new Set((Array.isArray(filters.dia) ? filters.dia : [filters.dia]).map(Number))

    : null;

  const quinSet = getFilterSet('quincena');



  const activeQFilters = (typeof currentQuickFilters !== 'undefined' && currentQuickFilters && currentQuickFilters.size > 0)

    ? currentQuickFilters

    : (currentQuickFilter && currentQuickFilter !== 'all' ? new Set(currentQuickFilter.split(',').filter(Boolean)) : new Set());



  const hasQFilters = activeQFilters.size > 0;

  const qSinAuditar = hasQFilters && activeQFilters.has('sin_auditar');

  const qAuditadas = hasQFilters && activeQFilters.has('auditadas');

  const qEnProgreso = hasQFilters && activeQFilters.has('en_progreso');

  const qEspecialistas = hasQFilters && activeQFilters.has('especialistas');

  const qMedicosGenerales = hasQFilters && activeQFilters.has('medicos_generales');



  const hasExplicitMesFilter = !userHasCustomDateFilter && filters && Array.isArray(filters.mes) && filters.mes.length > 0;

  const hasDateRange = !hasExplicitMesFilter && filters && (filters.dateFrom || filters.dateTo);

  const filterDateFrom = filters && filters.dateFrom;

  const filterDateTo = filters && filters.dateTo;



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



  const items = [];

  const sedesMap = {};

  const medicosMap = {};

  const progsMap = {};

  const treeMap = {};

  let totalGest = 0;

  let totalProg = 0;



  const cedMap = (data && data.filter_options && data.filter_options.user_cedula_map) || userCedulaMap || {};



  const totalActive = activePendingItems.length;

  for (let i = 0; i < totalActive; i++) {

    const d = activePendingItems[i];

    if (d._sedeNorm === undefined) {

      d._sedeNorm = removeAccents(d.sede || "");

      d._profNorm = removeAccents(d.profesional || "");

      d._progNorm = removeAccents(d.programa || "");

      d._phcNorm = removeAccents((!d.estado_phc || d.estado_phc === "Sin Registro") ? "confirmada" : d.estado_phc);

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

        d._is1Q = false;

      }

      d._isoDate = parseIsoDate(d.fecha);

    }



    // Filtros de fecha y Quick Filters

    if (hasDateRange && d._isoDate) {

      if (filterDateFrom && d._isoDate < filterDateFrom) continue;

      if (filterDateTo && d._isoDate > filterDateTo) continue;

    }



    if (hasQFilters) {

      const isAud = d.estado_fb && d.estado_fb !== "Sin Auditar" && d.estado_fb !== "Sin Gestión";

      if (qSinAuditar && isAud) continue;

      if (qAuditadas && !isAud) continue;

      if (qEnProgreso) {

        const phcLower = d._phcNorm;

        if (!phcLower.includes("progreso") && !(d.estado_fb && d.estado_fb.toLowerCase().includes("progreso"))) continue;

      }

      const isEsp = isProgramaEspecialistas(d.programa);

      if (qEspecialistas && !isEsp) continue;

      if (qMedicosGenerales && isEsp) continue;

    }



    // Match booleano por faceta

    const mSede = !sedeSet || sedeSet.has(d._sedeNorm);

    const mProf = !profSet || profSet.has(d._profNorm);

    const mProg = !progSet || progSet.has(d._progNorm);

    const mPhc = !estadoPhcSet || estadoPhcSet.has(d._phcNorm);

    const mAno = !anoSet || (d._anoStr && anoSet.has(d._anoStr));

    const mMes = !mesSet || (d._mesNorm && mesSet.has(d._mesNorm));

    const mDia = !diaSet || (d._dia !== null && diaSet.has(d._dia));

    const mQuin = !quinSet || (quinSet.has("1ra quincena") && d._is1Q) || (quinSet.has("2da quincena") && !d._is1Q);



    // Conteo por faceta (match de todas las demas excepto la evaluada)

    if (mProf && mProg && mPhc && mAno && mMes && mDia && mQuin) {

      const s = isProgramaEspecialistas(d.programa) ? "Especialistas" : normalizeSedeName(d.sede);

      if (s) counts.sede[s] = (counts.sede[s] || 0) + 1;

    }

    if (mSede && mProf && mPhc && mAno && mMes && mDia && mQuin) {

      const p = d.programa;

      if (p) counts.programa[p] = (counts.programa[p] || 0) + 1;

    }

    if (mSede && mProg && mPhc && mAno && mMes && mDia && mQuin) {

      const pr = d.profesional;

      if (pr) counts.profesional[pr] = (counts.profesional[pr] || 0) + 1;

    }

    if (mSede && mProf && mProg && mAno && mMes && mDia && mQuin) {

      const st = (!d.estado_phc || d.estado_phc === "Sin Registro") ? "Confirmada" : d.estado_phc;

      counts.estado_phc[st] = (counts.estado_phc[st] || 0) + 1;

    }

    if (mSede && mProf && mProg && mPhc && mAno && mDia && mQuin) {

      const m = d._mesName;

      if (m) counts.mes[m] = (counts.mes[m] || 0) + 1;

    }

    if (mSede && mProf && mProg && mPhc && mAno && mMes && mQuin) {

      const dia = d._dia;

      if (dia !== null && dia !== undefined) counts.dia[dia] = (counts.dia[dia] || 0) + 1;

    }

    if (mSede && mProf && mProg && mPhc && mMes && mDia && mQuin) {

      const a = d._anoStr;

      if (a) counts.ano[a] = (counts.ano[a] || 0) + 1;

    }

    if (mSede && mProf && mProg && mPhc && mAno && mMes && mDia) {

      if (d._is1Q) counts.quincena["1ra Quincena"] = (counts.quincena["1ra Quincena"] || 0) + 1;

      else if (d._is1Q === false) counts.quincena["2da Quincena"] = (counts.quincena["2da Quincena"] || 0) + 1;

    }



    // SI CUMPLE LA TOTALIDAD DE LOS FILTROS SELECCIONADOS

    if (mSede && mProf && mProg && mPhc && mAno && mMes && mDia && mQuin) {

      items.push(d);



      const sName = isProgramaEspecialistas(d.programa) ? "Especialistas" : (normalizeSedeName(d.sede) || "Desconocida");

      const isProg = isConfirmedPendingAudit(d);

      if (!sedesMap[sName]) {

        sedesMap[sName] = { "NOMBRE IPS": sName, pendientes: 0, gestionadas: 0, en_progreso: 0, sin_auditar: 0, pct_gestion: 0 };

      }

      sedesMap[sName].pendientes += 1;

      if (isProg) {

        sedesMap[sName].gestionadas += 1;

        sedesMap[sName].en_progreso += 1;

        totalGest += 1;

        totalProg += 1;

      }



      const pName = d.profesional || "Desconocido";

      if (!medicosMap[pName]) {

        const docCedula = cedMap[pName] || cedMap[toNomPropio(pName)] || d.cedula_profesional || "";

        medicosMap[pName] = {

          "NOMBRE PROFESIONAL": pName,

          identificacion: docCedula,

          "NOMBRE IPS": sName,

          _sedesCount: {},

          pendientes: 0,

          pct_pendientes: 0

        };

      }

      medicosMap[pName].pendientes += 1;

      if (sName) {

        medicosMap[pName]._sedesCount[sName] = (medicosMap[pName]._sedesCount[sName] || 0) + 1;

      }



      const prg = d.programa || "Sin Programa";

      progsMap[prg] = (progsMap[prg] || 0) + 1;



      if (d._dp) {

        const monthName = d._mesName || "desconocido";

        const monthIdx = d._dp.mesNum - 1;

        if (!treeMap[monthName]) {

          treeMap[monthName] = { mes: monthName, total_pendientes: 0, gestionadas: 0, diasMap: {}, order: monthIdx };

        }

        treeMap[monthName].total_pendientes += 1;

        if (isProg) treeMap[monthName].gestionadas += 1;

        if (!treeMap[monthName].diasMap[d._dia]) {

          treeMap[monthName].diasMap[d._dia] = { fecha_fmt: d.fecha, dia_num: d._dia, pendientes: 0, gestionadas: 0 };

        }

        treeMap[monthName].diasMap[d._dia].pendientes += 1;

        if (isProg) treeMap[monthName].diasMap[d._dia].gestionadas += 1;

      }

    }

  }



  const dynamicFilterOptions = {

    sedes: Object.keys(counts.sede).sort(),

    programas: Object.keys(counts.programa).sort(),

    profesionales: Object.keys(counts.profesional).sort(),

    estados_phc: Object.keys(counts.estado_phc).sort(),

    meses: SPANISH_MONTH_NAMES.filter(m => counts.mes[m]),

    dias: Object.keys(counts.dia).map(Number).sort((a, b) => a - b),

    anos: Object.keys(counts.ano).map(Number).sort((a, b) => a - b),

    quincenas: ["1ra Quincena", "2da Quincena"],

    counts: counts,

    user_cedula_map: data.filter_options ? data.filter_options.user_cedula_map : {}

  };

  if (data.filter_options && data.filter_options.auditores) {

    dynamicFilterOptions.auditores = data.filter_options.auditores;

  }



  const totalPend = items.length;

  const totalSin = Math.max(0, totalPend - totalProg);

  const pctCob = totalPend > 0 ? (Math.round(totalProg / totalPend * 1000) / 10) : 0;



  const sedesSummary = Object.values(sedesMap).map(s => {

    s.sin_auditar = Math.max(0, s.pendientes - s.en_progreso);

    s.pct_gestion = s.pendientes > 0 ? (Math.round(s.en_progreso / s.pendientes * 1000) / 10) : 0;

    return s;

  }).sort((a, b) => b.pendientes - a.pendientes);



  const sedesChart = sedesSummary.map(s => ({ ...s, sede: s["NOMBRE IPS"] }));



  const medicosPending = Object.values(medicosMap).map(m => {

    const entries = Object.entries(m._sedesCount || {});

    if (entries.length > 0) {

      entries.sort((a, b) => b[1] - a[1]);

      m["NOMBRE IPS"] = entries[0][0];

    }

    delete m._sedesCount;

    return m;

  }).sort((a, b) => b.pendientes - a.pendientes);



  const programasChart = Object.entries(progsMap)

    .map(([PROGRAMA, count]) => ({ PROGRAMA, count }))

    .sort((a, b) => b.count - a.count);



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



// =========================================================================

// GESTOR DE MENSAJES DEL WEB WORKER

// =========================================================================

self.onmessage = function (e) {

  const msg = e.data;

  if (!msg) return;



  
// --- ÍNDICES INVERTIDOS EN MEMORIA PARA BÚSQUEDA Y FILTRADO O(1) / O(K) ---
let _invertedIndexes = null;

function buildInvertedIndexes(items) {
  const idxSede = new Map();
  const idxProf = new Map();
  const idxProg = new Map();
  const idxPhc = new Map();
  const idxMes = new Map();
  const idxAno = new Map();

  const len = items ? items.length : 0;
  for (let i = 0; i < len; i++) {
    const d = items[i];
    if (!d) continue;

    if (d._sedeNorm === undefined) {
      d._sedeNorm = removeAccents(normalizeSedeName(d.sede || ""));
      d._profNorm = removeAccents(d.profesional || "");
      d._progNorm = removeAccents(d.programa || "");
      d._phcNorm = removeAccents((!d.estado_phc || d.estado_phc === "Sin Registro") ? "confirmada" : d.estado_phc);
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
        d._is1Q = false;
      }
      d._isoDate = parseIsoDate(d.fecha);
    }

    if (d._sedeNorm) {
      let s = idxSede.get(d._sedeNorm);
      if (!s) { s = new Set(); idxSede.set(d._sedeNorm, s); }
      s.add(i);
    }
    if (d._profNorm) {
      let s = idxProf.get(d._profNorm);
      if (!s) { s = new Set(); idxProf.set(d._profNorm, s); }
      s.add(i);
    }
    if (d._progNorm) {
      let s = idxProg.get(d._progNorm);
      if (!s) { s = new Set(); idxProg.set(d._progNorm, s); }
      s.add(i);
    }
    if (d._phcNorm) {
      let s = idxPhc.get(d._phcNorm);
      if (!s) { s = new Set(); idxPhc.set(d._phcNorm, s); }
      s.add(i);
    }
    if (d._mesNorm) {
      let s = idxMes.get(d._mesNorm);
      if (!s) { s = new Set(); idxMes.set(d._mesNorm, s); }
      s.add(i);
    }
    if (d._anoStr) {
      let s = idxAno.get(d._anoStr);
      if (!s) { s = new Set(); idxAno.set(d._anoStr, s); }
      s.add(i);
    }
  }

  return { idxSede, idxProf, idxProg, idxPhc, idxMes, idxAno };
}

  switch (msg.type) {

    case "SET_RAW_DATA":

      workerRawData = msg.rawData;

      if (msg.localFbStore) {

        workerLocalFbStore = msg.localFbStore;

        localFeedbackStore = msg.localFbStore;

      }

      if (workerRawData && workerRawData.filter_options && workerRawData.filter_options.user_cedula_map) {

        userCedulaMap = workerRawData.filter_options.user_cedula_map;

      }

      if (workerRawData && Array.isArray(workerRawData.detalle_pendientes)) {
        _invertedIndexes = buildInvertedIndexes(workerRawData.detalle_pendientes);
      }
      self.postMessage({ type: "RAW_DATA_SET" });

      break;



    case "UPDATE_FEEDBACK":

      if (msg.localFbStore) {

        workerLocalFbStore = msg.localFbStore;

        localFeedbackStore = msg.localFbStore;

        _fbLookupVersion++;

        if (workerRawData) { workerRawData._enrichedForFbVer = -1; workerRawData._activePendingItems = null; }

      }

      break;



    case "APPLY_FILTERS":

      if (!workerRawData) {

        self.postMessage({ type: "ERROR", reqId: msg.reqId, error: "No hay rawData cargada en el worker" });

        return;

      }

      try {

        const filters = msg.filters || {};

        const qFiltersArr = msg.quickFilters || [];

        const activeQSet = new Set(qFiltersArr);

        const userHasCustom = !!msg.userHasCustomDateFilter;



        currentQuickFilters = activeQSet;

        currentQuickFilter = qFiltersArr.join(",");

        userHasCustomDateFilter = userHasCustom;

        localFeedbackStore = workerLocalFbStore;

        rawDashboardData = workerRawData;



        const result = applyClientFiltersToData(workerRawData, filters);

        self.postMessage({

          type: "FILTERS_APPLIED",

          reqId: msg.reqId,

          data: result

        });

      } catch (err) {

        self.postMessage({

          type: "ERROR",

          reqId: msg.reqId,

          error: String(err && err.message ? err.message : err)

        });

      }

      break;

  }

};



self.postMessage({ type: "READY" });

