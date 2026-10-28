import json
import os
import datetime
import urllib.request
import urllib.parse
import urllib.error
import threading
import ssl

def _get_ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    try:
        return ssl.create_default_context()
    except Exception:
        pass
    return ssl._create_unverified_context()

def _urlopen(req, timeout=15):
    ctx = _get_ssl_context()
    try:
        return urllib.request.urlopen(req, timeout=timeout, context=ctx)
    except (ssl.SSLError, urllib.error.URLError) as e:
        err_str = str(e)
        if "CERTIFICATE_VERIFY_FAILED" in err_str or isinstance(e, ssl.SSLError):
            return urllib.request.urlopen(req, timeout=timeout, context=ssl._create_unverified_context())
        raise

FEEDBACK_FILE = "feedback_store.json"
CONFIG_FILE = "config.json"

_CONFIG_CACHE = None
_CONFIG_MTIME = 0

def load_config(force_reload=False):
    global _CONFIG_CACHE, _CONFIG_MTIME
    if os.path.exists(CONFIG_FILE):
        try:
            mtime = os.path.getmtime(CONFIG_FILE)
            if not force_reload and _CONFIG_CACHE is not None and mtime == _CONFIG_MTIME:
                return _CONFIG_CACHE
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                _CONFIG_CACHE = data
                _CONFIG_MTIME = mtime
                return data
        except Exception:
            pass
    return _CONFIG_CACHE if _CONFIG_CACHE is not None else {}

def save_config(cfg):
    global _CONFIG_CACHE, _CONFIG_MTIME
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        _CONFIG_CACHE = cfg
        if os.path.exists(CONFIG_FILE):
            _CONFIG_MTIME = os.path.getmtime(CONFIG_FILE)
        return True
    except Exception as e:
        print(f"[Config Save Error]: {e}")
        return False

DB_CONFIG_FILE = "db_config.json"
_FEEDBACK_LOCK = threading.Lock()
_CONFIG_LOCK = threading.Lock()

def mask_db_config(cfg):
    """
    Retorna una copia sanitizada de la configuración para enviarse de forma segura
    a clientes HTTP/web sin exponer contraseñas ni tokens en texto plano.
    """
    if not isinstance(cfg, dict):
        return {}
    sanitized = json.loads(json.dumps(cfg))
    db_part = sanitized.get("database", {})
    if isinstance(db_part, dict) and "password" in db_part and db_part["password"]:
        db_part["password"] = "••••••••"
    gh_part = sanitized.get("github", {})
    if isinstance(gh_part, dict) and "token" in gh_part and gh_part["token"]:
        tok = str(gh_part["token"]).strip()
        if len(tok) > 8:
            gh_part["token"] = tok[:4] + "••••••••" + tok[-4:]
        else:
            gh_part["token"] = "••••••••"
    return sanitized

def load_db_config():
    """
    Carga la configuración de la base de datos y GitHub desde variables de entorno
    o el archivo privado db_config.json. No contiene contraseñas en código duro.
    """
    cfg = {}
    if os.path.exists(DB_CONFIG_FILE):
        try:
            with open(DB_CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception as e:
            print(f"[DB Config Load Warning]: {e}")

    # Estructura base
    db = cfg.get("database", {})
    gh = cfg.get("github", {})

    # Soporte para variables de entorno prioritarias (12-Factor App / Seguridad)
    server = os.environ.get("DB_SERVER") or db.get("server", "127.0.0.1")
    port = os.environ.get("DB_PORT") or db.get("port", "1433")
    user = os.environ.get("DB_USER") or os.environ.get("DB_USERNAME") or db.get("username") or db.get("user", "")
    password = os.environ.get("DB_PASSWORD") or db.get("password", "")
    driver = os.environ.get("DB_DRIVER") or db.get("driver", "{SQL Server}")

    databases = db.get("databases", {})
    if not isinstance(databases, dict):
        databases = {}

    db_agenda = os.environ.get("DB_AGENDAWEB") or databases.get("agendaweb") or db.get("db_agendaweb", "BDAGENDAWEB")
    db_svces = os.environ.get("DB_SVCES") or databases.get("svces") or db.get("db_svces", "BDSVCES")
    db_sap = os.environ.get("DB_SAP") or databases.get("sap") or db.get("db_sap", "BDSAP")

    databases["agendaweb"] = db_agenda
    databases["svces"] = db_svces
    databases["sap"] = db_sap

    gh_repo = os.environ.get("GITHUB_REPO") or gh.get("repo", "unionsaludvida2/cierredehistorias")
    gh_branch = os.environ.get("GITHUB_BRANCH") or gh.get("branch", "main")
    gh_token = os.environ.get("GITHUB_TOKEN") or gh.get("token", "")
    gh_sync = gh.get("auto_sync", False)

    return {
        "database": {
            "server": server,
            "port": port,
            "username": user,
            "user": user,
            "password": password,
            "driver": driver,
            "databases": databases,
            "db_agendaweb": db_agenda,
            "db_svces": db_svces,
            "db_sap": db_sap
        },
        "github": {
            "repo": gh_repo,
            "branch": gh_branch,
            "token": gh_token,
            "auto_sync": gh_sync
        }
    }

def save_db_config(new_cfg):
    """
    Guarda la configuración preservando contraseñas/tokens existentes
    en caso de que el cliente envíe una máscara ('••••••••' o '********').
    """
    with _CONFIG_LOCK:
        existing = {}
        if os.path.exists(DB_CONFIG_FILE):
            try:
                with open(DB_CONFIG_FILE, "r", encoding="utf-8") as f:
                    existing = json.load(f)
            except Exception:
                existing = {}

        if not isinstance(new_cfg, dict):
            new_cfg = {}

        merged_cfg = json.loads(json.dumps(existing))
        db_merged = merged_cfg.setdefault("database", {})
        db_new = new_cfg.get("database", {}) if isinstance(new_cfg, dict) else {}
        for k, v in db_new.items():
            if k == "password":
                if not ("••••" in str(v) or "****" in str(v) or (not v and db_merged.get("password"))):
                    db_merged["password"] = v
            elif v is not None and str(v).strip() != "":
                db_merged[k] = v

        gh_merged = merged_cfg.setdefault("github", {})
        gh_new = new_cfg.get("github", {}) if isinstance(new_cfg, dict) else {}
        for k, v in gh_new.items():
            if k == "token":
                if not ("••••" in str(v) or "****" in str(v) or (not v and gh_merged.get("token"))):
                    gh_merged["token"] = v
            elif v is not None and str(v).strip() != "":
                gh_merged[k] = v

        try:
            with open(DB_CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(merged_cfg, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"[Save DB Config Error]: {e}")
            return False

def get_db_connection_string(db_key="db_agendaweb"):
    db_cfg = load_db_config().get("database", {})
    driver = db_cfg.get("driver")
    extra_flags = ""
    if not driver:
        try:
            import pyodbc
            installed = pyodbc.drivers()
            if "ODBC Driver 18 for SQL Server" in installed:
                driver = "{ODBC Driver 18 for SQL Server}"
                extra_flags = "TrustServerCertificate=yes;Encrypt=no;"
            elif "ODBC Driver 17 for SQL Server" in installed:
                driver = "{ODBC Driver 17 for SQL Server}"
                extra_flags = "TrustServerCertificate=yes;"
            else:
                driver = "{SQL Server}"
        except Exception:
            driver = "{SQL Server}"
    elif "Driver 18" in driver or "Driver 17" in driver:
        extra_flags = "TrustServerCertificate=yes;Encrypt=no;"

    server = db_cfg.get("server", "127.0.0.1")
    port = db_cfg.get("port")
    user = db_cfg.get("username") or db_cfg.get("user", "")
    password = db_cfg.get("password", "")
    
    databases = db_cfg.get("databases", {})
    clean_key = str(db_key).lower().replace("db_", "").strip()
    db_name = databases.get(clean_key) or db_cfg.get(db_key) or db_cfg.get(clean_key, "BDAGENDAWEB")
    
    server_str = f"{server},{port}" if port and str(port).strip() and str(port).strip() != "1433" else server
    return f"DRIVER={driver};SERVER={server_str};DATABASE={db_name};UID={user};PWD={password};{extra_flags}"

def test_db_connection(db_params=None):
    try:
        import pyodbc
        current_cfg = load_db_config().get("database", {})
        if not db_params:
            db_params = current_cfg
        else:
            # Preservar contraseña existente si viene enmascarada
            if "••••" in db_params.get("password", "") or "****" in db_params.get("password", ""):
                db_params["password"] = current_cfg.get("password", "")

        driver = db_params.get("driver")
        extra_flags = ""
        if not driver:
            installed = pyodbc.drivers()
            if "ODBC Driver 18 for SQL Server" in installed:
                driver = "{ODBC Driver 18 for SQL Server}"
                extra_flags = "TrustServerCertificate=yes;Encrypt=no;"
            elif "ODBC Driver 17 for SQL Server" in installed:
                driver = "{ODBC Driver 17 for SQL Server}"
                extra_flags = "TrustServerCertificate=yes;"
            else:
                driver = "{SQL Server}"
        elif "Driver 18" in driver or "Driver 17" in driver:
            extra_flags = "TrustServerCertificate=yes;Encrypt=no;"

        server = db_params.get("server", current_cfg.get("server", "127.0.0.1"))
        user = db_params.get("username") or db_params.get("user", current_cfg.get("username", ""))
        password = db_params.get("password", current_cfg.get("password", ""))
        databases = db_params.get("databases", {})
        db_name = databases.get("agendaweb") or db_params.get("db_agendaweb") or current_cfg.get("db_agendaweb", "BDAGENDAWEB")
        port = db_params.get("port") or current_cfg.get("port")
        server_str = f"{server},{port}" if port and str(port).strip() and str(port).strip() != "1433" else server

        conn_str = f"DRIVER={driver};SERVER={server_str};DATABASE={db_name};UID={user};PWD={password};{extra_flags}"
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
        with _urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return {
                "success": True,
                "full_name": data.get("full_name"),
                "private": data.get("private"),
                "permissions": data.get("permissions")
            }
    except urllib.error.HTTPError as he:
        if he.code == 401:
            return {"success": False, "error": "Token de GitHub no válido o expirado (HTTP 401 Unauthorized / Bad credentials)."}
        if he.code == 404:
            return {"success": False, "error": f"Repositorio '{repo}' no encontrado en GitHub (HTTP 404). Verifique el nombre o permisos del token."}
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
        with _urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            sha = data.get("sha")
    except urllib.error.HTTPError as he:
        if he.code == 401:
            return {"success": False, "file": rel_path, "error": "Token de GitHub no válido o expirado (HTTP 401 Unauthorized / Bad credentials)."}
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
        # Timeout extendido a 180 segundos para archivos grandes de caché (hasta 12 MB)
        with _urlopen(req_put, timeout=180) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
            commit_info = res_json.get("commit", {})
            return {
                "success": True,
                "file": rel_path,
                "size_bytes": file_size_bytes,
                "commit_sha": commit_info.get("sha"),
                "commit_url": commit_info.get("html_url")
            }
    except urllib.error.HTTPError as he:
        if he.code == 401:
            return {"success": False, "file": rel_path, "size_bytes": file_size_bytes, "error": "Token de GitHub no válido o expirado (HTTP 401 Unauthorized)."}
        if he.code == 409:
            return {"success": False, "file": rel_path, "size_bytes": file_size_bytes, "error": "Conflicto de versión en GitHub (HTTP 409). Intente nuevamente."}
        return {"success": False, "file": rel_path, "size_bytes": file_size_bytes, "error": f"Error HTTP {he.code}: {he.reason}"}
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

def ensure_fresh_static_api_jsons(processor=None, pack=None):
    """
    Regenera los 4 archivos JSON de static/api/ a partir del pack en memoria o sql_cache.pkl
    """
    if processor is None:
        try:
            from etl_processor import ETLProcessor
            processor = ETLProcessor()
        except Exception:
            processor = None

    if pack is None and processor is not None:
        pack = getattr(processor, 'cached_pack', None)

    if not pack and os.path.exists("sql_cache.pkl"):
        try:
            import pickle
            with open("sql_cache.pkl", "rb") as f_in:
                pack = pickle.load(f_in)
                if processor is not None:
                    processor.cached_pack = pack
        except Exception as e:
            print(f"[Fresh JSONs Error loading pkl]: {e}")

    if not pack and processor is not None:
        try:
            pack, _ = processor.fetch_data()
        except Exception as e:
            print(f"[Fresh JSONs fetch_data Error]: {e}")
            return []

    # Protocolo de exclusión PHC para regeneración de JSONs
    if pack and hasattr(processor, "exclude_phc_from_pack"):
        try:
            pack = processor.exclude_phc_from_pack(pack)
        except Exception as ex_phc:
            print(f"[Fresh JSONs PHC Protocol Warning]: {ex_phc}")

    os.makedirs(os.path.join("static", "api"), exist_ok=True)
    generated = []

    fb = load_feedback()
    for p_name in ["ultimo_mes", "fechas_previas", "ambos"]:
        s_data = processor._compute_summary(pack, filters={"periodo": p_name}, feedback_dict=fb)
        out_f = os.path.join("static", "api", f"dashboard_{p_name}.json")
        with open(out_f, "w", encoding="utf-8") as fs:
            json.dump(s_data, fs, ensure_ascii=False, separators=(',', ':'))
        generated.append(out_f)

        if p_name == "ultimo_mes":
            alias_f = os.path.join("static", "api", "dashboard.json")
            with open(alias_f, "w", encoding="utf-8") as fs_alias:
                json.dump(s_data, fs_alias, ensure_ascii=False, separators=(',', ':'))
            generated.append(alias_f)

        if hasattr(processor, '_cached_summaries') and isinstance(processor._cached_summaries, dict):
            processor._cached_summaries[p_name] = s_data

    return generated

regenerate_static_api = ensure_fresh_static_api_jsons

BACKUP_DIR = "backups"

def backup_feedback_store(max_days=7):
    """
    Opción 4: Respaldo rotativo automático de feedback_store.json conservando los últimos 7 días.
    """
    try:
        if not os.path.exists(FEEDBACK_FILE):
            return None
        os.makedirs(BACKUP_DIR, exist_ok=True)
        today_str = datetime.datetime.now().strftime("%Y%m%d")
        backup_file = os.path.join(BACKUP_DIR, f"feedback_store_{today_str}.json")
        
        with _FEEDBACK_LOCK:
            with open(FEEDBACK_FILE, "r", encoding="utf-8") as f_src:
                content = f_src.read()
            with open(backup_file, "w", encoding="utf-8") as f_dst:
                f_dst.write(content)
        
        # Rotación de respaldos: purgar los que superen max_days
        now = datetime.datetime.now()
        for fname in os.listdir(BACKUP_DIR):
            if fname.startswith("feedback_store_") and fname.endswith(".json"):
                fpath = os.path.join(BACKUP_DIR, fname)
                try:
                    fdate_str = fname.replace("feedback_store_", "").replace(".json", "")
                    fdate = datetime.datetime.strptime(fdate_str, "%Y%m%d")
                    if (now - fdate).days > max_days:
                        os.remove(fpath)
                except Exception:
                    pass
        return backup_file
    except Exception as e:
        print(f"[Backup Error]: {e}")
        return None

def load_feedback():
    with _FEEDBACK_LOCK:
        if os.path.exists(FEEDBACK_FILE):
            try:
                with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

_CITA_META_CACHE = {}

def get_cita_metadata(id_cita):
    cid = str(id_cita).strip()
    if not cid:
        return {}
    if cid in _CITA_META_CACHE:
        return _CITA_META_CACHE[cid]

    # 1. Check feedback_store first
    if os.path.exists(FEEDBACK_FILE):
        try:
            with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
                fb = json.load(f)
            if cid in fb and fb[cid].get("sede"):
                meta = {
                    "sede": fb[cid].get("sede", ""),
                    "fecha_cita": fb[cid].get("fecha_cita", ""),
                    "hora_cita": fb[cid].get("hora_cita", ""),
                    "programa": fb[cid].get("programa", ""),
                    "id_profesional": fb[cid].get("id_profesional", ""),
                    "nombre_profesional": fb[cid].get("nombre_profesional", "")
                }
                _CITA_META_CACHE[cid] = meta
                return meta
        except Exception:
            pass

    # 2. Check sql_cache.pkl
    if os.path.exists("sql_cache.pkl"):
        try:
            import pickle
            with open("sql_cache.pkl", "rb") as f:
                data = pickle.load(f)
            df_p = data.get("pendientes")
            if df_p is not None and not df_p.empty and "ID_CITA" in df_p.columns:
                match = df_p[df_p["ID_CITA"].astype(str) == cid]
                if not match.empty:
                    r = match.iloc[0]
                    f_val = r.get("FECHA DE ATENCION")
                    f_str = f_val.strftime("%Y-%m-%d") if hasattr(f_val, "strftime") else str(f_val)[:10]
                    h_val = r.get("HORA DE ATENCION")
                    h_str = h_val.strftime("%H:%M:%S") if hasattr(h_val, "strftime") else str(h_val)
                    meta = {
                        "sede": str(r.get("NOMBRE IPS", "")),
                        "fecha_cita": f_str,
                        "hora_cita": h_str,
                        "programa": str(r.get("PROGRAMA", "")),
                        "id_profesional": str(r.get("Cedula", "")),
                        "nombre_profesional": str(r.get("NOMBRE PROFESIONAL", ""))
                    }
                    _CITA_META_CACHE[cid] = meta
                    return meta
        except Exception:
            pass

    # 3. Query SQL Server
    try:
        import pyodbc
        import pandas as pd
        from etl_processor import clean_programa, apply_fn_limpieza, clean_ips, is_programa_especialistas, resolve_ips_name
        conn = pyodbc.connect(get_db_connection_string("db_agendaweb"), timeout=5)

        # 3a. Consultar en tbl_citas_phc por campo Orden (Política PHC post-corte >= 2026-09-01)
        q_phc = """
        SELECT TOP 1
            Hora,
            IPS,
            [Identificación Médico] AS cedula_prof,
            [Código SURACUP] AS codigoservicio
        FROM dbo.tbl_citas_phc WITH (NOLOCK)
        WHERE Orden = ?
        """
        df_q = pd.read_sql(q_phc, conn, params=[cid])

        # 3b. Si no se encuentra en PHC y el ID es numérico, consultar repositorio histórico tbl_citas_atendidas (válido hasta 2026-08-31)
        if df_q.empty and cid.isdigit():
            q_atend = """
            SELECT TOP 1
                fechaatencion,
                horaatencion,
                nombreips,
                profesional,
                codigoservicio
            FROM dbo.tbl_citas_atendidas WITH (NOLOCK)
            WHERE identitycitas = ?
              AND fechaatencion <= '2026-08-31'
            """
            df_atend = pd.read_sql(q_atend, conn, params=[int(cid)])
            conn.close()

            if not df_atend.empty:
                r = df_atend.iloc[0]
                prof_raw = str(r.get("profesional", "")).strip()
                prof_clean = apply_fn_limpieza(prof_raw).strip()
                id_prof = ""
                nom_prof = prof_clean.title()
                cargo_prof = ""
                if os.path.exists("tbl_usuarios_all.pkl"):
                    try:
                        df_u = pd.read_pickle("tbl_usuarios_all.pkl")
                        u_match = df_u[df_u["Profesional"] == prof_clean]
                        if not u_match.empty:
                            id_prof = str(u_match.iloc[0].get("Cedula", ""))
                            nom_prof = str(u_match.iloc[0].get("Profesional2", "")).title()
                            cargo_prof = str(u_match.iloc[0].get("cargo", "")).lower()
                    except Exception:
                        pass
                prog = clean_programa(r.get("codigoservicio", ""))
                sede = clean_ips(r.get("nombreips", ""))
                if is_programa_especialistas(prog) and "general" not in cargo_prof:
                    sede = "Especialistas"
                f_val = r.get("fechaatencion")
                f_str = f_val.strftime("%Y-%m-%d") if hasattr(f_val, "strftime") else str(f_val)[:10]
                h_val = r.get("horaatencion")
                h_str = h_val.strftime("%H:%M:%S") if hasattr(h_val, "strftime") else str(h_val)
                meta = {
                    "sede": sede,
                    "fecha_cita": f_str,
                    "hora_cita": h_str,
                    "programa": prog,
                    "id_profesional": id_prof,
                    "nombre_profesional": nom_prof
                }
                _CITA_META_CACHE[cid] = meta
                return meta
        else:
            conn.close()
            if not df_q.empty:
                r = df_q.iloc[0]
                prog = clean_programa(r.get("codigoservicio", ""))
                ips_val = str(r.get("IPS", "")).strip()
                sede = resolve_ips_name(ips_val)
                h_dt = r.get("Hora")
                f_str = h_dt.strftime("%Y-%m-%d") if hasattr(h_dt, "strftime") else str(h_dt)[:10]
                h_str = h_dt.strftime("%H:%M:%S") if hasattr(h_dt, "strftime") else str(h_dt)[11:19]
                id_prof = str(r.get("cedula_prof", "") or "").strip()
                nom_prof = ""
                cargo_prof = ""
                if id_prof and os.path.exists("tbl_usuarios_all.pkl"):
                    try:
                        df_u = pd.read_pickle("tbl_usuarios_all.pkl")
                        u_match = df_u[df_u["Cedula"].astype(str) == id_prof]
                        if not u_match.empty:
                            nom_prof = str(u_match.iloc[0].get("Profesional2", "")).title()
                            cargo_prof = str(u_match.iloc[0].get("cargo", "")).lower()
                    except Exception:
                        pass
                if is_programa_especialistas(prog) and "general" not in cargo_prof:
                    sede = "Especialistas"
                if not nom_prof and id_prof:
                    try:
                        conn_s = pyodbc.connect(get_db_connection_string("db_svces"), timeout=3)
                        c_s = conn_s.cursor()
                        c_s.execute("SELECT (ISNULL(pnombre,'') + ' ' + ISNULL(snombre,'') + ' ' + ISNULL(papellido,'') + ' ' + ISNULL(sapellido,'')) FROM dbo.tbl_usuarios WHERE identificacion = ?", (id_prof,))
                        row_s = c_s.fetchone()
                        conn_s.close()
                        if row_s and row_s[0]:
                            nom_prof = apply_fn_limpieza(row_s[0]).strip().title()
                    except Exception:
                        pass
                if not nom_prof:
                    nom_prof = f"Dr/a. {id_prof}"

                meta = {
                    "sede": sede,
                    "fecha_cita": f_str,
                    "hora_cita": h_str,
                    "programa": prog,
                    "id_profesional": id_prof,
                    "nombre_profesional": nom_prof
                }
                _CITA_META_CACHE[cid] = meta
                return meta
    except Exception as e_sql:
        print(f"[get_cita_metadata SQL Warning]: {e_sql}")

    return {}

def save_feedback_record(id_cita, estado, observacion, auditor, cedula_auditor="", client_ip="", os_user="", host_name="", estado_phc="", nota_aclaratoria=None, sede="", fecha_cita="", hora_cita="", programa="", id_profesional="", nombre_profesional=""):
    if estado_phc == "Atendido en IPSA / Finalizada":
        estado_phc = "Finalizada"
        if not nota_aclaratoria:
            estado = "Finalizada"
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cid_str = str(id_cita)

    if not (sede and fecha_cita and hora_cita and programa and id_profesional and nombre_profesional):
        meta = get_cita_metadata(id_cita)
        sede = sede or meta.get("sede", "")
        fecha_cita = fecha_cita or meta.get("fecha_cita", "")
        hora_cita = hora_cita or meta.get("hora_cita", "")
        programa = programa or meta.get("programa", "")
        id_profesional = id_profesional or meta.get("id_profesional", "")
        nombre_profesional = nombre_profesional or meta.get("nombre_profesional", "")

    rec = {
        "id_cita": cid_str,
        "estado": estado,
        "nota_aclaratoria": nota_aclaratoria if nota_aclaratoria is not None else estado,
        "estado_phc": estado_phc,
        "observacion": observacion,
        "auditor": auditor,
        "cedula_auditor": str(cedula_auditor),
        "fecha_gestion": timestamp,
        "ip_equipo": client_ip,
        "usuario_pc": os_user,
        "nombre_equipo": host_name,
        "sede": sede,
        "fecha_cita": fecha_cita,
        "hora_cita": hora_cita,
        "programa": programa,
        "id_profesional": str(id_profesional),
        "nombre_profesional": nombre_profesional,
        "synced": False
    }
    with _FEEDBACK_LOCK:
        fb = {}
        if os.path.exists(FEEDBACK_FILE):
            try:
                with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
                    fb = json.load(f)
            except Exception:
                fb = {}

        # Opción 2: Historial / trazabilidad de re-auditorías previas
        existing = fb.get(cid_str)
        historial = []
        if existing:
            historial = list(existing.get("historial", []))
            prev_entry = {
                "estado": existing.get("estado", ""),
                "nota_aclaratoria": existing.get("nota_aclaratoria", ""),
                "estado_phc": existing.get("estado_phc", ""),
                "observacion": existing.get("observacion", ""),
                "auditor": existing.get("auditor", ""),
                "fecha_gestion": existing.get("fecha_gestion", "")
            }
            if prev_entry["auditor"] or prev_entry["estado_phc"] or prev_entry["estado"]:
                historial.append(prev_entry)
        rec["historial"] = historial

        fb[cid_str] = rec
        with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
            json.dump(fb, f, ensure_ascii=False, indent=2)

    # Disparar respaldo automático diario
    try:
        backup_feedback_store()
    except Exception:
        pass

    # Intentar sincronizar en segundo plano de forma asíncrona (no bloquea el cliente HTTP)
    cfg = load_config()
    url = cfg.get("google_sheets_apps_script_url")
    if url:
        threading.Thread(target=push_record_to_google_sheets, args=(url, rec), daemon=True).start()
        
    return rec


def save_feedback_records_batch(ids_citas, estado, observacion, auditor, cedula_auditor="", client_ip="", os_user="", host_name="", estado_phc="", nota_aclaratoria=None, records_meta=None):
    if estado_phc == "Atendido en IPSA / Finalizada":
        estado_phc = "Finalizada"
        if not nota_aclaratoria:
            estado = "Finalizada"
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    saved_records = []
    if records_meta is None:
        records_meta = {}

    with _FEEDBACK_LOCK:
        fb = {}
        if os.path.exists(FEEDBACK_FILE):
            try:
                with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
                    fb = json.load(f)
            except Exception:
                fb = {}

        for id_cita in ids_citas:
            cid = str(id_cita).strip()
            if not cid:
                continue

            meta = records_meta.get(cid) or get_cita_metadata(cid)
            r_sede = meta.get("sede", "")
            r_fecha = meta.get("fecha_cita", "")
            r_hora = meta.get("hora_cita", "")
            r_prog = meta.get("programa", "")
            r_idprof = meta.get("id_profesional", "")
            r_nomprof = meta.get("nombre_profesional", "")

            # Opción 2: Trazabilidad histórica en auditorías por lote
            existing = fb.get(cid)
            historial = []
            if existing:
                historial = list(existing.get("historial", []))
                prev_entry = {
                    "estado": existing.get("estado", ""),
                    "nota_aclaratoria": existing.get("nota_aclaratoria", ""),
                    "estado_phc": existing.get("estado_phc", ""),
                    "observacion": existing.get("observacion", ""),
                    "auditor": existing.get("auditor", ""),
                    "fecha_gestion": existing.get("fecha_gestion", "")
                }
                if prev_entry["auditor"] or prev_entry["estado_phc"] or prev_entry["estado"]:
                    historial.append(prev_entry)

            rec = {
                "id_cita": cid,
                "estado": estado,
                "nota_aclaratoria": nota_aclaratoria if nota_aclaratoria is not None else estado,
                "estado_phc": estado_phc,
                "observacion": observacion,
                "auditor": auditor,
                "cedula_auditor": str(cedula_auditor),
                "fecha_gestion": timestamp,
                "ip_equipo": client_ip,
                "usuario_pc": os_user,
                "nombre_equipo": host_name,
                "sede": r_sede,
                "fecha_cita": r_fecha,
                "hora_cita": r_hora,
                "programa": r_prog,
                "id_profesional": str(r_idprof),
                "nombre_profesional": r_nomprof,
                "historial": historial,
                "synced": False
            }
            fb[cid] = rec
            saved_records.append(rec)

        with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
            json.dump(fb, f, ensure_ascii=False, indent=2)

    # Disparar respaldo automático diario
    try:
        backup_feedback_store()
    except Exception:
        pass

    cfg = load_config()
    url = cfg.get("google_sheets_apps_script_url")
    if url and saved_records:
        real_to_push = [r for r in saved_records if not str(r.get("id_cita", "")).startswith("test_") and r.get("auditor") != "Test Runner" and "prueba" not in str(r.get("auditor", "")).lower()]
        if real_to_push:
            threading.Thread(target=push_batch_to_google_sheets, args=(url, real_to_push), daemon=True).start()

    return saved_records


def push_batch_to_google_sheets(url, records):
    try:
        real_records = [r for r in records if not str(r.get("id_cita", "")).startswith("test_") and r.get("auditor") != "Test Runner" and "prueba" not in str(r.get("auditor", "")).lower()]
        if not real_records:
            return True
        payload = {
            "action": "save_batch_feedback",
            "records": real_records
        }
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        with _urlopen(req, timeout=30) as resp:
            res_body = resp.read().decode('utf-8')
            res_json = json.loads(res_body)
            if res_json.get("result") == "success":
                with _FEEDBACK_LOCK:
                    fb = {}
                    if os.path.exists(FEEDBACK_FILE):
                        try:
                            with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
                                fb = json.load(f)
                        except Exception:
                            fb = {}
                    for rec in real_records:
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
    cid = str(record.get("id_cita", "")).strip()
    aud = str(record.get("auditor", "")).strip()
    if cid.startswith("test_") or cid.startswith("TEST_") or aud == "Test Runner" or "prueba" in aud.lower():
        return True
    try:
        data = json.dumps(record).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        with _urlopen(req, timeout=10) as resp:
            res_body = resp.read().decode('utf-8')
            res_json = json.loads(res_body)
            if res_json.get("result") == "success":
                record["synced"] = True
                with _FEEDBACK_LOCK:
                    fb = {}
                    if os.path.exists(FEEDBACK_FILE):
                        try:
                            with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
                                fb = json.load(f)
                        except Exception:
                            fb = {}
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
        with _urlopen(req, timeout=30) as resp:
            res_body = resp.read().decode('utf-8')
            res_json = json.loads(res_body)
            if res_json.get("result") == "success":
                records = res_json.get("records", [])
                with _FEEDBACK_LOCK:
                    existing_fb = {}
                    if os.path.exists(FEEDBACK_FILE):
                        try:
                            with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
                                existing_fb = json.load(f)
                        except Exception:
                            existing_fb = {}

                    # Conservar únicamente registros pendientes por sincronizar
                    new_fb = {k: v for k, v in existing_fb.items() if v.get("synced") is False}

                    # Cargar los registros vigentes de Google Sheets descartando pruebas y filas vacías
                    for rec in records:
                        cid = str(rec.get("id_cita", "")).strip()
                        aud = str(rec.get("auditor", "")).strip()
                        est_val = str(rec.get("estado", "") or "").strip()
                        phc_val = str(rec.get("estado_phc", "") or "").strip()
                        if not cid or cid == "None":
                            continue
                        if not est_val and not phc_val:
                            continue
                        if cid.startswith("test_") or cid.startswith("TEST_") or "prueba" in aud.lower() or aud == "Test Runner":
                            continue
                        rec["synced"] = True
                        if not rec.get("sede"):
                            meta = get_cita_metadata(cid)
                            rec["sede"] = meta.get("sede", "")
                            rec["fecha_cita"] = meta.get("fecha_cita", "")
                            rec["hora_cita"] = meta.get("hora_cita", "")
                            rec["programa"] = meta.get("programa", "")
                            rec["id_profesional"] = meta.get("id_profesional", "")
                            rec["nombre_profesional"] = meta.get("nombre_profesional", "")
                        new_fb[cid] = rec

                    with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
                        json.dump(new_fb, f, ensure_ascii=False, indent=2)
                    print(f"[Google Sheets Sync] Sincronizados exitosamente {len(new_fb)} registros reales desde Google Sheets.")
                    return new_fb
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


