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
    return {}

def save_config(cfg):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[Config Save Error]: {e}")
        return False

DB_CONFIG_FILE = "db_config.json"

def load_db_config():
    if os.path.exists(DB_CONFIG_FILE):
        try:
            with open(DB_CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "database": {
            "server": "172.200.6.135",
            "user": "gesis",
            "password": "Gesis1234@;",
            "db_agendaweb": "BDAGENDAWEB",
            "db_svces": "BDSVCES",
            "db_sap": "BDSAP",
            "driver": "{SQL Server}"
        },
        "github": {
            "repo": "unionsaludvida2/cierredehistorias",
            "branch": "main",
            "token": "",
            "auto_sync": False
        }
    }

def save_db_config(cfg):
    with open(DB_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

def get_db_connection_string(db_key="db_agendaweb"):
    db_cfg = load_db_config().get("database", {})
    driver = db_cfg.get("driver", "{SQL Server}")
    server = db_cfg.get("server", "172.200.6.135")
    user = db_cfg.get("user", "gesis")
    password = db_cfg.get("password", "Gesis1234@;")
    db_name = db_cfg.get(db_key, "BDAGENDAWEB")
    return f"DRIVER={driver};SERVER={server};DATABASE={db_name};UID={user};PWD={password};"

def test_db_connection(db_params=None):
    try:
        import pyodbc
        if not db_params:
            db_params = load_db_config().get("database", {})
        driver = db_params.get("driver", "{SQL Server}")
        server = db_params.get("server", "172.200.6.135")
        user = db_params.get("user", "gesis")
        password = db_params.get("password", "")
        db_name = db_params.get("db_agendaweb", "BDAGENDAWEB")
        conn_str = f"DRIVER={driver};SERVER={server};DATABASE={db_name};UID={user};PWD={password};"
        conn = pyodbc.connect(conn_str, timeout=5)
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        conn.close()
        return {"success": True, "message": f"Conexión exitosa a SQL Server {server} (BD: {db_name})."}
    except Exception as e:
        return {"success": False, "error": str(e)}

def test_github_connection(repo=None, token=None):
    gh_cfg = load_db_config().get("github", {})
    repo = repo or gh_cfg.get("repo", "unionsaludvida2/cierredehistorias")
    token = token or gh_cfg.get("token", "")
    if not token or not str(token).strip():
        return {"success": False, "error": "Token de GitHub no configurado."}
    try:
        url = f"https://api.github.com/repos/{str(repo).strip()}"
        req = urllib.request.Request(url, headers={
            "Authorization": f"token {str(token).strip()}",
            "User-Agent": "Antigravity-Config-Client",
            "Accept": "application/vnd.github.v3+json"
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return {
                "success": True,
                "full_name": data.get("full_name"),
                "private": data.get("private"),
                "permissions": data.get("permissions")
            }
    except urllib.error.HTTPError as he:
        return {"success": False, "error": f"Error HTTP {he.code}: {he.reason}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def push_file_to_github(file_path, repo=None, branch=None, token=None, commit_msg=None):
    import base64
    gh_cfg = load_db_config().get("github", {})
    repo = (repo or gh_cfg.get("repo", "unionsaludvida2/cierredehistorias")).strip()
    branch = (branch or gh_cfg.get("branch", "main")).strip()
    token = (token or gh_cfg.get("token", "")).strip()

    if not token:
        return {"success": False, "error": "No hay token de GitHub configurado para sincronizar."}

    if not os.path.exists(file_path):
        return {"success": False, "error": f"El archivo local {file_path} no existe."}

    rel_path = os.path.relpath(file_path).replace("\\", "/")
    with open(file_path, "rb") as f:
        content_bytes = f.read()
    file_size_bytes = len(content_bytes)
    encoded_content = base64.b64encode(content_bytes).decode("utf-8")

    sha = None
    url = f"https://api.github.com/repos/{repo}/contents/{rel_path}?ref={branch}"
    headers = {
        "Authorization": f"token {token}",
        "User-Agent": "Antigravity-Config-Client",
        "Accept": "application/vnd.github.v3+json"
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            sha = data.get("sha")
    except urllib.error.HTTPError as he:
        if he.code != 404:
            return {"success": False, "file": rel_path, "error": f"Error al consultar archivo en GitHub: {he.code} {he.reason}"}
    except Exception as e:
        return {"success": False, "file": rel_path, "error": f"Error de red al consultar SHA: {e}"}

    payload = {
        "message": commit_msg or f"Auto-update {rel_path} desde panel de configuración",
        "content": encoded_content,
        "branch": branch
    }
    if sha:
        payload["sha"] = sha

    put_url = f"https://api.github.com/repos/{repo}/contents/{rel_path}"
    put_data = json.dumps(payload).encode("utf-8")
    req_put = urllib.request.Request(put_url, data=put_data, headers={**headers, "Content-Type": "application/json"}, method="PUT")
    try:
        # Timeout extendido a 120 segundos para archivos grandes de caché (hasta 10 MB)
        with urllib.request.urlopen(req_put, timeout=120) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
            commit_info = res_json.get("commit", {})
            return {
                "success": True,
                "file": rel_path,
                "size_bytes": file_size_bytes,
                "commit_sha": commit_info.get("sha"),
                "commit_url": commit_info.get("html_url")
            }
    except Exception as e:
        return {"success": False, "file": rel_path, "size_bytes": file_size_bytes, "error": f"Error al subir a GitHub: {e}"}

def push_multiple_files_to_github(file_list, commit_msg=None):
    results = []
    expanded_files = []
    for fp in file_list:
        expanded_files.append(fp)
        if fp == "index.html" and os.path.exists("static/index.html") and "static/index.html" not in file_list:
            expanded_files.append("static/index.html")

    for fp in expanded_files:
        res = push_file_to_github(fp, commit_msg=commit_msg)
        results.append(res)
    all_ok = all(r.get("success") for r in results)
    return {"success": all_ok, "details": results}

def ensure_fresh_static_api_jsons(processor=None):
    """
    Regenera los 4 archivos JSON de static/api/ a partir del pack en memoria o sql_cache.pkl
    """
    if processor is None:
        try:
            from etl_processor import ETLProcessor
            processor = ETLProcessor()
        except Exception:
            return []

    pack = getattr(processor, 'cached_pack', None)
    if not pack and os.path.exists("sql_cache.pkl"):
        try:
            import pickle
            with open("sql_cache.pkl", "rb") as f_in:
                pack = pickle.load(f_in)
                processor.cached_pack = pack
        except Exception as e:
            print(f"[Fresh JSONs Error loading pkl]: {e}")

    if not pack:
        try:
            pack, _ = processor.fetch_data()
        except Exception as e:
            print(f"[Fresh JSONs fetch_data Error]: {e}")
            return []

    os.makedirs(os.path.join("static", "api"), exist_ok=True)
    generated = []

    for p_name in ["ultimo_mes", "fechas_previas", "ambos"]:
        s_data = processor.get_summary(pack, filters={"periodo": p_name})
        out_f = os.path.join("static", "api", f"dashboard_{p_name}.json")
        with open(out_f, "w", encoding="utf-8") as fs:
            json.dump(s_data, fs, ensure_ascii=False)
        generated.append(out_f)

        if p_name == "ultimo_mes":
            alias_f = os.path.join("static", "api", "dashboard.json")
            with open(alias_f, "w", encoding="utf-8") as fs_alias:
                json.dump(s_data, fs_alias, ensure_ascii=False)
            generated.append(alias_f)

    return generated

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


