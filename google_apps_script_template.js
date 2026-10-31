/**
 * CÓDIGO GOOGLE APPS SCRIPT CON ALMACENAMIENTO DE DASHBOARD EN GOOGLE DRIVE,
 * ENCABEZADOS DE 16 COLUMNAS Y CONVERSIÓN DE FECHAS A TIPOS NATIVOS DATE / DATETIME (AGENDAWEB)
 * 
 * Hoja de Cálculo en Google Drive:
 * https://docs.google.com/spreadsheets/d/1Wra6flqax-5z2tW_RrsuzvcuPm281LYJtgtF9CUBHg8/edit?usp=sharing
 */

var SPREADSHEET_ID = "1Wra6flqax-5z2tW_RrsuzvcuPm281LYJtgtF9CUBHg8";

var HEADERS = [
  "ID Cita", 
  "Estado PHC",
  "Nota Aclaratoria", 
  "Observaciones Auditor", 
  "Auditor / Usuario", 
  "Cédula Auditor", 
  "Fecha Gestión", 
  "IP Equipo", 
  "Usuario PC", 
  "Nombre Máquina PC",
  "Sede",
  "Fecha de cita",
  "Hora de cita",
  "Programa",
  "ID Profesional",
  "Nombre de Profesional"
];

// Función auxiliar para solicitar y otorgar permisos de Google Drive al ejecutar por primera vez
function setupPermissions() {
  var files = DriveApp.getFilesByName("test.txt");
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log("Permisos autorizados correctamente para DriveApp y SpreadsheetApp.");
}

/**
 * Convierte cualquier texto o valor a objeto Date nativo local (DateTime)
 * sin desfase horario por UTC.
 */
function parseDateTime(val) {
  if (!val) return "";
  if (val instanceof Date) return val;
  var str = String(val).trim();
  if (!str) return "";

  // 1. Formato latino: D/M/YYYY o DD/MM/YYYY [HH:mm[:ss] [a. m./p. m./am/pm]]
  var mLat = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?)?/i);
  if (mLat) {
    var day = parseInt(mLat[1], 10);
    var month = parseInt(mLat[2], 10) - 1;
    var year = parseInt(mLat[3], 10);
    var hour = mLat[4] ? parseInt(mLat[4], 10) : 0;
    var min = mLat[5] ? parseInt(mLat[5], 10) : 0;
    var sec = mLat[6] ? parseInt(mLat[6], 10) : 0;
    var ampm = mLat[7] ? mLat[7].toLowerCase().replace(/[\s\.]/g, '') : '';
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    return new Date(year, month, day, hour, min, sec);
  }

  // 2. Formato ISO / SQL: YYYY-MM-DD [HH:mm[:ss]]
  var mIso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (mIso) {
    var y = parseInt(mIso[1], 10);
    var mo = parseInt(mIso[2], 10) - 1;
    var d = parseInt(mIso[3], 10);
    var h = mIso[4] ? parseInt(mIso[4], 10) : 0;
    var mi = mIso[5] ? parseInt(mIso[5], 10) : 0;
    var s = mIso[6] ? parseInt(mIso[6], 10) : 0;
    return new Date(y, mo, d, h, mi, s);
  }

  var dParsed = new Date(str);
  if (!isNaN(dParsed.getTime())) {
    return dParsed;
  }
  return str;
}

/**
 * Convierte cualquier texto o valor a objeto Date nativo local (solo fecha Date)
 * sin desfase horario por UTC.
 */
function parseDateOnly(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return new Date(val.getFullYear(), val.getMonth(), val.getDate());
  }
  var str = String(val).trim();
  if (!str) return "";

  // YYYY-MM-DD
  var mIso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (mIso) {
    return new Date(parseInt(mIso[1], 10), parseInt(mIso[2], 10) - 1, parseInt(mIso[3], 10));
  }
  // DD/MM/YYYY
  var mLat = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mLat) {
    return new Date(parseInt(mLat[3], 10), parseInt(mLat[2], 10) - 1, parseInt(mLat[1], 10));
  }
  var dParsed = new Date(str);
  if (!isNaN(dParsed.getTime())) {
    return new Date(dParsed.getFullYear(), dParsed.getMonth(), dParsed.getDate());
  }
  return str;
}

/**
 * Normaliza programas de CYD individuales y grupales unificándolos
 */
function cleanProgramaGAS(val) {
  if (!val) return "Consulta Medicina General";
  var s = String(val).trim();
  if (/grupal.*cyd|cyd.*grupal/i.test(s) || (/grupal/i.test(s) && /(?:meses|a[ñn]os)/i.test(s))) {
    return "Control Grupal CYD";
  }
  if (/cyd.*individual|individual.*cyd/i.test(s) || (/cyd/i.test(s) && /(?:meses|a[ñn]os)/i.test(s)) || /control\s+(?:de\s+)?cyd\s+individual/i.test(s)) {
    return "Control de CYD Individual";
  }
  if (/anticoagulaci[oó]n|anticoagulado/i.test(s) || s === "50937") {
    return "Programa de Anticoagulación";
  }
  if (/ingreso\s+(?:de\s+)?(?:cyd|crecimiento\s+y\s+desarrollo)/i.test(s) || s === "70001") {
    return "Ingreso CYD";
  }
  if (/morbilidad\s+materna\s+extrema/i.test(s) || s === "8903050") {
    return "Seguimiento Morbilidad Materna Extrema";
  }
  if (s === "501102") {
    return "Consulta Médico General";
  }
  return s;
}

/**
 * Da formato consistente a fechas al devolver JSON para clientes web
 */
function formatDateForJson(val, pattern) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || "America/Bogota", pattern);
  }
  return String(val);
}

/**
 * Función que convierte directamente las columnas:
 * - Columna G (7): "Fecha Gestión" a tipo DateTime nativo con formato "yyyy-mm-dd hh:mm:ss"
 * - Columna L (12): "Fecha de cita" a tipo Date nativo con formato "yyyy-mm-dd"
 * 
 * Tras ejecutar esta función, el menú de filtros de Google Sheets mostrará:
 * "Ordenar de más antiguo a más reciente" y "Ordenar de más reciente a más antiguo"
 */
function corregirFormatosFechas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Gestion_Retroalimentacion");
  if (!sheet) {
    throw new Error("No se encontró la hoja Gestion_Retroalimentacion");
  }

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log("Hoja vacía o sin datos.");
    return { "result": "success", "rows": 0 };
  }

  var totalRows = lastRow - 1;

  // 1. CORREGIR "Fecha Gestión" (Columna G, Col 7)
  var rangeGestion = sheet.getRange(2, 7, totalRows, 1);
  var valsGestion = rangeGestion.getValues();
  var parsedGestion = [];
  for (var i = 0; i < valsGestion.length; i++) {
    var rawG = valsGestion[i][0];
    parsedGestion.push([parseDateTime(rawG)]);
  }
  rangeGestion.setValues(parsedGestion);
  rangeGestion.setNumberFormat("yyyy-mm-dd hh:mm:ss");

  // 2. CORREGIR "Fecha de cita" (Columna L, Col 12) si existe
  var lastCol = sheet.getLastColumn();
  if (lastCol >= 12) {
    var rangeCita = sheet.getRange(2, 12, totalRows, 1);
    var valsCita = rangeCita.getValues();
    var parsedCita = [];
    for (var j = 0; j < valsCita.length; j++) {
      var rawC = valsCita[j][0];
      parsedCita.push([parseDateOnly(rawC)]);
    }
    rangeCita.setValues(parsedCita);
    rangeCita.setNumberFormat("yyyy-mm-dd");
  }

  Logger.log("Formatos de fecha corregidos exitosamente en " + totalRows + " filas.");
  return { "result": "success", "rows": totalRows };
}

/**
 * Función de migración en 1 clic:
 * Agrega los 6 nuevos encabezados y convierte "Fecha Gestión" y "Fecha de cita" a tipos reales Date/DateTime
 */
function migrarColumnasGestionRetroalimentacion() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Gestion_Retroalimentacion");
  if (!sheet) {
    sheet = ss.insertSheet("Gestion_Retroalimentacion");
  }

  // 1. Establecer los 16 encabezados con el formato oficial
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.getRange(1, 1, 1, HEADERS.length).setBackground("#0ea5e9").setFontColor("#ffffff").setFontWeight("bold");

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log("Hoja vacía o sin registros de datos previos.");
    return { "result": "success", "migrated": 0 };
  }

  // 2. Obtener archivo de datos de migración precargado en Google Drive
  var files = DriveApp.getFilesByName("AGENDAWEB_cache_migration_data.json");
  if (!files.hasNext()) {
    Logger.log("Aviso: No se encontró AGENDAWEB_cache_migration_data.json en Drive.");
    return { "result": "error", "message": "No se encontró archivo de migración en Google Drive" };
  }
  var mapping = JSON.parse(files.next().getBlob().getDataAsString());

  // 3. Leer IDs de citas existentes (Columna A)
  var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var newColsData = [];
  var updatedCount = 0;

  for (var i = 0; i < idValues.length; i++) {
    var cid = String(idValues[i][0]).trim();
    var meta = mapping[cid];
    if (meta && meta.length >= 6) {
      newColsData.push([
        meta[0] || "",               // Sede
        parseDateOnly(meta[1]),      // Fecha de cita (como Date nativo)
        meta[2] || "",               // Hora de cita
        meta[3] || "",               // Programa
        meta[4] || "",               // ID Profesional
        meta[5] || ""                // Nombre de Profesional
      ]);
      updatedCount++;
    } else {
      newColsData.push(["", "", "", "", "", ""]);
    }
  }

  // 4. Actualizar masivamente las columnas 11 a 16 (K a P) en una sola operación sin tocar A a J
  if (newColsData.length > 0) {
    sheet.getRange(2, 11, newColsData.length, 6).setValues(newColsData);
  }

  // 5. Aplicar formato real de fechas en columnas G (Fecha Gestión) y L (Fecha de cita)
  corregirFormatosFechas();

  Logger.log("Migración completada exitosamente. Registros actualizados: " + updatedCount + " / " + idValues.length);
  return { "result": "success", "total": idValues.length, "updated": updatedCount };
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // Bloqueo exclusivo de hasta 30s para evitar sobreescritura concurrente
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
    var data = JSON.parse(e.postData.contents);

    // MODO CORRECCIÓN DE FORMATOS DE FECHA
    if (data.action === "fix_date_formats") {
      var fixRes = corregirFormatosFechas();
      return ContentService.createTextOutput(JSON.stringify(fixRes)).setMimeType(ContentService.MimeType.JSON);
    }

    // MODO MIGRACIÓN REMOTA
    if (data.action === "migrate_columns") {
      var migRes = migrarColumnasGestionRetroalimentacion();
      return ContentService.createTextOutput(JSON.stringify(migRes)).setMimeType(ContentService.MimeType.JSON);
    }

    // MODO 0: Guardar Caché Completo de Dashboard en Google Drive
    if (data.action === "save_dashboard_cache") {
      var periodo = data.periodo || "ultimo_mes";
      var jsonStr = typeof data.json_data === "string" ? data.json_data : JSON.stringify(data.json_data);
      var fileName = "AGENDAWEB_cache_" + periodo + ".json";
      
      var files = DriveApp.getFilesByName(fileName);
      var file;
      if (files.hasNext()) {
        file = files.next();
        file.setContent(jsonStr);
      } else {
        file = DriveApp.createFile(fileName, jsonStr, MimeType.PLAIN_TEXT);
      }
      return ContentService.createTextOutput(JSON.stringify({
        "result": "success",
        "message": "Caché de dashboard " + periodo + " actualizado con éxito en Google Drive.",
        "file_id": file.getId()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // MODO 1: Limpieza Opcional de Hojas Redundantes
    if (data.action === "clean_redundant_sheets") {
      var sheetsToEliminate = ["Resumen_Sedes", "Historias_Pendientes", "Usuarios_Activos"];
      sheetsToEliminate.forEach(function(sName) {
        var sh = ss.getSheetByName(sName);
        if (sh && ss.getSheets().length > 1) {
          ss.deleteSheet(sh);
        }
      });
      return ContentService.createTextOutput(JSON.stringify({
        "result": "success", 
        "message": "Hojas redundantes eliminadas con éxito. Queda únicamente Gestion_Retroalimentacion." 
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // MODO 2: Obtener Caché de Dashboard (vía POST)
    if (data.action === "get_dashboard_cache") {
      return handleGetDashboardCache(data.periodo || "ultimo_mes");
    }

    // MODO 4: Obtener Registros de Gestión de Retroalimentación
    if (data.action === "get_all_feedback") {
      return handleGetAllFeedback(ss);
    }

    // MODO 5: Registro Masivo de Gestión (Batch con 16 columnas y fechas nativas)
    if (data.action === "save_batch_feedback") {
      var records = data.records || [];
      var sheetName = "Gestion_Retroalimentacion";
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      }
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sheet.getRange(1, 1, 1, HEADERS.length).setBackground("#0ea5e9").setFontColor("#ffffff").setFontWeight("bold");

      var lastRow = sheet.getLastRow();
      var idRowMap = {};
      if (lastRow > 1) {
        var existingIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < existingIds.length; i++) {
          var eId = String(existingIds[i][0]).trim();
          if (eId) {
            idRowMap[eId] = i + 2;
          }
        }
      }

      var rowsToAppend = [];
      for (var r = 0; r < records.length; r++) {
        var rec = records[r];
        var idC = String(rec.id_cita || "").trim();
        if (!idC) continue;
        var rEstadoPHC = rec.estado_phc || "";
        if (rEstadoPHC === "Atendido en IPSA / Finalizada") {
          rEstadoPHC = "Finalizada";
        }
        var rEstado = rec.nota_aclaratoria || rec.estado || "";
        var rObs = rec.observacion || "";
        var rAud = rec.auditor || "Usuario Web";
        var rCed = rec.cedula_auditor || "";
        var rFec = parseDateTime(rec.fecha_gestion || new Date());
        var rIp = rec.ip_equipo || "";
        var rUsr = rec.usuario_pc || "";
        var rHost = rec.nombre_equipo || "";
        var rSede = rec.sede || "";
        var rFechaCita = parseDateOnly(rec.fecha_cita);
        var rHoraCita = rec.hora_cita || "";
        var rPrograma = cleanProgramaGAS(rec.programa || "");
        var rIdProf = rec.id_profesional || "";
        var rNomProf = rec.nombre_profesional || "";

        var rowValues = [
          rEstadoPHC, rEstado, rObs, rAud, rCed, rFec, rIp, rUsr, rHost,
          rSede, rFechaCita, rHoraCita, rPrograma, rIdProf, rNomProf
        ];

        if (idRowMap[idC]) {
          var targetRow = idRowMap[idC];
          sheet.getRange(targetRow, 2, 1, 15).setValues([rowValues]);
          sheet.getRange(targetRow, 7).setNumberFormat("yyyy-mm-dd hh:mm:ss");
          sheet.getRange(targetRow, 12).setNumberFormat("yyyy-mm-dd");
        } else {
          rowsToAppend.push([idC].concat(rowValues));
        }
      }

      if (rowsToAppend.length > 0) {
        var startAppend = sheet.getLastRow() + 1;
        sheet.getRange(startAppend, 1, rowsToAppend.length, 16).setValues(rowsToAppend);
        sheet.getRange(startAppend, 7, rowsToAppend.length, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
        sheet.getRange(startAppend, 12, rowsToAppend.length, 1).setNumberFormat("yyyy-mm-dd");
      }

      return ContentService.createTextOutput(JSON.stringify({ "result": "success", "count": records.length }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // MODO 3: Registro Individual con 16 Columnas y fechas nativas
    var sheetName = "Gestion_Retroalimentacion";
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setBackground("#0ea5e9").setFontColor("#ffffff").setFontWeight("bold");

    var idCita = data.id_cita;
    var estadoPHC = data.estado_phc || "";
    if (estadoPHC === "Atendido en IPSA / Finalizada") {
      estadoPHC = "Finalizada";
    }
    var estado = data.nota_aclaratoria || data.estado || "";
    var observacion = data.observacion || "";
    var auditor = data.auditor || "Usuario Web";
    var cedulaAuditor = data.cedula_auditor || "";
    var fechaGestion = parseDateTime(data.fecha_gestion || new Date());
    var ipEquipo = data.ip_equipo || "";
    var usuarioPc = data.usuario_pc || "";
    var nombreEquipo = data.nombre_equipo || "";
    var sede = data.sede || "";
    var fechaCita = parseDateOnly(data.fecha_cita);
    var horaCita = data.hora_cita || "";
    var programa = cleanProgramaGAS(data.programa || "");
    var idProfesional = data.id_profesional || "";
    var nombreProfesional = data.nombre_profesional || "";

    if (!idCita) {
      return ContentService.createTextOutput(JSON.stringify({ "result": "ignored", "message": "No ID Cita provided" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var rowVals = [
      estadoPHC, estado, observacion, auditor, cedulaAuditor, fechaGestion, ipEquipo, usuarioPc, nombreEquipo,
      sede, fechaCita, horaCita, programa, idProfesional, nombreProfesional
    ];

    var finder = sheet.createTextFinder(String(idCita)).matchEntireCell(true);
    var result = finder.findNext();

    if (result) {
      var row = result.getRow();
      sheet.getRange(row, 2, 1, 15).setValues([rowVals]);
      sheet.getRange(row, 7).setNumberFormat("yyyy-mm-dd hh:mm:ss");
      sheet.getRange(row, 12).setNumberFormat("yyyy-mm-dd");
    } else {
      var newRow = sheet.getLastRow() + 1;
      sheet.getRange(newRow, 1, 1, 16).setValues([[idCita].concat(rowVals)]);
      sheet.getRange(newRow, 7).setNumberFormat("yyyy-mm-dd hh:mm:ss");
      sheet.getRange(newRow, 12).setNumberFormat("yyyy-mm-dd");
    }

    return ContentService.createTextOutput(JSON.stringify({ "result": "success", "id_cita": idCita }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "result": "error", "message": error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    try {
      lock.releaseLock();
    } catch (eLock) { }
  }
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "";
  if (action === "get_dashboard_cache" || action === "get_dashboard") {
    var periodo = (e && e.parameter && e.parameter.periodo) ? e.parameter.periodo : "ultimo_mes";
    return handleGetDashboardCache(periodo);
  }
  if (action === "get_all_feedback") {
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
    return handleGetAllFeedback(ss);
  }
  if (action === "fix_date_formats") {
    var fixRes = corregirFormatosFechas();
    return ContentService.createTextOutput(JSON.stringify(fixRes)).setMimeType(ContentService.MimeType.JSON);
  }
  if (action === "migrate_columns") {
    var migRes = migrarColumnasGestionRetroalimentacion();
    return ContentService.createTextOutput(JSON.stringify(migRes)).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({ 
    "status": "Servicio Google Sheets AGENDAWEB Activo (16 Columnas - Fechas Nativas)",
    "hoja_activa": "Gestion_Retroalimentacion",
    "columnas": HEADERS
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleGetAllFeedback(ss) {
  try {
    var sheetName = "Gestion_Retroalimentacion";
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ "result": "success", "records": [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ "result": "success", "records": [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var colCount = Math.max(sheet.getLastColumn(), 16);
    var values = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
    var records = [];

    values.forEach(function(row) {
      if (row[0]) {
        records.push({
          "id_cita": String(row[0]),
          "estado_phc": String(row[1] || ""),
          "estado": String(row[2] || ""),
          "nota_aclaratoria": String(row[2] || ""),
          "observacion": String(row[3] || ""),
          "auditor": String(row[4] || ""),
          "cedula_auditor": String(row[5] || ""),
          "fecha_gestion": formatDateForJson(row[6], "yyyy-MM-dd HH:mm:ss"),
          "ip_equipo": String(row[7] || ""),
          "usuario_pc": String(row[8] || ""),
          "nombre_equipo": String(row[9] || ""),
          "sede": String(row[10] || ""),
          "fecha_cita": formatDateForJson(row[11], "yyyy-MM-dd"),
          "hora_cita": formatDateForJson(row[12], "HH:mm:ss"),
          "programa": cleanProgramaGAS(row[13] || ""),
          "id_profesional": String(row[14] || ""),
          "nombre_profesional": String(row[15] || ""),
          "synced": true
        });
      }
    });

    return ContentService.createTextOutput(JSON.stringify({ "result": "success", "records": records }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ "result": "error", "message": err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleGetDashboardCache(periodo) {
  var fileName = "AGENDAWEB_cache_" + (periodo || "ultimo_mes") + ".json";
  var files = DriveApp.getFilesByName(fileName);
  if (files.hasNext()) {
    var content = files.next().getBlob().getDataAsString();
    return ContentService.createTextOutput(content).setMimeType(ContentService.MimeType.JSON);
  } else {
    return ContentService.createTextOutput(JSON.stringify({
      "result": "error",
      "message": "Caché de dashboard " + periodo + " no encontrado en Google Drive."
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
