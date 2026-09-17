import json
import os
import datetime
import urllib.request
import urllib.parse
import urllib.error
import threading


FEEDBACK_FILE = "feedback_store.json"
CONFIG_FILE = "config.json"

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "google_sheet_id": "1Wra6flqax-5z2tW_RrsuzvcuPm281LYJtgtF9CUBHg8",
        "google_sheets_apps_script_url": "https://script.google.com/macros/s/AKfycbwJpBkulzQBZotwt3GmKIYe7zi95sCzjSdWikkho4gVdo5cePupMWiKtlPg2xjBomSO/exec"

    }


def save_config(cfg):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

def load_feedback():
    if os.path.exists(FEEDBACK_FILE):
        try:
            with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_feedback_record(id_cita, estado, observacion, auditor, cedula_auditor="", client_ip="", os_user="", host_name=""):
    fb = load_feedback()
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rec = {
        "id_cita": str(id_cita),
        "estado": estado,
        "observacion": observacion,
        "auditor": auditor,
        "cedula_auditor": str(cedula_auditor),
        "fecha_gestion": timestamp,
        "ip_equipo": client_ip,
        "usuario_pc": os_user,
        "nombre_equipo": host_name,
        "synced": False
    }
    fb[str(id_cita)] = rec
    
    with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
        json.dump(fb, f, ensure_ascii=False, indent=2)

    # Intentar sincronizar en segundo plano de forma asíncrona (no bloquea el cliente HTTP)
    cfg = load_config()
    url = cfg.get("google_sheets_apps_script_url")
    if url:
        threading.Thread(target=push_record_to_google_sheets, args=(url, rec), daemon=True).start()
        
    return rec


def save_feedback_records_batch(ids_citas, estado, observacion, auditor, cedula_auditor="", client_ip="", os_user="", host_name=""):
    fb = load_feedback()
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    saved_records = []

    for id_cita in ids_citas:
        cid = str(id_cita).strip()
        if not cid:
            continue
        rec = {
            "id_cita": cid,
            "estado": estado,
            "observacion": observacion,
            "auditor": auditor,
            "cedula_auditor": str(cedula_auditor),
            "fecha_gestion": timestamp,
            "ip_equipo": client_ip,
            "usuario_pc": os_user,
            "nombre_equipo": host_name,
            "synced": False
        }
        fb[cid] = rec
        saved_records.append(rec)

    with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
        json.dump(fb, f, ensure_ascii=False, indent=2)

    cfg = load_config()
    url = cfg.get("google_sheets_apps_script_url")
    if url and saved_records:
        threading.Thread(target=push_batch_to_google_sheets, args=(url, saved_records), daemon=True).start()

    return saved_records


def push_batch_to_google_sheets(url, records):
    try:
        payload = {
            "action": "save_batch_feedback",
            "records": records
        }
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            res_body = resp.read().decode('utf-8')
            res_json = json.loads(res_body)
            if res_json.get("result") == "success":
                fb = load_feedback()
                for rec in records:
                    cid = str(rec.get("id_cita"))
                    if cid in fb:
                        fb[cid]["synced"] = True
                with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
                    json.dump(fb, f, ensure_ascii=False, indent=2)
                return True
    except Exception as e:
        print(f"[Google Sheets Sync] Batch sync intento 1 ({e}). Enviando registros individualmente...")

    # Fallback individual para compatibilidad total con scripts anteriores
    for rec in records:
        push_record_to_google_sheets(url, rec)
    return True



def push_record_to_google_sheets(url, record):
    try:
        data = json.dumps(record).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            res_body = resp.read().decode('utf-8')
            res_json = json.loads(res_body)
            if res_json.get("result") == "success":
                record["synced"] = True
                fb = load_feedback()
                fb[record["id_cita"]] = record
                with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
                    json.dump(fb, f, ensure_ascii=False, indent=2)
                return True
    except Exception as e:
        print(f"[Google Sheets Sync] Error al sincronizar cita {record.get('id_cita')}: {e}")
    return False

def fetch_feedback_from_google_sheets(url=None):
    if not url:
        cfg = load_config()
        url = cfg.get("google_sheets_apps_script_url")
    if not url:
        return load_feedback()

    try:
        req_url = f"{url}?action=get_all_feedback"
        req = urllib.request.Request(req_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            res_body = resp.read().decode('utf-8')
            res_json = json.loads(res_body)
            if res_json.get("result") == "success":
                records = res_json.get("records", [])
                fb = load_feedback()
                updated = False
                for rec in records:
                    cid = str(rec.get("id_cita"))
                    if cid and cid != "None" and cid != "":
                        fb[cid] = rec
                        updated = True
                if updated:
                    with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
                        json.dump(fb, f, ensure_ascii=False, indent=2)
                    print(f"[Google Sheets Sync] Traídos {len(records)} registros de auditoría desde Google Sheets.")
                return fb
    except Exception as e:
        print(f"[Google Sheets Sync] Aviso al descargar auditorías desde Google Sheets: {e}")

    return load_feedback()

def fetch_feedback_from_google_sheets_async(url=None):
    def _worker():
        try:
            fetch_feedback_from_google_sheets(url)
        except Exception:
            pass
    threading.Thread(target=_worker, daemon=True).start()




def sync_all_with_google_sheets(url=None):
    if not url:
        cfg = load_config()
        url = cfg.get("google_sheets_apps_script_url")
    if not url:
        return 0, 0

    fetch_feedback_from_google_sheets(url)
    fb = load_feedback()
    unsynced = [rec for rec in fb.values() if not rec.get("synced")]
    synced_count = 0

    for rec in unsynced:
        if push_record_to_google_sheets(url, rec):
            synced_count += 1

    return synced_count, len(unsynced)


def push_cache_to_drive(periodo, summary_data):
    import requests
    cfg = load_config()
    url = cfg.get("google_sheets_apps_script_url")
    if not url:
        return False
    payload = {
        "action": "save_dashboard_cache",
        "periodo": periodo,
        "json_data": summary_data
    }
    r = requests.post(url, json=payload, timeout=120)
    if r.status_code == 200:
        print(f"[Google Drive Sync] Caché '{periodo}' sincronizado automáticamente con Google Drive.")
        return True
    else:
        print(f"[Google Drive Sync] Advertencia al sincronizar '{periodo}': Status {r.status_code}")
        return False

def push_cache_to_drive_async(periodo, summary_data):
    def _worker():
        try:
            push_cache_to_drive(periodo, summary_data)
        except Exception as e:
            print(f"[Google Drive Sync] Aviso al sincronizar caché '{periodo}': {e}")
    threading.Thread(target=_worker, daemon=True).start()

def push_all_caches_to_drive_async(processor, pack=None):
    def _worker():
        try:
            target_pack = pack or getattr(processor, "cached_pack", None)
            if not target_pack:
                return
            print("[Google Drive Sync] Iniciando sincronización de los 3 cachés (ultimo_mes, fechas_previas, ambos) a Google Drive...")
            for periodo in ["ultimo_mes", "fechas_previas", "ambos"]:
                try:
                    summary_data = processor.get_summary(target_pack, filters={"periodo": periodo})
                    push_cache_to_drive(periodo, summary_data)
                except Exception as ex_p:
                    print(f"[Google Drive Sync] Error al sincronizar caché '{periodo}': {ex_p}")
            print("[Google Drive Sync] Todos los cachés de Google Drive fueron actualizados.")
        except Exception as e:
            print(f"[Google Drive Sync] Error general en push_all_caches_to_drive_async: {e}")
    threading.Thread(target=_worker, daemon=True).start()


