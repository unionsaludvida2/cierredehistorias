/**
 * CÓDIGO GOOGLE APPS SCRIPT CON ALMACENAMIENTO DE DASHBOARD EN GOOGLE DRIVE Y ENCABEZADOS DE 9 COLUMNAS (AGENDAWEB)
 * 
 * Hoja de Cálculo en Google Drive:
 * https://docs.google.com/spreadsheets/d/1Wra6flqax-5z2tW_RrsuzvcuPm281LYJtgtF9CUBHg8/edit?usp=sharing
 */

// Función auxiliar para solicitar y otorgar permisos de Google Drive al ejecutar por primera vez
var SPREADSHEET_ID = "1Wra6flqax-5z2tW_RrsuzvcuPm281LYJtgtF9CUBHg8";

// Función auxiliar para solicitar y otorgar permisos de Google Drive al ejecutar por primera vez
function setupPermissions() {
  var files = DriveApp.getFilesByName("test.txt");
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log("Permisos autorizados correctamente para DriveApp y SpreadsheetApp.");
}

function doPost(e) {

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    }
    var data = JSON.parse(e.postData.contents);



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

    // MODO 5: Registro Masivo de Gestión (Batch)
    if (data.action === "save_batch_feedback") {
      var records = data.records || [];
      var sheetName = "Gestion_Retroalimentacion";
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      }
      var headers = [
        "ID Cita", 
        "Estado PHC",
        "Nota Aclaratoria", 
        "Observaciones Auditor", 
        "Auditor / Usuario", 
        "Cédula Auditor", 
        "Fecha Gestión", 
        "IP Equipo", 
        "Usuario PC", 
        "Nombre Máquina PC"
      ];
      sheet.getRange(1, 1, 1, 10).setValues([headers]);
      sheet.getRange(1, 1, 1, 10).setBackground("#0ea5e9").setFontColor("#ffffff").setFontWeight("bold");

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
        var rFec = rec.fecha_gestion || new Date().toLocaleString();
        var rIp = rec.ip_equipo || "";
        var rUsr = rec.usuario_pc || "";
        var rHost = rec.nombre_equipo || "";

        if (idRowMap[idC]) {
          var targetRow = idRowMap[idC];
          sheet.getRange(targetRow, 2, 1, 9).setValues([[rEstadoPHC, rEstado, rObs, rAud, rCed, rFec, rIp, rUsr, rHost]]);
        } else {
          rowsToAppend.push([idC, rEstadoPHC, rEstado, rObs, rAud, rCed, rFec, rIp, rUsr, rHost]);
        }
      }

      if (rowsToAppend.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, 10).setValues(rowsToAppend);
      }

      return ContentService.createTextOutput(JSON.stringify({ "result": "success", "count": records.length }))
        .setMimeType(ContentService.MimeType.JSON);
    }


    // MODO 3: Registro de Gestión con Garantía de 10 Encabezados en Fila 1
    var sheetName = "Gestion_Retroalimentacion";
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    var headers = [
      "ID Cita", 
      "Estado PHC",
      "Nota Aclaratoria", 
      "Observaciones Auditor", 
      "Auditor / Usuario", 
      "Cédula Auditor", 
      "Fecha Gestión", 
      "IP Equipo", 
      "Usuario PC", 
      "Nombre Máquina PC"
    ];
    sheet.getRange(1, 1, 1, 10).setValues([headers]);
    sheet.getRange(1, 1, 1, 10).setBackground("#0ea5e9").setFontColor("#ffffff").setFontWeight("bold");

    var idCita = data.id_cita;
    var estadoPHC = data.estado_phc || "";
    if (estadoPHC === "Atendido en IPSA / Finalizada") {
      estadoPHC = "Finalizada";
    }
    var estado = data.nota_aclaratoria || data.estado || "";
    var observacion = data.observacion || "";
    var auditor = data.auditor || "Usuario Web";
    var cedulaAuditor = data.cedula_auditor || "";
    var fechaGestion = data.fecha_gestion || new Date().toLocaleString();
    var ipEquipo = data.ip_equipo || "";
    var usuarioPc = data.usuario_pc || "";
    var nombreEquipo = data.nombre_equipo || "";

    if (!idCita) {
      return ContentService.createTextOutput(JSON.stringify({ "result": "ignored", "message": "No ID Cita provided" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var finder = sheet.createTextFinder(String(idCita)).matchEntireCell(true);
    var result = finder.findNext();

    if (result) {
      var row = result.getRow();
      sheet.getRange(row, 2).setValue(estadoPHC);
      sheet.getRange(row, 3).setValue(estado);
      sheet.getRange(row, 4).setValue(observacion);
      sheet.getRange(row, 5).setValue(auditor);
      sheet.getRange(row, 6).setValue(cedulaAuditor);
      sheet.getRange(row, 7).setValue(fechaGestion);
      sheet.getRange(row, 8).setValue(ipEquipo);
      sheet.getRange(row, 9).setValue(usuarioPc);
      sheet.getRange(row, 10).setValue(nombreEquipo);
    } else {
      sheet.appendRow([
        idCita, 
        estadoPHC,
        estado, 
        observacion, 
        auditor, 
        cedulaAuditor, 
        fechaGestion, 
        ipEquipo, 
        usuarioPc, 
        nombreEquipo
      ]);
    }

    return ContentService.createTextOutput(JSON.stringify({ "result": "success", "id_cita": idCita }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "result": "error", "message": error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "";
  if (action === "get_dashboard_cache" || action === "get_dashboard") {
    var periodo = (e && e.parameter && e.parameter.periodo) ? e.parameter.periodo : "ultimo_mes";
    return handleGetDashboardCache(periodo);
  }
  if (action === "get_all_feedback") {
    var SPREADSHEET_ID = "1Wra6flqax-5z2tW_RrsuzvcuPm281LYJtgtF9CUBHg8";
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
    return handleGetAllFeedback(ss);
  }
  return ContentService.createTextOutput(JSON.stringify({ 
    "status": "Servicio Google Sheets AGENDAWEB Activo",
    "hoja_activa": "Gestion_Retroalimentacion"
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
    var colCount = sheet.getLastColumn();
    var headerRow = sheet.getRange(1, 1, 1, Math.max(colCount, 9)).getValues()[0];
    var isNewFormat = (headerRow[1] && String(headerRow[1]).toLowerCase().indexOf("phc") !== -1);
    
    var values = sheet.getRange(2, 1, lastRow - 1, isNewFormat ? 10 : 9).getValues();
    var records = [];
    values.forEach(function(row) {
      if (row[0]) {
        if (isNewFormat) {
          records.push({
            "id_cita": String(row[0]),
            "estado_phc": String(row[1] || ""),
            "estado": String(row[2] || ""),
            "nota_aclaratoria": String(row[2] || ""),
            "observacion": String(row[3] || ""),
            "auditor": String(row[4] || ""),
            "cedula_auditor": String(row[5] || ""),
            "fecha_gestion": String(row[6] || ""),
            "ip_equipo": String(row[7] || ""),
            "usuario_pc": String(row[8] || ""),
            "nombre_equipo": String(row[9] || ""),
            "synced": true
          });
        } else {
          records.push({
            "id_cita": String(row[0]),
            "estado": String(row[1] || ""),
            "nota_aclaratoria": String(row[1] || ""),
            "observacion": String(row[2] || ""),
            "auditor": String(row[3] || ""),
            "cedula_auditor": String(row[4] || ""),
            "fecha_gestion": String(row[5] || ""),
            "ip_equipo": String(row[6] || ""),
            "usuario_pc": String(row[7] || ""),
            "nombre_equipo": String(row[8] || ""),
            "synced": true
          });
        }
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

