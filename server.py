import socket
import getpass
import http.server
import socketserver
import json
import urllib.parse
import os
import sys
import io
import traceback
import threading
import pickle
import re
from datetime import datetime
import pandas as pd
from openpyxl import Workbook
from openpyxl.utils import get_column_letter
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

from etl_processor import ETLProcessor
from google_sheets import (
    load_feedback, save_feedback_record, save_feedback_records_batch, load_config, save_config, sync_all_with_google_sheets, fetch_feedback_from_google_sheets, fetch_feedback_from_google_sheets_async,
    load_db_config, save_db_config, mask_db_config, test_db_connection, test_github_connection, push_file_to_github, push_multiple_files_to_github,
    ensure_fresh_static_api_jsons
)

MONTHS_EN = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
}

def parse_gestion_datetime(s):
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    m_js = re.match(r'^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})', s)
    if m_js:
        mon_str, day_str, yr_str, h_str, min_str, sec_str = m_js.groups()
        mon = MONTHS_EN.get(mon_str.lower(), 1)
        return datetime(int(yr_str), mon, int(day_str), int(h_str), int(min_str), int(sec_str))

    m_es = re.match(r'^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?)?', s, re.IGNORECASE)
    if m_es:
        day, mon, yr, hr, minu, sec, ampm = m_es.groups()
        h = int(hr) if hr else 0
        mi = int(minu) if minu else 0
        se = int(sec) if sec else 0
        if ampm:
            ampm_clean = ampm.lower().replace(' ', '').replace('.', '')
            if ampm_clean == 'pm' and h < 12:
                h += 12
            elif ampm_clean == 'am' and h == 12:
                h = 0
        return datetime(int(yr), int(mon), int(day), h, mi, se)

    try:
        return datetime.fromisoformat(s[:19])
    except Exception:
        pass
    return None

def format_local_datetime(dt):
    if not dt:
        return "N/A"
    h12 = dt.hour % 12
    if h12 == 0:
        h12 = 12
    ampm = "p.m." if dt.hour >= 12 else "a.m."
    return f"{dt.day:02d}/{dt.month:02d}/{dt.year} {h12:02d}:{dt.minute:02d} {ampm}"


PORT = 8585
processor = ETLProcessor()


class ReusableTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

class DashboardRequestHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            if path == "/" or path == "/index.html":
                if os.path.exists("index.html"):
                    return self.serve_static_file("index.html", "text/html")
                return self.serve_static_file("static/index.html", "text/html")
            elif path.startswith("/static/"):
                rel_path = path.lstrip("/")
                mime = "text/html"
                if path.endswith(".css"):
                    mime = "text/css"
                elif path.endswith(".js"):
                    mime = "application/javascript"
                elif path.endswith(".json"):
                    mime = "application/json"
                elif path.lower().endswith(".png"):
                    mime = "image/png"
                return self.serve_static_file(rel_path, mime)
            elif path.startswith("/api/dashboard_") and path.endswith(".json"):
                fname = os.path.basename(path)
                static_file = os.path.join("static", "api", fname)
                if os.path.exists(static_file):
                    return self.serve_static_file(static_file, "application/json")
            elif path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            elif path == "/api/feedback":
                fb = load_feedback()
                cfg = load_config()
                return self.send_json({"feedback": fb, "config": cfg})
            elif path == "/api/config":
                return self.send_json({
                    "config": load_config(),
                    "db_config": mask_db_config(load_db_config())
                })
            elif path == "/api/sync_feedback":
                fb = fetch_feedback_from_google_sheets()
                try:
                    processor.refresh_cached_summaries()
                except Exception as ex_ref:
                    print(f"[Cache Refresh on Feedback Sync Error]: {ex_ref}")
                return self.send_json({
                    "success": True,
                    "count": len(fb),
                    "message": f"Sincronizados exitosamente {len(fb)} registros desde Google Sheets."
                })
            elif path == "/api/productivity":
                fb = load_feedback()
                auditors_map = {}
                gestiones_hoy_global = 0
                today_date = datetime.now().date()

                for cid, r in fb.items():
                    aud_name = (r.get("auditor") or "").strip() or "Sin Auditor Registrado"
                    # Excluir registros de prueba de la productividad
                    if cid.startswith("test_") or cid.startswith("TEST_") or aud_name == "Test Runner" or "prueba" in aud_name.lower():
                        continue

                    fg = (r.get("fecha_gestion") or "").strip()
                    fg_dt = parse_gestion_datetime(fg) if fg else None
                    if fg_dt and fg_dt.date() == today_date:
                        gestiones_hoy_global += 1

                    if aud_name not in auditors_map:
                        auditors_map[aud_name] = {
                            "auditor": aud_name,
                            "total": 0,
                            "finalizadas": 0,
                            "en_progreso": 0,
                            "novedades": 0,
                            "estados_count": {},
                            "ultima_actividad": "",
                            "_last_dt": None
                        }
                    rec = auditors_map[aud_name]
                    rec["total"] += 1

                    st_raw = (r.get("estado_phc") or r.get("estado") or "Finalizada").strip()
                    rec["estados_count"][st_raw] = rec["estados_count"].get(st_raw, 0) + 1

                    st = st_raw.lower()
                    if "finalizada" in st or "cerrada" in st or "atendido" in st:
                        rec["finalizadas"] += 1
                    elif "progreso" in st:
                        rec["en_progreso"] += 1
                    else:
                        rec["novedades"] += 1

                    if fg_dt and (not rec["_last_dt"] or fg_dt > rec["_last_dt"]):
                        rec["_last_dt"] = fg_dt
                        rec["ultima_actividad"] = format_local_datetime(fg_dt)
                    elif fg and not rec["ultima_actividad"]:
                        rec["ultima_actividad"] = format_local_datetime(parse_gestion_datetime(fg))

                aud_list = []
                for a_name, a_data in auditors_map.items():
                    predominante = "Finalizada"
                    if a_data["estados_count"]:
                        predominante = max(a_data["estados_count"].items(), key=lambda x: x[1])[0]
                    a_data["estado_predominante"] = predominante
                    a_data.pop("estados_count", None)
                    a_data.pop("_last_dt", None)
                    aud_list.append(a_data)

                aud_list = sorted(aud_list, key=lambda x: x["total"], reverse=True)
                total_gestiones_global = sum(a["total"] for a in aud_list)
                active_count = len([a for a in aud_list if a["auditor"] != "Sin Auditor Registrado"])

                return self.send_json({
                    "summary": {
                        "total_gestiones": total_gestiones_global,
                        "auditores_activos": active_count,
                        "gestiones_hoy": gestiones_hoy_global
                    },
                    "auditors": aud_list
                })
            else:
                self.send_error(404, "Endpoint no encontrado")
        except Exception as e:
            traceback.print_exc()
            self.send_json({"error": str(e)}, status=500)

    def do_POST(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            
            content_len = int(self.headers.get('Content-Length', '0'))
            body_bytes = self.rfile.read(content_len) if content_len > 0 else b""
            
            try:
                body = json.loads(body_bytes.decode('utf-8')) if body_bytes else {}
            except Exception:
                body = {}

            if path == "/api/dashboard":
                filters = body.get("filters", {})
                p_key = filters.get("periodo", "ultimo_mes") if filters else "ultimo_mes"

                fetch_feedback_from_google_sheets_async()

                has_extra_filters = bool(filters and any(filters.get(k) for k in ["ano", "mes", "dia", "quincena", "sede", "programa", "profesional", "estado_phc"]))

                # Priorizar entrega del JSON real precalculado de static/api/ solo si no hay filtros adicionales
                static_file = os.path.join("static", "api", f"dashboard_{p_key}.json")
                if not has_extra_filters and os.path.exists(static_file):
                    with open(static_file, "rb") as f:
                        json_bytes = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(json_bytes)))
                    self.end_headers()
                    self.wfile.write(json_bytes)
                    return

                df, data_source = processor.fetch_data()
                fb_dict = load_feedback()
                summary = processor.get_summary(df, filters=filters, feedback_dict=fb_dict)
                summary["data_source"] = data_source
                return self.send_json(summary)

            elif path == "/api/feedback":
                id_cita = body.get("id_cita")
                estado_phc = body.get("estado_phc", "")
                if estado_phc == "Atendido en IPSA / Finalizada":
                    estado_phc = "Finalizada"
                nota_aclaratoria = body.get("nota_aclaratoria", "")
                estado = nota_aclaratoria or body.get("estado") or estado_phc or "Pendiente Cierre"
                observacion = body.get("observacion", "")
                auditor = body.get("auditor", "Usuario Web")
                cedula_auditor = body.get("cedula_auditor", "")

                client_ip = self.client_address[0] if hasattr(self, 'client_address') and self.client_address else "127.0.0.1"
                try:
                    os_user = getpass.getuser()
                except Exception:
                    os_user = os.environ.get("USERNAME", "Desconocido")
                try:
                    host_name = socket.gethostname()
                except Exception:
                    host_name = "PC-Local"

                if ids_citas and isinstance(ids_citas, list):
                    records = save_feedback_records_batch(
                        ids_citas=ids_citas,
                        estado=estado,
                        observacion=observacion,
                        auditor=auditor,
                        cedula_auditor=cedula_auditor,
                        client_ip=client_ip,
                        os_user=os_user,
                        host_name=host_name,
                        estado_phc=estado_phc,
                        nota_aclaratoria=nota_aclaratoria
                    )
                    try:
                        processor.refresh_cached_summaries()
                    except Exception as ex:
                        print(f"[ETL Cache Refresh Error]: {ex}")
                    return self.send_json({"success": True, "count": len(records), "records": records})
                elif id_cita:
                    rec = save_feedback_record(
                        id_cita=id_cita,
                        estado=estado,
                        observacion=observacion,
                        auditor=auditor,
                        cedula_auditor=cedula_auditor,
                        client_ip=client_ip,
                        os_user=os_user,
                        host_name=host_name,
                        estado_phc=estado_phc,
                        nota_aclaratoria=nota_aclaratoria
                    )
                    try:
                        processor.refresh_cached_summaries()
                    except Exception as ex:
                        print(f"[ETL Cache Refresh Error]: {ex}")
                    return self.send_json({"success": True, "record": rec})
                else:
                    return self.send_json({"error": "Falta id_cita o ids_citas"}, status=400)



            elif path == "/api/sync_feedback":
                fb = fetch_feedback_from_google_sheets()
                try:
                    processor.refresh_cached_summaries()
                except Exception as ex_ref:
                    print(f"[Cache Refresh on Feedback Sync Error]: {ex_ref}")
                return self.send_json({
                    "success": True,
                    "count": len(fb),
                    "message": f"Sincronizados exitosamente {len(fb)} registros desde Google Sheets."
                })

            elif path == "/api/sync":
                force = bool(body.get("force", False))
                res = processor.manual_check_and_sync(force=force)
                if res.get("updated"):
                    try:
                        from google_sheets import ensure_fresh_static_api_jsons
                        ensure_fresh_static_api_jsons(processor)
                    except Exception as ex_sync:
                        print(f"[Static API Gen Error]: {ex_sync}")
                return self.send_json(res)


            elif path == "/api/config":
                db_cfg = body.get("db_config")
                if db_cfg and isinstance(db_cfg, dict):
                    save_db_config(db_cfg)

                cfg = body.get("config")
                if cfg and isinstance(cfg, dict):
                    url = cfg.get("google_sheets_url") or cfg.get("google_sheets_apps_script_url", "")
                    if url:
                        cfg["google_sheets_url"] = url
                    save_config(cfg)
                else:
                    cfg = load_config()

                # Si se solicita auto-push a GitHub de config.json
                gh_res = None
                if body.get("auto_push_github"):
                    gh_res = push_file_to_github("config.json", commit_msg="Auto-update config.json desde panel de configuración")

                return self.send_json({
                    "success": True,
                    "config": load_config(),
                    "db_config": mask_db_config(load_db_config()),
                    "github_result": gh_res
                })

            elif path == "/api/config/test_db":
                params = body.get("database") or body
                res = test_db_connection(params)
                return self.send_json(res)

            elif path == "/api/config/test_github":
                repo = body.get("repo")
                token = body.get("token")
                res = test_github_connection(repo, token)
                return self.send_json(res)

            elif path == "/api/config/push_github":
                files = body.get("files") or ["config.json", "static/app.js"]
                commit_msg = body.get("commit_message") or "Actualización de configuración y reglas desde panel local"
                res = push_multiple_files_to_github(files, commit_msg=commit_msg)
                return self.send_json(res)

            elif path == "/api/config/push_github_cache":
                files = body.get("files") or [
                    "static/api/dashboard_ultimo_mes.json",
                    "static/api/dashboard_fechas_previas.json",
                    "static/api/dashboard_ambos.json",
                    "static/api/dashboard.json"
                ]
                refresh_local = body.get("refresh_local", True)
                commit_msg = body.get("commit_message") or "Actualización quincenal de datos de caché (static/api)"

                if refresh_local:
                    try:
                        print("[Config Push Cache] Asegurando archivos JSON locales al día...")
                        ensure_fresh_static_api_jsons(processor)
                    except Exception as ex_fresh:
                        print(f"[Config Push Cache Freshness Warning]: {ex_fresh}")

                res = push_multiple_files_to_github(files, commit_msg=commit_msg)
                return self.send_json(res)

            elif path == "/api/config/apply_etl":
                def _run_reprocess():
                    try:
                        print("[Config Apply] Re-procesando caché local y sincronizando con Google Drive...")
                        if os.path.exists("sql_cache.pkl"):
                            from etl_processor import clean_ips, apply_fn_limpieza, get_text_cleaning_rules
                            from google_sheets import load_config
                            cfg = load_config(force_reload=True)
                            mappings = cfg.get("cis_mappings", {})
                            rules = get_text_cleaning_rules()
                            with open("sql_cache.pkl", "rb") as f_in:
                                pack = pickle.load(f_in)
                            if isinstance(pack, dict) and "pendientes" in pack:
                                pack["pendientes"]["NOMBRE IPS"] = pack["pendientes"]["NOMBRE IPS"].apply(lambda s: clean_ips(s, mappings=mappings))
                                if "NOMBRE PROFESIONAL" in pack["pendientes"].columns:
                                    pack["pendientes"]["NOMBRE PROFESIONAL"] = pack["pendientes"]["NOMBRE PROFESIONAL"].apply(lambda p: apply_fn_limpieza(p, rules=rules)).str.title()
                                if "NOMBRE PACIENTE" in pack["pendientes"].columns:
                                    pack["pendientes"]["NOMBRE PACIENTE"] = pack["pendientes"]["NOMBRE PACIENTE"].apply(lambda p: apply_fn_limpieza(p, rules=rules)).str.title()
                                pack["sedes_full"]["NOMBRE IPS"] = pack["sedes_full"]["NOMBRE IPS"].apply(lambda s: clean_ips(s, mappings=mappings))
                                pack["sedes_full"] = pack["sedes_full"].groupby(['NOMBRE IPS', 'Año', 'Nombre del mes', 'Día', 'Quincena'], as_index=False).agg({
                                    'total': 'sum', 'asistidas': 'sum', 'inasistidas': 'sum', 'pendientes': 'sum'
                                })
                                pack["medicos_full"]["NOMBRE IPS"] = pack["medicos_full"]["NOMBRE IPS"].apply(lambda s: clean_ips(s, mappings=mappings))
                                if "NOMBRE PROFESIONAL" in pack["medicos_full"].columns:
                                    pack["medicos_full"]["NOMBRE PROFESIONAL"] = pack["medicos_full"]["NOMBRE PROFESIONAL"].apply(lambda p: apply_fn_limpieza(p, rules=rules)).str.title()
                                pack["medicos_full"] = pack["medicos_full"].groupby(['NOMBRE IPS', 'NOMBRE PROFESIONAL', 'PROGRAMA', 'Año', 'Nombre del mes', 'Día', 'Quincena'], as_index=False).agg({
                                    'total': 'sum', 'asistidas': 'sum', 'inasistidas': 'sum', 'pendientes': 'sum'
                                })
                                with open("sql_cache.pkl", "wb") as f_out:
                                    pickle.dump(pack, f_out)
                                processor.cached_pack = pack
                        processor.refresh_cached_summaries(force_compute=True)
                        ensure_fresh_static_api_jsons(processor)
                        print("[Config Apply] Proceso completado exitosamente.")
                    except Exception as ex_p:
                        print(f"[Config Apply Error]: {ex_p}")
                threading.Thread(target=_run_reprocess, daemon=True).start()
                return self.send_json({"success": True, "message": "Re-procesamiento de datos y actualización de caché local completados con éxito."})

            elif path == "/api/export":
                filters = body.get("filters", {})
                df, _ = processor.fetch_data()
                fb_dict = load_feedback()
                summary = processor.get_summary(df, filters=filters, feedback_dict=fb_dict)
                detalles = summary.get("detalle_pendientes", [])
                sedes = summary.get("sedes_summary", [])
                medicos = summary.get("medicos_pending", [])

                wb = Workbook()

                header_fill = PatternFill(start_color="0EA5E9", end_color="0EA5E9", fill_type="solid")
                header_font = Font(name="Arial", size=11, bold=True, color="FFFFFF")
                title_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
                title_font = Font(name="Arial", size=13, bold=True, color="FFFFFF")
                thin_border = Border(left=Side(style='thin', color='CBD5E1'), right=Side(style='thin', color='CBD5E1'),
                                     top=Side(style='thin', color='CBD5E1'), bottom=Side(style='thin', color='CBD5E1'))

                # --- HOJA 1: RESUMEN SEDES ---
                ws_sedes = wb.active
                ws_sedes.title = "Resumen Sedes"
                ws_sedes.merge_cells("A1:E1")
                cell_s1 = ws_sedes["A1"]
                cell_s1.value = "UNIÓN PARA LA SALUD Y LA VIDA S.A.S - RESUMEN DE PENDIENTES POR SEDE"
                cell_s1.font = title_font
                cell_s1.fill = title_fill
                cell_s1.alignment = Alignment(horizontal="center", vertical="center")
                ws_sedes.row_dimensions[1].height = 32

                headers_sedes = ["Sede / CIS", "Total Pendientes", "En Progreso", "Sin Auditar", "% Cobertura Gestión"]
                ws_sedes.append([])
                ws_sedes.append(headers_sedes)
                for col in range(1, 6):
                    c = ws_sedes.cell(row=3, column=col)
                    c.fill = header_fill
                    c.font = header_font
                    c.alignment = Alignment(horizontal="center", vertical="center")
                    c.border = thin_border
                ws_sedes.row_dimensions[3].height = 24

                for r_idx, s in enumerate(sedes, start=4):
                    sin_aud = s.get("sin_auditar", max(0, s.get("pendientes", 0) - s.get("gestionadas", 0)))
                    pct_g = f"{s.get('pct_gestion', 0)}%"
                    ws_sedes.append([
                        s.get("NOMBRE IPS", ""),
                        s.get("pendientes", 0),
                        s.get("en_progreso", 0),
                        sin_aud,
                        pct_g
                    ])
                    for c_idx in range(1, 6):
                        cell = ws_sedes.cell(row=r_idx, column=c_idx)
                        cell.font = Font(name="Arial", size=10)
                        cell.border = thin_border

                for col_idx, col in enumerate(ws_sedes.columns, start=1):
                    max_len = max((len(str(cell.value or '')) for cell in col if getattr(cell, 'value', None) is not None), default=10)
                    col_letter = get_column_letter(col_idx)
                    ws_sedes.column_dimensions[col_letter].width = max(max_len + 3, 14)

                # --- HOJA 2: POR PROFESIONAL ---
                ws_medicos = wb.create_sheet(title="Por Profesional")
                ws_medicos.merge_cells("A1:D1")
                cell_m1 = ws_medicos["A1"]
                cell_m1.value = "UNIÓN PARA LA SALUD Y LA VIDA S.A.S - HISTORIAS PENDIENTES POR PROFESIONAL"
                cell_m1.font = title_font
                cell_m1.fill = title_fill
                cell_m1.alignment = Alignment(horizontal="center", vertical="center")
                ws_medicos.row_dimensions[1].height = 32

                headers_medicos = ["Profesional", "Identificación", "Sede Asignada", "Citas Pendientes"]
                ws_medicos.append([])
                ws_medicos.append(headers_medicos)
                for col in range(1, 5):
                    c = ws_medicos.cell(row=3, column=col)
                    c.fill = header_fill
                    c.font = header_font
                    c.alignment = Alignment(horizontal="center", vertical="center")
                    c.border = thin_border
                ws_medicos.row_dimensions[3].height = 24

                for r_idx, m in enumerate(medicos, start=4):
                    ws_medicos.append([
                        m.get("NOMBRE PROFESIONAL", ""),
                        str(m.get("identificacion", "")),
                        m.get("NOMBRE IPS", ""),
                        m.get("pendientes", 0)
                    ])
                    for c_idx in range(1, 5):
                        cell = ws_medicos.cell(row=r_idx, column=c_idx)
                        cell.font = Font(name="Arial", size=10)
                        cell.border = thin_border

                for col_idx, col in enumerate(ws_medicos.columns, start=1):
                    max_len = max((len(str(cell.value or '')) for cell in col if getattr(cell, 'value', None) is not None), default=10)
                    col_letter = get_column_letter(col_idx)
                    ws_medicos.column_dimensions[col_letter].width = max(max_len + 3, 14)

                # --- HOJA 3: DETALLE CITAS ---
                ws = wb.create_sheet(title="Detalle Citas")
                ws.merge_cells("A1:M1")
                cell = ws["A1"]
                cell.value = "UNIÓN PARA LA SALUD Y LA VIDA S.A.S - CITAS CONFIRMADAS SIN REPORTE DE ATENCIÓN"
                cell.font = title_font
                cell.fill = title_fill
                cell.alignment = Alignment(horizontal="center", vertical="center")
                ws.row_dimensions[1].height = 35

                headers = ["Fecha", "Hora", "Antigüedad (Mora)", "Sede", "Tipo Doc", "Identificación", "Paciente", "Programa", "Profesional", "Estado PHC", "Nota Aclaratoria", "Observación Auditor", "Auditor"]
                ws.append([])
                ws.append(headers)

                for col in range(1, 14):
                    c = ws.cell(row=3, column=col)
                    c.fill = header_fill
                    c.font = header_font
                    c.alignment = Alignment(horizontal="center", vertical="center")
                    c.border = thin_border
                ws.row_dimensions[3].height = 25

                from datetime import datetime
                now_dt = datetime.now()

                for r_idx, item in enumerate(detalles, start=4):
                    f_str = item.get("fecha") or ""
                    mora_lbl = ""
                    try:
                        if "/" in f_str:
                            p = f_str.split("/")
                            d_obj = datetime(int(p[2]), int(p[1]), int(p[0]))
                            mora_lbl = f"{max(0, (now_dt - d_obj).days)}d"
                        elif "-" in f_str:
                            p = f_str.split("-")
                            if len(p[0]) == 4:
                                d_obj = datetime(int(p[0]), int(p[1]), int(p[2]))
                            else:
                                d_obj = datetime(int(p[2]), int(p[1]), int(p[0]))
                            mora_lbl = f"{max(0, (now_dt - d_obj).days)}d"
                    except Exception:
                        mora_lbl = ""

                    row_data = [
                        item.get("fecha"), item.get("hora"), mora_lbl, item.get("sede"),
                        item.get("doc"), str(item.get("identificacion", "")), item.get("paciente"),
                        item.get("programa"), item.get("profesional"),
                        item.get("estado_phc") or "Confirmada",
                        item.get("estado_fb") or item.get("nota_aclaratoria") or "",
                        item.get("observacion_fb"), item.get("auditor_fb")
                    ]
                    ws.append(row_data)
                    for c_idx in range(1, 14):
                        cell = ws.cell(row=r_idx, column=c_idx)
                        cell.font = Font(name="Arial", size=10)
                        cell.border = thin_border

                for col_idx, col in enumerate(ws.columns, start=1):
                    max_len = max((len(str(cell.value or '')) for cell in col if getattr(cell, 'value', None) is not None), default=10)
                    col_letter = get_column_letter(col_idx)
                    ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

                output = io.BytesIO()
                wb.save(output)
                output.seek(0)

                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                self.send_header('Content-Disposition', 'attachment; filename="Citas_Pendientes_AGENDAWEB.xlsx"')
                self.end_headers()
                self.wfile.write(output.getvalue())
                return
            else:
                self.send_error(404, "Endpoint no encontrado")
        except Exception as e:
            traceback.print_exc()
            self.send_json({"error": str(e)}, status=500)

    def serve_static_file(self, rel_path, mime_type):
        base_dir = os.path.abspath(os.getcwd())
        target_path = os.path.abspath(os.path.join(base_dir, rel_path))
        if not target_path.startswith(base_dir):
            self.send_error(403, "Acceso no autorizado")
            return

        if os.path.exists(target_path) and os.path.isfile(target_path):
            with open(target_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', mime_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_error(404, f"Archivo {rel_path} no encontrado")

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

def run_server():
    os.makedirs("static", exist_ok=True)
    host = "127.0.0.1"
    with ReusableTCPServer((host, PORT), DashboardRequestHandler) as httpd:
        print(f"\n=======================================================")
        print(f" Servidor Web AGENDAWEB ejecutándose de forma segura en:")
        print(f" http://{host}:{PORT}")
        print(f"=======================================================\n")
        sys.stdout.flush()
        httpd.serve_forever()

if __name__ == "__main__":
    run_server()
