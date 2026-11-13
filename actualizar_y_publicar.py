# -*- coding: utf-8 -*-
"""
actualizar_y_publicar.py
========================
Script automatizado para:
1. Sincronizar auditorías desde Google Sheets hacia feedback_store.json y static/api/feedback.json (.gz).
2. Extraer datos vigentes de SQL Server (Agendaweb, PHC post-corte, BDSVCES, BDSAP) con reglas exactas de PowerQuery.
3. Regenerar sql_cache.pkl, db_signature.json y los paquetes JSON comprimidos en static/api/.
4. Actualizar versión y fecha en version.json, index.html y static/index.html.
5. Subir atómicamente a GitHub vía API REST y verificar compilación en GitHub Pages.
6. Guardar trazabilidad y logs en registro_actualizacion.log.

Diseñado para ejecutarse manualmente o de forma desatendida mediante el Programador de Tareas de Windows.
"""

import sys
import os
import json
import base64
import urllib.request
import urllib.error
import ssl
import time
import gzip
import argparse
from datetime import datetime

# Directorio raíz del proyecto
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)
sys.path.insert(0, BASE_DIR)

LOG_FILE = os.path.join(BASE_DIR, "registro_actualizacion.log")

def log(msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{timestamp}] {msg}"
    print(formatted, flush=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f_log:
            f_log.write(formatted + "\n")
    except Exception:
        pass

def run_step_etl():
    log("=== PASO 1: EJECUTANDO ETL Y REGENERACIÓN DE CACHÉ SQL ===")
    t0 = time.time()
    
    # Importar y ejecutar la lógica de run_real_etl
    etl_script = os.path.join(BASE_DIR, "run_real_etl.py")
    import subprocess
    res = subprocess.run([sys.executable, etl_script], capture_output=True, text=True, encoding="utf-8")
    
    if res.returncode != 0:
        log(f"[ERROR] Falló la ejecución de run_real_etl.py (código {res.returncode}):")
        log(res.stderr[-1000:] if res.stderr else res.stdout[-1000:])
        return False
    
    # Extraer líneas clave del output
    for line in res.stdout.splitlines():
        if "RESULTADO FINAL" in line or "Total filas" in line or "Total pendientes" in line or "Auditorías sincronizadas" in line or "Guardado sql_cache.pkl" in line:
            log("   " + line.strip())
            
    log(f"ETL completado exitosamente en {time.time() - t0:.2f} segundos.")
    return True

def ensure_feedback_static():
    log("=== PASO 2: VERIFICANDO ARCHIVOS DE AUDITORÍAS EN STATIC/API ===")
    fb_store = os.path.join(BASE_DIR, "feedback_store.json")
    if not os.path.exists(fb_store):
        log("[Aviso] feedback_store.json no existe aún.")
        return 0
    
    with open(fb_store, "r", encoding="utf-8") as f:
        fb = json.load(f)
    
    out_fb = os.path.join(BASE_DIR, "static", "api", "feedback.json")
    with open(out_fb, "w", encoding="utf-8") as f:
        json.dump(fb, f, ensure_ascii=False, indent=2)
    
    gz_path = out_fb + ".gz"
    with open(gz_path, "wb") as f_gz:
        f_gz.write(gzip.compress(json.dumps(fb, ensure_ascii=False, separators=(',', ':')).encode("utf-8"), compresslevel=9))
    
    log(f"static/api/feedback.json y .gz actualizados con {len(fb):,} registros ({os.path.getsize(out_fb):,} B / {os.path.getsize(gz_path):,} B).")
    return len(fb)

def bump_version_info(total_rows=0, total_audits=0):
    log("=== PASO 3: ACTUALIZANDO CONTROL DE VERSIÓN Y METADATOS ===")
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    today_stamp = now.strftime("%Y%m%d")
    
    MESES_ES = {
        1: "enero", 2: "febrero", 3: "marzo", 4: "abril", 5: "mayo", 6: "junio",
        7: "julio", 8: "agosto", 9: "septiembre", 10: "octubre", 11: "noviembre", 12: "diciembre"
    }
    fecha_humana = f"{now.day} de {MESES_ES[now.month]} de {now.year}"
    
    ver_file = os.path.join(BASE_DIR, "version.json")
    cur_semver = "1.02.011"
    if os.path.exists(ver_file):
        try:
            with open(ver_file, "r", encoding="utf-8") as f:
                vdata = json.load(f)
                cur_semver = vdata.get("semver", cur_semver)
        except Exception:
            pass
    
    # Extraer componentes semver e incrementar patch
    parts = cur_semver.split(".")
    major = parts[0] if len(parts) > 0 else "1"
    minor = parts[1] if len(parts) > 1 else "02"
    patch = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 11
    patch += 1
    
    semver = f"{major}.{minor}.{patch:03d}"
    ver_code = f"{today_stamp}_V01_{semver}"
    
    msg = f"v{semver}: Actualización de caché SQL ({total_rows:,} filas) y {total_audits:,} auditorías ({today_str})"
    vinfo = {
        "version": ver_code,
        "semver": semver,
        "updated_at": now.isoformat(),
        "message": msg
    }
    
    for vf in [ver_file, os.path.join(BASE_DIR, "static", "version.json")]:
        with open(vf, "w", encoding="utf-8") as f:
            json.dump(vinfo, f, indent=2, ensure_ascii=False)
            
    # Actualizar badge de versión y fecha en index.html y static/index.html
    import re
    for html_name in ["index.html", os.path.join("static", "index.html")]:
        html_path = os.path.join(BASE_DIR, html_name)
        if os.path.exists(html_path):
            with open(html_path, "r", encoding="utf-8") as f_h:
                content = f_h.read()
            # Actualizar id="appVersionBadge"
            content = re.sub(
                r'(<span class="header-version-pill"[^>]*id="appVersionBadge"[^>]*>)[^<]*(</span>)',
                rf'\g<1>v{semver}\g<2>',
                content
            )
            # Actualizar fecha de actualización
            content = re.sub(
                r'(<div class="date-tag"[^>]*id="updateDate">)[^<]*(<br><small>Fecha de actualización</small>)',
                rf'\g<1>{fecha_humana}\g<2>',
                content
            )
            # Actualizar cache-busters
            content = re.sub(r'(\?v=)[0-9]{8}_V[0-9]{2}_[0-9]+\.[0-9]+\.[0-9]+', rf'\g<1>{ver_code}', content)
            with open(html_path, "w", encoding="utf-8") as f_h:
                f_h.write(content)

    # Actualizar APP_CURRENT_VERSION en static/app.js
    app_js_path = os.path.join(BASE_DIR, "static", "app.js")
    if os.path.exists(app_js_path):
        with open(app_js_path, "r", encoding="utf-8") as f_js:
            js_content = f_js.read()
        js_content = re.sub(r'const APP_CURRENT_VERSION = "[^"]+";', f'const APP_CURRENT_VERSION = "{ver_code}";', js_content)
        js_content = re.sub(r'const APP_SEMVER = "[^"]+";', f'const APP_SEMVER = "{semver}";', js_content)
        js_content = re.sub(r'(\?v=)[0-9]{8}_V[0-9]{2}_[0-9]+\.[0-9]+\.[0-9]+', rf'\g<1>{ver_code}', js_content)
        with open(app_js_path, "w", encoding="utf-8") as f_js:
            f_js.write(js_content)
            
    log(f"Versión establecida: {ver_code} (v{semver}) - Fecha: {fecha_humana}")
    return semver, msg

def push_to_github(commit_msg):
    log("=== PASO 4: SUBIENDO CAMBIOS ATÓMICAMENTE A GITHUB ===")
    from google_sheets import load_db_config, _urlopen
    
    gh_cfg = load_db_config().get("github", {})
    token = gh_cfg.get("token")
    repo = gh_cfg.get("repo", "unionsaludvida2/cierredehistorias")
    branch = gh_cfg.get("branch", "main")
    
    if not token:
        log("[ERROR] No hay token de GitHub configurado en db_config.json.")
        return False
        
    headers = {
        "User-Agent": "Antigravity-Sync-Agent",
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}"
    }
    
    def api_call(url, data=None, method="GET", timeout=60):
        req_data = json.dumps(data).encode("utf-8") if data else None
        req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
        with _urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
            
    files_to_commit = [
        "version.json",
        "static/version.json",
        "index.html",
        "static/index.html",
        "static/app.js",
        "run_real_etl.py",
        "actualizar_y_publicar.py",
        "actualizar_diario.bat",
        "programar_tarea_windows.bat",
        "programar_tarea.ps1",
        "static/api/feedback.json",
        "static/api/feedback.json.gz",
        "static/api/dashboard_ultimo_mes.json",
        "static/api/dashboard_ultimo_mes.json.gz",
        "static/api/dashboard.json",
        "static/api/dashboard.json.gz",
        "static/api/dashboard_fechas_previas.json",
        "static/api/dashboard_fechas_previas.json.gz",
        "static/api/dashboard_ambos.json",
        "static/api/dashboard_ambos.json.gz"
    ]
    
    if os.path.exists(os.path.join(BASE_DIR, "cencos_cache.json")):
        files_to_commit.append("cencos_cache.json")
    if os.path.exists(os.path.join(BASE_DIR, "README.md")):
        files_to_commit.append("README.md")
        
    # Filtrar solo archivos existentes
    valid_files = [f for f in files_to_commit if os.path.exists(os.path.join(BASE_DIR, f.replace("/", os.sep)))]
    log(f"Total archivos a comitear en {repo}:{branch}: {len(valid_files)}")
    
    try:
        # 1. Obtener último commit
        ref_data = api_call(f"https://api.github.com/repos/{repo}/git/ref/heads/{branch}")
        parent_commit_sha = ref_data["object"]["sha"]
        
        # 2. Obtener base tree
        commit_data = api_call(f"https://api.github.com/repos/{repo}/git/commits/{parent_commit_sha}")
        base_tree_sha = commit_data["tree"]["sha"]
        
        # 3. Crear blobs
        tree_items = []
        for rel_path in valid_files:
            full_path = os.path.join(BASE_DIR, rel_path.replace("/", os.sep))
            with open(full_path, "rb") as fp:
                file_bytes = fp.read()
            b64_content = base64.b64encode(file_bytes).decode("utf-8")
            
            blob_res = api_call(f"https://api.github.com/repos/{repo}/git/blobs", data={
                "content": b64_content,
                "encoding": "base64"
            }, method="POST", timeout=120)
            
            tree_items.append({
                "path": rel_path,
                "mode": "100644",
                "type": "blob",
                "sha": blob_res["sha"]
            })
            
        # 4. Crear nuevo tree
        new_tree_res = api_call(f"https://api.github.com/repos/{repo}/git/trees", data={
            "base_tree": base_tree_sha,
            "tree": tree_items
        }, method="POST")
        new_tree_sha = new_tree_res["sha"]
        
        # 5. Crear commit
        new_commit_res = api_call(f"https://api.github.com/repos/{repo}/git/commits", data={
            "message": commit_msg,
            "tree": new_tree_sha,
            "parents": [parent_commit_sha]
        }, method="POST")
        new_commit_sha = new_commit_res["sha"]
        
        # 6. Actualizar rama
        api_call(f"https://api.github.com/repos/{repo}/git/refs/heads/{branch}", data={
            "sha": new_commit_sha,
            "force": False
        }, method="PATCH")
        
        log(f"Commit subido exitosamente a GitHub: {new_commit_sha[:8]}")
        
        # 7. Monitoreo de GitHub Pages
        log("Monitoreando estado de despliegue en GitHub Pages...")
        time.sleep(5)
        for attempt in range(10):
            time.sleep(6)
            try:
                b = api_call(f"https://api.github.com/repos/{repo}/pages/builds/latest")
                status = b.get("status")
                c_sha = (b.get("commit") or "")[:8]
                log(f"   Estado Pages intento {attempt+1}: {status} (Commit: {c_sha})")
                if status == "built":
                    log(">>> ¡DESPLIEGUE EN GITHUB PAGES EXITOSO! <<<")
                    break
                elif status == "errored":
                    log("[Aviso] Pages errored, solicitando reconstrucción...")
                    api_call(f"https://api.github.com/repos/{repo}/pages/builds", data={}, method="POST")
            except Exception as e_p:
                log(f"   Aviso consultando Pages: {e_p}")
                
        return True
    except Exception as e:
        log(f"[ERROR] Error al subir commit a GitHub: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Actualización y publicación automática de datos")
    parser.add_argument("--no-push", action="store_true", help="No subir a GitHub, solo actualizar caché local")
    parser.add_argument("--message", type=str, default=None, help="Mensaje de commit personalizado")
    args = parser.parse_args()
    
    start_total = time.time()
    log("=================================================================")
    log(" INICIANDO PROCESO AUTOMATIZADO DE ACTUALIZACIÓN DE DATOS")
    log("=================================================================")
    
    # 1. Ejecutar ETL de base de datos
    etl_ok = run_step_etl()
    if not etl_ok:
        log("[FALLO] El proceso se detuvo debido a un error en el ETL.")
        sys.exit(1)
        
    # 2. Sincronizar y comprimir feedback
    audits_count = ensure_feedback_static()
    
    # 3. Leer total de pendientes de sql_cache.pkl
    total_pendientes = 0
    try:
        import pickle
        with open(os.path.join(BASE_DIR, "sql_cache.pkl"), "rb") as fp:
            pack = pickle.load(fp)
            if isinstance(pack, dict) and "pendientes" in pack:
                total_pendientes = len(pack["pendientes"])
    except Exception:
        pass
        
    # 4. Actualizar versión
    semver, auto_msg = bump_version_info(total_rows=total_pendientes, total_audits=audits_count)
    commit_msg = args.message if args.message else auto_msg
    
    # 5. Subir a GitHub
    if args.no_push:
        log("[INFO] Parámetro --no-push activado. Los datos fueron actualizados localmente sin subir a GitHub.")
    else:
        push_ok = push_to_github(commit_msg)
        if not push_ok:
            log("[ALERTA] Los datos locales se actualizaron pero hubo un problema al sincronizar con GitHub.")
            sys.exit(2)
            
    total_elapsed = time.time() - start_total
    log(f"=================================================================")
    log(f" PROCESO COMPLETADO EXITOSAMENTE EN {total_elapsed:.2f}s")
    log(f" Total filas procesadas: {total_pendientes:,} | Auditorías: {audits_count:,}")
    log(f"=================================================================")
    sys.exit(0)

if __name__ == "__main__":
    main()

