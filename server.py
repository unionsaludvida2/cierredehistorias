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
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

from etl_processor import ETLProcessor
from google_sheets import (
    load_feedback, save_feedback_record, save_feedback_records_batch, load_config, save_config, sync_all_with_google_sheets, push_cache_to_drive_async, push_all_caches_to_drive_async, fetch_feedback_from_google_sheets, fetch_feedback_from_google_sheets_async
)


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

                has_extra_filters = bool(filters and any(filters.get(k) for k in ["ano", "mes", "dia", "quincena", "sede", "programa", "profesional"]))

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
                ids_citas = body.get("ids_citas")
                estado = body.get("estado", "Pendiente Cierre")
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
                        host_name=host_name
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
                        host_name=host_name
                    )
                    try:
                        processor.refresh_cached_summaries()
                    except Exception as ex:
                        print(f"[ETL Cache Refresh Error]: {ex}")
                    return self.send_json({"success": True, "record": rec})
                else:
                    return self.send_json({"error": "Falta id_cita o ids_citas"}, status=400)



            elif path == "/api/sync":
                res = processor.manual_check_and_sync()
                try:
                    pack = processor.cached_pack or processor.fetch_data()[0]
                    for p_name in ["ultimo_mes", "fechas_previas", "ambos"]:
                        s_data = processor.get_summary(pack, filters={"periodo": p_name})
                        out_f = os.path.join("static", "api", f"dashboard_{p_name}.json")
                        os.makedirs(os.path.dirname(out_f), exist_ok=True)
                        with open(out_f, "w", encoding="utf-8") as fs:
                            json.dump(s_data, fs, ensure_ascii=False)
                    push_all_caches_to_drive_async(processor, pack)
                except Exception as ex_sync:
                    print(f"[Drive Auto Push Error]: {ex_sync}")
                return self.send_json(res)


            elif path == "/api/config":

                url = body.get("google_sheets_url", "")
                cfg = load_config()
                cfg["google_sheets_url"] = url
                save_config(cfg)

                synced_count, total = sync_all_with_google_sheets(url) if url else (0, 0)
                return self.send_json({"success": True, "config": cfg, "synced_count": synced_count, "total_pending_sync": total})

            elif path == "/api/export":
                filters = body.get("filters", {})
                df, _ = processor.fetch_data()
                fb_dict = load_feedback()
                summary = processor.get_summary(df, filters=filters, feedback_dict=fb_dict)
                detalles = summary.get("detalle_pendientes", [])

                wb = Workbook()
                ws = wb.active
                ws.title = "Citas Pendientes"

                ws.merge_cells("A1:K1")
                cell = ws["A1"]
                cell.value = "UNIÓN PARA LA SALUD Y LA VIDA S.A.S - CITAS CONFIRMADAS SIN REPORTE DE ATENCIÓN"
                cell.font = Font(name="Arial", size=14, bold=True, color="FFFFFF")
                cell.fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
                cell.alignment = Alignment(horizontal="center", vertical="center")
                ws.row_dimensions[1].height = 35

                headers = ["Fecha", "Hora", "Sede", "Tipo Doc", "Identificación", "Paciente", "Programa", "Profesional", "Estado Gestión", "Observación Auditor", "Auditor"]
                ws.append([])
                ws.append(headers)

                header_fill = PatternFill(start_color="0EA5E9", end_color="0EA5E9", fill_type="solid")
                header_font = Font(name="Arial", size=11, bold=True, color="FFFFFF")
                thin_border = Border(left=Side(style='thin', color='CBD5E1'), right=Side(style='thin', color='CBD5E1'),
                                     top=Side(style='thin', color='CBD5E1'), bottom=Side(style='thin', color='CBD5E1'))

                for col in range(1, 12):
                    c = ws.cell(row=3, column=col)
                    c.fill = header_fill
                    c.font = header_font
                    c.alignment = Alignment(horizontal="center", vertical="center")
                    c.border = thin_border
                ws.row_dimensions[3].height = 25

                for r_idx, item in enumerate(detalles, start=4):
                    row_data = [
                        item.get("fecha"), item.get("hora"), item.get("sede"),
                        item.get("doc"), item.get("identificacion"), item.get("paciente"),
                        item.get("programa"), item.get("profesional"),
                        item.get("estado_fb"), item.get("observacion_fb"), item.get("auditor_fb")
                    ]
                    ws.append(row_data)
                    for c_idx in range(1, 12):
                        cell = ws.cell(row=r_idx, column=c_idx)
                        cell.font = Font(name="Arial", size=10)
                        cell.border = thin_border

                for col in ws.columns:
                    max_len = max(len(str(cell.value or '')) for cell in col)
                    col_letter = col[0].column_letter
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
    with ReusableTCPServer(("", PORT), DashboardRequestHandler) as httpd:
        print(f"\n=======================================================")
        print(f" Servidor Web AGENDAWEB ejecutándose en:")
        print(f" http://localhost:{PORT}")
        print(f"=======================================================\n")
        sys.stdout.flush()
        httpd.serve_forever()

if __name__ == "__main__":
    run_server()
