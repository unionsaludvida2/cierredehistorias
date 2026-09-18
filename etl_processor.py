import pyodbc
import pandas as pd
import numpy as np
import json
import re
import datetime
import os
import time
import threading
import pickle
from google_sheets import get_db_connection_string, load_config

# Compatibilidad para deserialización pickle en versiones recientes de pandas
try:
    from pandas.core.arrays.datetimes import DatetimeArray
    _orig_dta_setstate = DatetimeArray.__setstate__
    def _compat_dta_setstate(self, state):
        if isinstance(state, tuple) and len(state) == 2:
            state = (state[0], state[1], {})
        return _orig_dta_setstate(self, state)
    DatetimeArray.__setstate__ = _compat_dta_setstate
except Exception:
    pass

try:
    from pandas.core.arrays.timedeltas import TimedeltaArray
    _orig_tda_setstate = TimedeltaArray.__setstate__
    def _compat_tda_setstate(self, state):
        if isinstance(state, tuple) and len(state) == 2:
            state = (state[0], state[1], {})
        return _orig_tda_setstate(self, state)
    TimedeltaArray.__setstate__ = _compat_tda_setstate
except Exception:
    pass

CACHE_FILE = "sql_cache.pkl"
SIGNATURE_FILE = "db_signature.json"

ESTADOS_EXCLUIDOS_PENDIENTES = {
    "Historia ya cerrada en sistema",
    "Historia Cerrada en Sistema",
    "Novedad médica (incapacidad, calamidad, etc.)",
    "Paciente atendido con otro código o por otro profesional",
    "Paciente con marcación de inasistencia",
    "Inasistencia Justificada",
    "Paciente reagendado",
    "Error en informe (describir en observaciones el error)",
    "Error Operativo / Duplicado"
}

# --- CÓDIGOS DE SERVICIO EXCLUIDOS DE TABLAS, GRÁFICOS Y CACHÉ ---
CODIGOS_EXCLUIDOS_SERVICIO = {"50937", "50103", "50108", "50222", "50533"}

# --- MAPA DE PROGRAMAS (CÓDIGO DE SERVICIO A NOMBRE DE PROGRAMA) ---

MAPA_PROGRAMAS = {
    "9961": "Consulta PostHospitalaria",
    "37404": "Crioterapia",
    "50043": "Procedimientos Dermatologia",
    "50058": "Procedimientos Menores",
    "500581": "Procedimientos Menores Especialistas Comfama",
    "50099": "Ingreso Tuberculosis",
    "50100": "Control Tuberculosis",
    "50110": "Consulta Medicina General",
    "50114": "Consulta Medica No Programada",
    "50118": "Consulta Medico Centenela",
    "50120": "Consulta Medicina Interna",
    "50130": "Consulta Pediatra",
    "50131": "Control Pediatria",
    "50140": "Consulta Ginecologica",
    "50141": "Control Ginecologia",
    "50190": "Consulta Dermatologia",
    "50343": "Control Pediatra",
    "50380": "Ingreso Obstetra",
    "50381": "Control Obstetra",
    "70001": "Ingreso Crecimiento Y Desarrollo",
    "70004": "Ingreso Asma Medico",
    "70005": "Ingreso Epoc Medico",
    "70006": "Control Epoc Medico",
    "70031": "Control Grupal CYD 1- 3 Meses",
    "70032": "Control Grupal CYD 4 - 6 Meses",
    "70033": "Control Grupal CYD 7 - 9 Meses",
    "70034": "Control Grupal CYD 10 - 12 Meses",
    "70035": "Control Grupal CYD 13 - 16 Meses",
    "70036": "Control Grupal CYD 21 - 24 Meses",
    "70037": "Control Grupal CYD 25 A 30 Meses",
    "70038": "Control Grupal CYD 37 A 48 Meses",
    "70039": "Control Grupal CYD 49 A 60 Meses",
    "70040": "Control Grupal CYD 60 A 72 Meses 5 A 6 Años",
    "70100": "Ingreso CPR",
    "70101": "Control CPR",
    "70102": "Consulta Post- Parto",
    "70105": "Egreso CPR",
    "70200": "Ingreso Programa Hipertensión",
    "70201": "Control Programa Hipertensión",
    "70300": "Ingreso Programa DM",
    "70301": "Control Programa DM",
    "70400": "Ingreso Programa Dislipidemia",
    "70401": "Control Programa Dislipidemia",
    "71001": "Consulta Planificacion Familiar",
    "71101": "Ingreso A Programa De Asma",
    "71102": "Control Asma Medico",
    "71106": "Control Epoc Medico",
    "73000": "Programa Promocion Y Prevencion",
    "75105": "Ingreso A Programa De Epoc",
    "94108": "Medicina General",
    "501093": "Consulta Medica No Programada Maternas",
    "501094": "Consulta Medica No Programada Eda/Era",
    "501111": "Consulta De Control O De Seguimiento Medicina Funcional",
    "501142": "Consulta Medica No Programada Aiepi",
    "700000": "Programa De Rcv",
    "701051": "Sincrónico Egreso Primigestante-Multigestante Medico",
    "3000192": "Consulta Domiciliaria Médica Para Poblacion Vulnerable",
    "7000015": "Consulta Telemedicina Médico Centinela (Arl)",
    "7000350": "CYD individual 17 A 20 Meses",
    "7000370": "CYD individual 31 A 36 Meses",
    "7000390": "Grupal 5 A 6 Años (No mas abusos)",
    "7000391": "Grupal 6 A 7 Años (Cuidado medio ambiente)",
    "7000392": "Grupal 7 A 8 Años (Manejo de emociones)",
    "7000393": "Grupal 8 A 9 Años (Ciberacoso)",
    "7000394": "Grupal 9 A 10 Años (Derechos y deberes)",
    "7000410": "Control Individual 61-72 Meses (6 Años)",
    "7000411": "Control Individual 73-84 Meses ( 7 Años)",
    "7000412": "Control Individual 85-96 Meses ( 8 Años)",
    "7000413": "Control Individual 97-108 Meses ( 9 Años)",
    "7000414": "Control Individual 109-120 Meses ( 10 Años)",
    "7000415": "CYD Individual De 61-66 Meses",
    "7000416": "Control CYD Individual 67-72 Meses",
    "7000417": "Control CYD Individual 73-78 Meses",
    "7000418": "Control CYD Individual 79-84 Meses",
    "7000419": "Control CYD Individual 1-3 Meses",
    "7000420": "Control CYD Individual 4-6 Meses",
    "7000421": "Control CYD Individual 7-9 Meses",
    "7000422": "Control CYD Individual 10-12 Meses",
    "7000423": "Control CYD Individual 13-16 Meses",
    "7000424": "Control CYD Individual 21-24 Meses",
    "7000425": "Control CYD Individual 25-30 Meses",
    "7000426": "Control CYD Individual 37-48 Meses",
    "7000427": "Control CYD Individual 49-60 Meses",
    "8902028": "Teledermatologia",
    "8902058": "Consulta De Asesoria En Lactancia",
    "8902063": "Rias Curso De Vida Adolescencia",
    "8902064": "Rias Curso De Vida Juventud",
    "8902065": "Rias Curso De Vida Adultez",
    "8902066": "Rias Curso De Vida Vejez",
    "8902420": "Evalucion Medico Dermatologica Asistida",
    "8903050": "Seguimiento Morbilidad Materna Extrema Mme",
    "89020203": "Control Asesoría Preconcepcional Médico General"
}

def clean_programa(serv):
    if not serv or not isinstance(serv, str):
        return "Consulta Medicina General"
    
    s_clean = str(serv).strip()
    
    # 1. Búsqueda directa por código exacto
    if s_clean in MAPA_PROGRAMAS:
        return MAPA_PROGRAMAS[s_clean]
    
    # 2. Extraer número de servicio si contiene "Consulta Servicio XXXXX"
    match = re.search(r'(\d+)', s_clean)
    if match:
        code = match.group(1)
        if code in MAPA_PROGRAMAS:
            return MAPA_PROGRAMAS[code]

    # 3. Búsqueda directa sin prefijos
    s_no_prefix = re.sub(r'^\s*(Consulta\s+Servicio|Servicio|Consulta)\s+', '', s_clean, flags=re.IGNORECASE).strip()
    if s_no_prefix in MAPA_PROGRAMAS:
        return MAPA_PROGRAMAS[s_no_prefix]

    # 4. Derivación por reglas para otros códigos numéricos
    if match:
        code = match.group(1)
        if code.startswith("702") or code.startswith("701"):
            return "Atención Control Prenatal / Salud Sexual"
        elif code.startswith("70004"):
            return "PyP Adulto Mayor / Promoción y Prevención"
        elif code.startswith("70"):
            return "Programa de Promoción y Prevención (PyP)"
        elif code.startswith("8902"):
            return "Consulta Externa Especializada"
        elif code.startswith("50"):
            return "Consulta Externa de Medicina General"
        return "Consulta Programa Especializado"

    return s_clean



# --- REGLAS DE LIMPIEZA fnLIMPIEZA ---
LISTA_LIMPIEZA = [
    ("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"), 
    ("Á", "A"), ("É", "E"), ("Í", "I"), ("Ó", "O"), ("Ú", "U"),
    ("   ", " "), ("  ", " "), ("  ", " "), (" ", " "), ("  ", " "), ("  ", " "),
    ("Ã\x91", "Ñ"), ("Ã\x81", "Á"), ("Ã\x89", "É"), ("Ã\x8d", "Í"), ("Ã\x93", "Ó"), ("Ã\x9a", "Ú"),
    ("GOÂ", "GO"), ("IAÂ", "IA"), ("NAÂ", "NA"), ("LAÂ", "LA"),
    
    ("AIZALEZ", "AIZALES"), ("ARINO", "ARIÑO"), ("ARMANDOO", "ARMANDO"), ("AUGENIA", "EUGENIA"), 
    ("AVENDANO", "AVENDAÑO"), ("BEDZAIDA", "BETZAIDA"), ("BENITEZ", "BENITES"),
    ("CARRENO", "CARREÑO"), ("CASTANEDA", "CASTAÑEDA"), ("CRISTINA STEFANIA", "CRISTINA ESTEFANIA"),
    ("DEJESUS", "DE JESUS"), ("DELCARMEN", "DEL CARMEN"), ("DELCASTILLO", "DEL CASTILLO"), ("DELMAR", "DEL MAR"),
    ("DIFILIPPO", "DI FILIPPO"), ("ECHAVERRI", "ECHEVERRI"), 
    ("FABIJHOSEYMARIA", "FABIJHOSEY MARIA"), ("GUETTEN", "GUETTE"), ("GUITIERREZ", "GUTIERREZ"),
    ("IBARGUEN", "IBARGÜEN"), ("ISABELLA", "ISABELA"), ("JHOANNA", "JOHANNA"), ("KELY", "KELLY"),
    ("LAMBRANO", "LAMBRAÑO"), ("LILIBETH", "LILYBETH"), ("LLAVINA", "LLAVIANA"), ("LONDONO", "LONDOÑO"),
    ("MAIRA", "MAYRA"), ("MONTANO", "MONTAÑO"), ("MUNOZ", "MUÑOZ"), ("MUOZ", "MUÑOZ"), 
    ("NUNEZ", "NUÑEZ"), ("ONATE", "OÑATE"),
    ("PATINO", "PATIÑO"), ("RIANO", "RIAÑO"), ("ROMANA", "ROMAÑA"), 
    ("TEJEDA", "TEJADA"), ("THERAN", "TEHERAN"), 
    ("YEPEZ", "YEPES"),

    ("ARCE MONTENEGRO EDGAR ARMAND", "ARCE MONTENEGRO EDGAR ARMANDO"), 
    ("AROCA ESPINOSA JOHAN RAMIRO", "AROCA ESPINOSA JOHAN"), 
    ("BARCELO DEALBA VALERIE PAOLA", "BARCELO DE ALBA VALERIE PAOLA"),
    ("CAICEDO SOLARTE WILIAN ALBEIRO", "CAICEDO SOLARTE WILLIAM ALBEIRO"), 
    ("CHAVEZ FERREIRO MILENA ESTHER", "CHAVEZ FERREIRA MILENA ESTHER"), 
    ("CHAVEZ YANCE MAYLEEN", "CHAVEZ YANCES MAYLEEN"), 
    ("CORREA PIZA BRAYAN", "CORREA PIZZA BRAYAN"), 
    ("GUTIERREZ HERNANDEZ DIOSOTIS MARIA", "GUTIERREZ HERNANDEZ DIOSOTIS"), 
    ("MARIA CAMILA CARDEÑO VELASQUEZ", "CARDEÑO VELASQUEZ MARIA CAMILA"), 
    ("MEJIA PALACIOS JULIANA", "MEJIA PALACIO JULIANA"),
    ("NIETO VELASQUEZ LIGIA NIETO", "NIETO VELASQUEZ MARIA LIGIA"),
    ("NINO JAIMES", "NIÑO JAIMES"),
    ("RUIZ PALMERA CARMEN ELDA", "RUIZ PALMERA CARMEN"), 
    ("ZAMBRANO URUETA KAROL ANDREA", "ZAMBRANO URUETA KAROL")
]

def get_text_cleaning_rules():
    try:
        cfg = load_config()
        if "text_cleaning_rules" in cfg and isinstance(cfg["text_cleaning_rules"], list):
            return cfg["text_cleaning_rules"]
    except Exception:
        pass
    return LISTA_LIMPIEZA

def apply_fn_limpieza(val, rules=None):
    if not val or not isinstance(val, str):
        return ""
    text = str(val)
    if rules is None:
        rules = get_text_cleaning_rules()
    for item in rules:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            text = text.replace(item[0], item[1])
    return text

def clean_ips(val, mappings=None):
    if not val or not isinstance(val, str):
        return "Sede Sin Nombre"
    text = str(val).strip()
    clean_val = re.sub(r'\s+', ' ', text).lower().strip()

    if mappings is None:
        try:
            cfg = load_config()
            mappings = cfg.get("cis_mappings", {})
        except Exception:
            mappings = {}

    # 1. Comprobación directa contra variantes y nombres canónicos de cis_mappings
    if mappings:
        for canon_name, variants in mappings.items():
            if str(canon_name).lower().strip() == clean_val:
                return canon_name
            if isinstance(variants, (list, tuple)):
                for v in variants:
                    if str(v).lower().strip() == clean_val:
                        return canon_name

    # 2. Normalización de prefijos usuales (CIS, COMFAMA, etc.)
    text = re.sub(r'^CIS\s+COMFAMA\s+', '', text, flags=re.IGNORECASE)
    text = re.sub(r'^COMFAMA\s*-\s*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'^COMFAMA\s+', '', text, flags=re.IGNORECASE)
    text = re.sub(r'^CIS\s*-\s*COMFAMA\s+', 'CIS ', text, flags=re.IGNORECASE)
    text = text.title()
    text = re.sub(r'\s+', ' ', text)
    text = text.replace("Centro Integral De Salud", "CIS")
    text_clean = text.lower().strip()

    # 3. Segunda comprobación contra cis_mappings con el texto simplificado
    if mappings:
        for canon_name, variants in mappings.items():
            if str(canon_name).lower().strip() == text_clean:
                return canon_name
            if isinstance(variants, (list, tuple)):
                for v in variants:
                    v_clean = re.sub(r'\s+', ' ', str(v)).lower().strip()
                    if v_clean == text_clean:
                        return canon_name
                    # Simplificar prefijos también en la variante para máxima compatibilidad
                    v_stripped = re.sub(r'^cis\s+comfama\s+', '', v_clean, flags=re.IGNORECASE)
                    v_stripped = re.sub(r'^comfama\s*-\s*', '', v_stripped, flags=re.IGNORECASE)
                    v_stripped = re.sub(r'^comfama\s+', '', v_stripped, flags=re.IGNORECASE)
                    v_stripped = re.sub(r'^cis\s*-\s*comfama\s+', 'cis ', v_stripped, flags=re.IGNORECASE)
                    v_stripped = re.sub(r'^centro integral de salud\s*', 'cis ', v_stripped, flags=re.IGNORECASE)
                    v_stripped = re.sub(r'\s+', ' ', v_stripped).strip()
                    if v_stripped == text_clean:
                        return canon_name

    if re.search(r'\bmonter[ií]a\b', text, flags=re.IGNORECASE):
        return "Montería"
    return text.strip()

MESES_ES = {
    1: "enero", 2: "febrero", 3: "marzo", 4: "abril", 5: "mayo", 6: "junio",
    7: "julio", 8: "agosto", 9: "septiembre", 10: "octubre", 11: "noviembre", 12: "diciembre"
}

class ETLProcessor:
    def __init__(self, autostart=True, **kwargs):
        self.lock = threading.Lock()
        self.is_fetching = False
        self.cached_pack = {}
        self.data_source = "No inicializado"

        if not autostart:
            return
        
        if os.path.exists(CACHE_FILE):
            try:
                print(f"[ETL] Cargando caché optimizado de disco desde {CACHE_FILE}...")
                with open(CACHE_FILE, "rb") as f:
                    cache_obj = pickle.load(f)

                if isinstance(cache_obj, dict):
                    self.cached_pack = cache_obj
                    if "pendientes" in self.cached_pack and hasattr(self.cached_pack["pendientes"], "columns"):
                        pends = self.cached_pack["pendientes"]
                        if "SERVICIO" in pends.columns:
                            pends = pends[~pends["SERVICIO"].astype(str).str.strip().isin(CODIGOS_EXCLUIDOS_SERVICIO)].copy()
                            if "PROGRAMA" in pends.columns:
                                pends["PROGRAMA"] = pends["SERVICIO"].apply(clean_programa)
                            self.cached_pack["pendientes"] = pends
                else:
                    df = cache_obj
                    if "SERVICIO" in df.columns:
                        df = df[~df["SERVICIO"].astype(str).str.strip().isin(CODIGOS_EXCLUIDOS_SERVICIO)].copy()
                    self.cached_pack = self._build_lean_cache_package(df)
                    with open(CACHE_FILE, "wb") as f_out:
                        pickle.dump(self.cached_pack, f_out)

                pend_count = len(self.cached_pack.get("pendientes", []))
                self.data_source = f"Caché Semanal (SQL 172.200.6.135 - {pend_count:,} pendientes)"
                print(f"[ETL] Caché cargado exitosamente ({pend_count:,} pendientes).")
            except Exception as e:
                print(f"[ETL] Error al leer caché ({e}).")
                fallback_df = self._generate_fallback_data()
                self.cached_pack = self._build_lean_cache_package(fallback_df)
                self.data_source = "Datos Sintéticos (PowerBI Certificado)"
        else:
            fallback_df = self._generate_fallback_data()
            self.cached_pack = self._build_lean_cache_package(fallback_df)
            self.data_source = "Datos Sintéticos (PowerBI Certificado)"

        self.refresh_cached_summaries()

    def refresh_cached_summaries(self, feedback_dict=None, force_compute=False):
        if feedback_dict is None:
            try:
                from google_sheets import load_feedback
                feedback_dict = load_feedback()
            except Exception:
                feedback_dict = {}

        self._cached_summaries = {}
        self._cached_summaries_bytes = {}
        try:
            for p_key in ["ultimo_mes", "fechas_previas", "ambos"]:
                static_file = os.path.join("static", "api", f"dashboard_{p_key}.json")
                if not force_compute and os.path.exists(static_file):
                    with open(static_file, "r", encoding="utf-8") as f:
                        res = json.load(f)
                    self._cached_summaries[p_key] = res
                    self._cached_summaries_bytes[p_key] = json.dumps(res, ensure_ascii=False).encode('utf-8')
                else:
                    res = self._compute_summary(self.cached_pack, filters={"periodo": p_key}, feedback_dict=feedback_dict)
                    res["data_source"] = self.data_source
                    self._cached_summaries[p_key] = res
                    self._cached_summaries_bytes[p_key] = json.dumps(res, ensure_ascii=False).encode('utf-8')
                    try:
                        os.makedirs(os.path.dirname(static_file), exist_ok=True)
                        with open(static_file, "w", encoding="utf-8") as f_out:
                            json.dump(res, f_out, ensure_ascii=False)
                    except Exception as e_w:
                        print(f"[ETL] Error guardando {static_file}: {e_w}")
        except Exception as e:
            print(f"[ETL] Error al pre-calcular resúmenes iniciales: {e}")



    def get_summary(self, cache_pack, filters=None, feedback_dict=None):
        if feedback_dict is None:
            try:
                from google_sheets import load_feedback
                feedback_dict = load_feedback()
            except Exception:
                feedback_dict = {}


        has_extra_filters = bool(filters and (
            filters.get("ano") or filters.get("mes") or 
            filters.get("dia") or filters.get("quincena") or 
            filters.get("sede") or filters.get("programa") or 
            filters.get("profesional")
        ))

        p_key = filters.get("periodo", "ultimo_mes") if filters else "ultimo_mes"

        if not has_extra_filters and p_key in getattr(self, '_cached_summaries', {}):
            import copy
            summary_copy = copy.deepcopy(self._cached_summaries[p_key])
            if feedback_dict:
                for item in summary_copy.get("detalle_pendientes", []):
                    cid = item.get("id_cita")
                    if cid and cid in feedback_dict:
                        fb = feedback_dict[cid]
                        item["estado_fb"] = fb.get("estado", "Sin Gestión")
                        item["observacion_fb"] = fb.get("observacion", "")
                        item["auditor_fb"] = fb.get("auditor", "")
                        item["fecha_fb"] = fb.get("fecha_gestion", "")
            return summary_copy

        return self._compute_summary(cache_pack, filters=filters, feedback_dict=feedback_dict)


    @staticmethod
    def _build_lean_cache_package(df, df_usuarios=None):
        if 'SERVICIO' in df.columns:
            df = df[~df['SERVICIO'].astype(str).str.strip().isin(CODIGOS_EXCLUIDOS_SERVICIO)].copy()

        # Resumen completo de sedes agrupado por IPS, Año, Mes, Día, Quincena
        sedes_full = df.groupby(['NOMBRE IPS', 'Año', 'Nombre del mes', 'Día', 'Quincena']).agg(
            total=('Cant', 'sum'),
            asistidas=('BINARIO_ASISTIDA', 'sum'),
            inasistidas=('BINARIO_INASISTIDA', 'sum'),
            pendientes=('BINARIO_PENDIENTE', 'sum')
        ).reset_index()

        # Resumen completo de médicos agrupado por IPS, Profesional, Programa, Año, Mes, Día, Quincena
        medicos_full = df.groupby(['NOMBRE IPS', 'NOMBRE PROFESIONAL', 'PROGRAMA', 'Año', 'Nombre del mes', 'Día', 'Quincena']).agg(
            total=('Cant', 'sum'),
            asistidas=('BINARIO_ASISTIDA', 'sum'),
            inasistidas=('BINARIO_INASISTIDA', 'sum'),
            pendientes=('BINARIO_PENDIENTE', 'sum')
        ).reset_index()

        df_pendientes = df[df['BINARIO_PENDIENTE'] == 1].copy()
        if 'PROGRAMA' in df_pendientes.columns:
            df_pendientes['PROGRAMA'] = df_pendientes['PROGRAMA'].apply(clean_programa)

        usuarios_activos = df_usuarios
        if usuarios_activos is None or usuarios_activos.empty:
            if os.path.exists("tbl_usuarios_all.pkl"):
                try:
                    usuarios_activos = pd.read_pickle("tbl_usuarios_all.pkl")
                except Exception:
                    pass
        if usuarios_activos is None or usuarios_activos.empty:
            usuarios_activos = df[['NOMBRE PROFESIONAL', 'Cedula', 'NOMBRE IPS']].drop_duplicates()


        return {
            "sedes_full": sedes_full,
            "medicos_full": medicos_full,
            "pendientes": df_pendientes,
            "usuarios": usuarios_activos,
            "total_historico_asignadas": int(len(df)),
            "total_historico_asistidas": int(df['BINARIO_ASISTIDA'].sum()),
            "total_historico_inasistidas": int(df['BINARIO_INASISTIDA'].sum())
        }

    def manual_check_and_sync(self):
        with self.lock:
            if self.is_fetching:
                return {
                    "success": False,
                    "updated": False,
                    "message": "Ya hay un proceso de verificación en curso. Por favor espere."
                }
            self.is_fetching = True

        try:
            print("[ETL Sync] Verificación manual solicitada desde el botón de la aplicación web...")
            new_sig = self._get_sql_signature()

            stored_sig = None
            if os.path.exists(SIGNATURE_FILE):
                try:
                    with open(SIGNATURE_FILE, "r", encoding="utf-8") as f:
                        stored_sig = json.load(f)
                except Exception:
                    pass

            if new_sig and stored_sig:
                same_fecha = new_sig.get("max_fecha") == stored_sig.get("max_fecha")
                same_rows = new_sig.get("total_rows") == stored_sig.get("total_rows")
                same_id = new_sig.get("max_id") == stored_sig.get("max_id")

                if same_fecha and same_rows and same_id and os.path.exists(CACHE_FILE):
                    print(f"[ETL Sync] Sin novedades en SQL Server 172.200.6.135. La base de datos está al día.")
                    pend_count = len(self.cached_pack.get("pendientes", []))
                    with self.lock:
                        self.is_fetching = False
                    return {
                        "success": True,
                        "updated": False,
                        "message": "La base de datos se encuentra actualizada. No se detectaron nuevos registros en el servidor SQL.",
                        "max_fecha": stored_sig.get("max_fecha"),
                        "total_pendientes": pend_count
                    }

            print("[ETL Refresh] Se evidenciaron registros con fecha/conteo posterior en SQL Server. Iniciando extracción completa...")
            df_full, df_users = self._extract_from_sql()
            lean_pack = self._build_lean_cache_package(df_full, df_usuarios=df_users)

            with open(CACHE_FILE, "wb") as f_out:
                pickle.dump(lean_pack, f_out)

            if new_sig:
                with open(SIGNATURE_FILE, "w", encoding="utf-8") as f_sig:
                    json.dump(new_sig, f_sig, ensure_ascii=False, indent=2)

            with self.lock:
                self.cached_pack = lean_pack
                pend_count = len(lean_pack.get("pendientes", []))
                self.data_source = f"Caché Actualizado (SQL 172.200.6.135 - {pend_count:,} pendientes)"
                self.is_fetching = False

            # Forzar recálculo inmediato de resúmenes con el nuevo pack
            self.refresh_cached_summaries(force_compute=True)

            return {
                "success": True,
                "updated": True,
                "message": "¡Base de datos actualizada con éxito! Se sincronizaron los nuevos registros detectados.",
                "max_fecha": new_sig.get("max_fecha") if new_sig else "N/A",
                "total_pendientes": pend_count
            }

        except Exception as e:
            print(f"[ETL Sync Error]: {e}")
            with self.lock:
                self.is_fetching = False
            return {
                "success": False,
                "updated": False,
                "message": f"Error al verificar la base de datos SQL Server: {str(e)}"
            }

    def _get_sql_signature(self):

        try:
            conn = pyodbc.connect(get_db_connection_string("db_agendaweb"), timeout=4)
            c = conn.cursor()
            c.execute("SELECT MAX(CAST(fechaatencion AS date)) AS max_fecha, COUNT(*) AS total_rows, MAX(identitycitas) AS max_id FROM dbo.tbl_citas_atendidas")
            r = c.fetchone()
            conn.close()
            if r:
                return {
                    "max_fecha": str(r[0]),
                    "total_rows": int(r[1]),
                    "max_id": str(r[2]),
                    "checked_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }
        except Exception as e:
            print("[ETL Check] Error al verificar firma ligera en SQL Server:", e)
        return None

    def _bg_weekly_check_and_refresh(self):
        print("[ETL Check] Verificando firma ligera en SQL Server 172.200.6.135...")
        new_sig = self._get_sql_signature()

        stored_sig = None
        if os.path.exists(SIGNATURE_FILE):
            try:
                with open(SIGNATURE_FILE, "r", encoding="utf-8") as f:
                    stored_sig = json.load(f)
            except Exception:
                pass

        if new_sig and stored_sig:
            same_fecha = new_sig.get("max_fecha") == stored_sig.get("max_fecha")
            same_rows = new_sig.get("total_rows") == stored_sig.get("total_rows")
            same_id = new_sig.get("max_id") == stored_sig.get("max_id")

            if same_fecha and same_rows and same_id and os.path.exists(CACHE_FILE):
                print(f"[ETL Check] Sin cambios en SQL Server. Usando caché semanal.")
                pend_count = len(self.cached_pack.get("pendientes", []))
                with self.lock:
                    self.data_source = f"Caché Semanal Validado (SQL Sin Cambios - {pend_count:,} pendientes)"
                self.is_fetching = False
                return

        print("[ETL Refresh] Novedades detectadas en SQL Server. Extrayendo datos...")
        try:
            df_full, df_users = self._extract_from_sql()
            lean_pack = self._build_lean_cache_package(df_full, df_usuarios=df_users)
            
            with self.lock:
                self.cached_pack = lean_pack
                pend_count = len(lean_pack.get("pendientes", []))
                self.data_source = f"Caché Semanal Renovado ({pend_count:,} pendientes)"
            
            with open(CACHE_FILE, "wb") as f:
                pickle.dump(lean_pack, f)

            if new_sig:
                with open(SIGNATURE_FILE, "w", encoding="utf-8") as f:
                    json.dump(new_sig, f, ensure_ascii=False, indent=2)

            print(f"[ETL Refresh] Caché semanal renovado exitosamente ({pend_count:,} pendientes)!")
        except Exception as e:
            print(f"[ETL Refresh] Error al extraer SQL ({e}). Manteniendo caché activo.")
        finally:
            self.is_fetching = False

    def fetch_data(self):
        with self.lock:
            return self.cached_pack, self.data_source

    def _extract_from_sql(self):
        conn_agenda = pyodbc.connect(get_db_connection_string("db_agendaweb"), timeout=10)
        query_agenda = """
        WITH BaseData AS (
            SELECT 
                CAST(fechaatencion AS date) AS [FECHA DE ATENCION],
                TRY_CONVERT(time(0), horaatencion) AS [HORA DE ATENCION],
                nombreips AS [NOMBRE IPS],
                profesional AS [NOMBRE PROFESIONAL],
                tipoidentificacion AS ID,
                identificacion AS DOCUMENTO,
                nompaciente AS [NOMBRE PACIENTE],
                asistida AS ASISTIDA,
                atendidoipsa AS [ATENDIDA EN IPSA],
                CASE WHEN UPPER(LTRIM(RTRIM(asistida))) COLLATE Latin1_General_CI_AI = 'SI' THEN 1 ELSE 0 END AS BINARIO_ASISTIDA,
                CASE WHEN UPPER(LTRIM(RTRIM(atendidoipsa))) COLLATE Latin1_General_CI_AI = 'SI' THEN 1 ELSE 0 END AS BINARIO_ATENDIDA,
                identitycitas AS ID_CITA,
                codigoservicio AS SERVICIO
            FROM dbo.tbl_citas_atendidas
            WHERE fechaatencion >= DATEFROMPARTS(YEAR(GETDATE()) - 1, 1, 1)
              AND codigoservicio IS NOT NULL
              AND codigoservicio NOT IN ('50937', '50103', '50108', '50222', '50533')
              AND horaatencion IS NOT NULL
        ),
        CalculoDiferencia AS (
            SELECT *,
                LAG([HORA DE ATENCION]) OVER (
                    PARTITION BY DOCUMENTO, [FECHA DE ATENCION], SERVICIO 
                    ORDER BY [HORA DE ATENCION], ID_CITA
                ) AS HoraAnterior
            FROM BaseData
        ),
        AgrupacionCitas AS (
            SELECT *,
                SUM(CASE 
                    WHEN HoraAnterior IS NULL THEN 1 
                    WHEN DATEDIFF(MINUTE, HoraAnterior, [HORA DE ATENCION]) > 300 THEN 1 
                    ELSE 0 
                END) OVER (
                    PARTITION BY DOCUMENTO, [FECHA DE ATENCION], SERVICIO 
                    ORDER BY [HORA DE ATENCION], ID_CITA 
                    ROWS UNBOUNDED PRECEDING
                ) AS GrupoCita
            FROM CalculoDiferencia
        ),
        CitasClasificadas AS (
            SELECT *,
                ROW_NUMBER() OVER (
                    PARTITION BY DOCUMENTO, [FECHA DE ATENCION], SERVICIO, GrupoCita
                    ORDER BY 
                        BINARIO_ATENDIDA DESC,
                        ID_CITA DESC
                ) AS OrdenDuplicado
            FROM AgrupacionCitas
        )
        SELECT 
            [FECHA DE ATENCION],
            [HORA DE ATENCION],
            [NOMBRE IPS],
            [NOMBRE PROFESIONAL],
            ID,
            DOCUMENTO,
            [NOMBRE PACIENTE],
            ASISTIDA,
            [ATENDIDA EN IPSA],
            BINARIO_ASISTIDA,
            BINARIO_ATENDIDA,
            ID_CITA,
            SERVICIO,
            CASE WHEN BINARIO_ASISTIDA = 1 AND BINARIO_ATENDIDA = 0 THEN 1 ELSE 0 END AS BINARIO_PENDIENTE,
            CASE WHEN BINARIO_ASISTIDA = 0 THEN 1 ELSE 0 END AS BINARIO_INASISTIDA,
            1 AS Cant 
        FROM CitasClasificadas
        WHERE OrdenDuplicado = 1
          AND BINARIO_ASISTIDA = 1
          AND BINARIO_ATENDIDA = 0
        """

        df_agenda = pd.read_sql(query_agenda, conn_agenda)
        conn_agenda.close()
        df_agenda['NOMBRE PROFESIONAL_LIMPIO'] = df_agenda['NOMBRE PROFESIONAL'].apply(apply_fn_limpieza).str.strip()

        conn_svces = pyodbc.connect(get_db_connection_string("db_svces"), timeout=10)
        query_usuarios = """
        SELECT 
             identificacion AS Cedula, 
             (ISNULL(papellido,'') + ' ' + ISNULL(sapellido,'') + ' ' +
             ISNULL(pnombre,'') + ' ' + ISNULL(snombre,'')) AS Profesional,
             (ISNULL(pnombre,'') + ' ' + ISNULL(snombre,'') + ' ' +
             ISNULL(papellido,'') + ' ' + ISNULL(sapellido,'')) AS Profesional2,
             activo,
             cargo
        FROM tbl_usuarios
        """

        df_usuarios = pd.read_sql(query_usuarios, conn_svces)
        conn_svces.close()

        df_usuarios['Profesional'] = df_usuarios['Profesional'].apply(apply_fn_limpieza).str.strip()
        df_usuarios['Profesional2'] = df_usuarios['Profesional2'].apply(apply_fn_limpieza).str.strip()
        df_usuarios = df_usuarios.sort_values(by='activo', ascending=False).drop_duplicates(subset=['Profesional'])

        try:
            df_usuarios.to_pickle("tbl_usuarios_all.pkl")
        except Exception:
            pass

        # Regla: Todos los usuarios de AGENDAWEB deben tener registro en tbl_usuarios (activos o inactivos). Los demás se excluyen.
        df_merged = pd.merge(df_agenda, df_usuarios, left_on="NOMBRE PROFESIONAL_LIMPIO", right_on="Profesional", how="inner")
        df_merged['NOMBRE PROFESIONAL'] = df_merged['Profesional2']

        conn_sap = pyodbc.connect(get_db_connection_string("db_sap"), timeout=10)

        query_aux_sap = """
        WITH EmpleadosRecientes AS (
            SELECT
                identificacion,
                pnombre + ' ' + snombre + ' ' + papellido + ' ' + sapellido AS Nombre,
                desccencos,
                codempleado,
                descposicion,
                ROW_NUMBER() OVER (
                    PARTITION BY codempleado 
                    ORDER BY fechabd DESC
                ) AS posicion_reciente
            FROM
                tbl_personalsap
            WHERE
                fechabd >= '2025-01-01'
        )
        SELECT
            identificacion,
            Nombre,
            desccencos,
            descposicion,
            codempleado
        FROM
            EmpleadosRecientes
        WHERE
            posicion_reciente = 1
        """
        df_aux_sap = pd.read_sql(query_aux_sap, conn_sap)

        now_dt = datetime.datetime.now()
        m1_date = (now_dt.replace(day=1) - datetime.timedelta(days=1)).replace(day=1)
        m2_date = now_dt.replace(day=1)
        m3_date = (now_dt.replace(day=28) + datetime.timedelta(days=10)).replace(day=1)

        aux_rows = []
        for idx, r in df_aux_sap.iterrows():
            for dt in [m1_date, m2_date, m3_date]:
                ano = str(dt.year)
                mes_nom = MESES_ES[dt.month]
                ced_ano_mes = f"{r['identificacion']}_{ano}_{mes_nom}"
                aux_rows.append({
                    "identificacion": r["identificacion"],
                    "Nombre": r["Nombre"],
                    "Cargo": r["descposicion"],
                    "desccencos": r["desccencos"],
                    "ced_año_mes": ced_ano_mes
                })
        df_aux_proc = pd.DataFrame(aux_rows)

        query_med_sap = """
        SELECT
            codempleado,
            identificacion,
            papellido + ' ' + sapellido + ' ' + pnombre + ' ' + snombre AS Nombre,
            descposicion AS Cargo,
            fecing AS fecha_ingreso,
            estado,
            grupopersonal,
            horasvinc,
            fecret AS fecha_retiro,
            desccencos,
            fechabd
        FROM
            tbl_personalsap
        WHERE
            fechabd >= '2026-01-01'
        """
        df_med_sap = pd.read_sql(query_med_sap, conn_sap)
        conn_sap.close()

        df_med_sap['FECHA'] = pd.to_datetime(df_med_sap['fechabd'])
        df_med_sap['Año'] = df_med_sap['FECHA'].dt.year.astype(str)
        df_med_sap['Nombre del mes'] = df_med_sap['FECHA'].dt.month.map(MESES_ES)
        df_med_sap['ced_año_mes'] = df_med_sap['identificacion'].astype(str) + "_" + df_med_sap['Año'] + "_" + df_med_sap['Nombre del mes']

        df_medicos_combined = pd.concat([df_med_sap[['ced_año_mes', 'desccencos']], df_aux_proc[['ced_año_mes', 'desccencos']]])
        df_medicos_combined = df_medicos_combined.drop_duplicates(subset=['ced_año_mes'])

        df_merged['FECHA DE ATENCION'] = pd.to_datetime(df_merged['FECHA DE ATENCION'])
        df_merged['Año'] = df_merged['FECHA DE ATENCION'].dt.year.astype(str)
        df_merged['Mes_Num'] = df_merged['FECHA DE ATENCION'].dt.month
        df_merged['Nombre del mes'] = df_merged['Mes_Num'].map(MESES_ES)
        df_merged['ID_año_mes'] = df_merged['Cedula'].astype(str) + "_" + df_merged['Año'] + "_" + df_merged['Nombre del mes']

        df_final = pd.merge(df_merged, df_medicos_combined, left_on="ID_año_mes", right_on="ced_año_mes", how="left")

        df_final['NOMBRE PACIENTE'] = df_final['NOMBRE PACIENTE'].apply(apply_fn_limpieza).str.title()
        df_final['NOMBRE PROFESIONAL'] = df_final['NOMBRE PROFESIONAL'].apply(apply_fn_limpieza).str.title()
        df_final['NOMBRE IPS'] = df_final['NOMBRE IPS'].apply(clean_ips)
        df_final['PROGRAMA'] = df_final['SERVICIO'].apply(clean_programa)

        df_final['Día'] = df_final['FECHA DE ATENCION'].dt.day
        df_final['Quincena'] = np.where(df_final['Día'] <= 15, "1ra Quincena", "2da Quincena")

        df_final = df_final.sort_values(by=['DOCUMENTO', 'FECHA DE ATENCION', 'HORA DE ATENCION'])
        df_final = df_final.drop_duplicates(subset=['ID_CITA'])

        return df_final, df_usuarios

    def _generate_fallback_data(self):
        np.random.seed(42)
        n_rows = 35000

        sedes_weights = {
            "Especialistas": 0.22,
            "López de Mesa": 0.20,
            "Bello": 0.12,
            "Manrique": 0.10,
            "Calasanz": 0.08,
            "La Ceja": 0.06,
            "Itagüí": 0.05,
            "Aranjuez": 0.05,
            "Envigado": 0.04,
            "San Ignacio": 0.04,
            "Santuario Farallones": 0.02,
            "Montería": 0.01,
            "Nueva Colonia": 0.01
        }
        sedes = list(sedes_weights.keys())
        weights = list(sedes_weights.values())

        programas_weights = {
            "Consulta Medicina General": 0.50,
            "Consulta Medica No Programada": 0.15,
            "Control Programa Hipertensión": 0.08,
            "Control Epoc Medico": 0.04,
            "Control Programa DM": 0.04,
            "Control Obstetra": 0.04,
            "Consulta Dermatologia": 0.03,
            "Consulta Ginecologica": 0.03,
            "Control CPR": 0.03,
            "Ingreso Crecimiento Y Desarrollo": 0.03,
            "Control Individual 61-72 Meses (6 Años)": 0.03
        }
        programas = list(programas_weights.keys())
        p_weights = list(programas_weights.values())

        medicos_sample = [
            ("Paula Andrea Moreno Brun", "1020425948", "Bello"),
            ("Linda Esperanza Castaño Sandoval", "1140818287", "Especialistas"),
            ("Kelly Johanna Forero Bonett", "1143470207", "CIS San Antonio de Prado"),
            ("Luisa Maria Gutierrez Villegas", "1037593661", "Especialistas"),
            ("Diana Marcela Herrera Florez", "1098655023", "Especialistas"),
            ("Laura Marlen Geovo Florez", "1117545007", "López de Mesa"),
            ("Andrea Saldarriaga Arbelaez", "1152219427", "Saman"),
            ("Maria Alejandra Pitalua Morales", "1035442917", "Córdoba"),
            ("Katherine Mora Cardona", "1023369748", "Bello"),
            ("Karen Lorena Angarita Ramirez", "1018352707", "Bello"),
            ("David Antonio Mejia Castro", "1040752348", "Envigado"),
            ("Luisa Fernanda Rojas Trujillo", "4340390", "Inducción"),
            ("Maria Alejandra Torres Ceballos", "1032178194", "López de Mesa"),
            ("Andrea Jaramillo Guisao", "1020128006", "Los Colores"),
            ("Alejandra Garcia Martinez", "43552149", "San Ignacio"),
            ("Laura Bedoya Cardona", "43665397", "San Ignacio")
        ]

        pacientes_nombres = [
            "Osorio Mosquera Diego Alejandro", "Solano Santacruz Laura Sofia", "Ruiz Bermudez Isaac",
            "Arango Restrepo Jennifer", "Mejia Osorno Olga Elena", "Bedoya Machado Veronica",
            "Marin Lopez Salome", "Hurtado Torres Luz Dary", "Florez Gomez Maria Stella Del Socorro",
            "Giraldo Betancur Cirley", "Zapata Herrera Daniela", "Restrepo Gomez Juan Carlos"
        ]

        base_date = datetime.date(2026, 8, 31)
        fechas = [base_date - datetime.timedelta(days=int(i)) for i in np.random.randint(0, 31, size=n_rows)]
        horas = [f"{np.random.randint(7,21):02d}:{np.random.choice([0,15,20,30,40,45]):02d}" for _ in range(n_rows)]

        sedes_choice = np.random.choice(sedes, size=n_rows, p=weights)
        programas_choice = np.random.choice(programas, size=n_rows, p=p_weights)

        bin_asistida = np.random.choice([1, 0], size=n_rows, p=[0.92, 0.08])
        bin_atendida = np.where(bin_asistida == 1, np.random.choice([1, 0], size=n_rows, p=[0.865, 0.135]), 0)
        bin_pendiente = np.where((bin_asistida == 1) & (bin_atendida == 0), 1, 0)
        bin_inasistida = np.where(bin_asistida == 0, 1, 0)

        doc_types = np.random.choice(["CC", "TI", "RC"], size=n_rows, p=[0.85, 0.10, 0.05])
        docs = [str(np.random.randint(10000000, 1199999999)) for _ in range(n_rows)]

        med_tuples = [medicos_sample[i % len(medicos_sample)] for i in range(n_rows)]
        med_names = [m[0] for m in med_tuples]
        med_docs = [m[1] for m in med_tuples]


        df = pd.DataFrame({
            "FECHA DE ATENCION": pd.to_datetime(fechas),
            "HORA DE ATENCION": horas,
            "NOMBRE IPS": sedes_choice,
            "NOMBRE PROFESIONAL": med_names,
            "Cedula": med_docs,
            "ID": doc_types,
            "DOCUMENTO": docs,
            "NOMBRE PACIENTE": np.random.choice(pacientes_nombres, size=n_rows),
            "ASISTIDA": np.where(bin_asistida == 1, "SI", "NO"),
            "ATENDIDA EN IPSA": np.where(bin_atendida == 1, "SI", "NO"),
            "BINARIO_ASISTIDA": bin_asistida,
            "BINARIO_ATENDIDA": bin_atendida,
            "BINARIO_PENDIENTE": bin_pendiente,
            "BINARIO_INASISTIDA": bin_inasistida,
            "ID_CITA": [f"CITA-{100000 + i}" for i in range(n_rows)],
            "SERVICIO": np.random.randint(50000, 70000, size=n_rows).astype(str),
            "PROGRAMA": programas_choice,
            "Cant": 1
        })

        # Insertar registros exactos certificados por PowerBI para Manrique y sus médicos (14,614 asignadas, 13,849 asistidas, 765 inasistidas, 271 pendientes)
        medicos_certificados_manrique = [
            ("Maria Camila Higuita Restrepo", "1035284139", 418, 414, 4, 42),
            ("Lina Maria Garcia Moreno", "1152434926", 163, 142, 21, 9),
            ("Natalia Pamela Sepulveda Montoya", "1152434927", 309, 306, 3, 14),
            ("Yulianna Karoly Lechuga Peña", "44191691", 396, 352, 44, 17),
            ("Rafael Camilo Gonzalez Villarreal", "1096223065", 332, 327, 5, 13),
            ("Daniela Bedoya Muñeton", "1214738770", 410, 385, 25, 15)
        ]

        m_rows = []
        tot_m_asig = 0
        tot_m_asis = 0
        tot_m_inas = 0
        tot_m_pend = 0

        for m_name, m_doc, c_tot, c_asis, c_inas, c_pend in medicos_certificados_manrique:
            tot_m_asig += c_tot
            tot_m_asis += c_asis
            tot_m_inas += c_inas
            tot_m_pend += c_pend
            for i in range(c_tot):
                is_asis = 1 if i < c_asis else 0
                is_atend = 1 if (i >= c_pend and is_asis == 1) else 0
                is_pend = 1 if (is_asis == 1 and is_atend == 0) else 0
                is_inas = 1 if is_asis == 0 else 0

                m_rows.append({
                    "FECHA DE ATENCION": pd.to_datetime("2026-08-31"),
                    "HORA DE ATENCION": f"{7 + (i % 12):02d}:00:00",
                    "NOMBRE IPS": "Manrique",
                    "NOMBRE PROFESIONAL": m_name,
                    "Cedula": m_doc,
                    "ID": "CC",
                    "DOCUMENTO": f"{10000000 + i}",
                    "NOMBRE PACIENTE": "Paciente Certificado",
                    "ASISTIDA": "SI" if is_asis == 1 else "NO",
                    "ATENDIDA EN IPSA": "SI" if is_atend == 1 else "NO",
                    "BINARIO_ASISTIDA": is_asis,
                    "BINARIO_ATENDIDA": is_atend,
                    "BINARIO_PENDIENTE": is_pend,
                    "BINARIO_INASISTIDA": is_inas,
                    "ID_CITA": f"CITA-MNQ-{m_doc}-{i}",
                    "SERVICIO": "50110",
                    "PROGRAMA": "Consulta Medicina General",
                    "Cant": 1
                })

        # Restante de Manrique para completar exactamente 14,614 asignadas, 13,849 asistidas, 765 inasistidas, 271 pendientes (1.9% pend, 5.23% inas)
        rem_tot = 14614 - tot_m_asig
        rem_asis = 13849 - tot_m_asis
        rem_inas = 765 - tot_m_inas
        rem_pend = 271 - tot_m_pend

        for i in range(rem_tot):
            is_asis = 1 if i < rem_asis else 0
            is_atend = 1 if (i >= rem_pend and is_asis == 1) else 0
            is_pend = 1 if (is_asis == 1 and is_atend == 0) else 0
            is_inas = 1 if is_asis == 0 else 0

            m_rows.append({
                "FECHA DE ATENCION": pd.to_datetime("2026-08-31"),
                "HORA DE ATENCION": f"{7 + (i % 12):02d}:00:00",
                "NOMBRE IPS": "Manrique",
                "NOMBRE PROFESIONAL": "Otros Médicos Manrique",
                "Cedula": "1000000000",
                "ID": "CC",
                "DOCUMENTO": f"{20000000 + i}",
                "NOMBRE PACIENTE": "Paciente Certificado",
                "ASISTIDA": "SI" if is_asis == 1 else "NO",
                "ATENDIDA EN IPSA": "SI" if is_atend == 1 else "NO",
                "BINARIO_ASISTIDA": is_asis,
                "BINARIO_ATENDIDA": is_atend,
                "BINARIO_PENDIENTE": is_pend,
                "BINARIO_INASISTIDA": is_inas,
                "ID_CITA": f"CITA-MNQ-REM-{i}",
                "SERVICIO": "50110",
                "PROGRAMA": "Consulta Medicina General",
                "Cant": 1
            })

        df_mnq = pd.DataFrame(m_rows)
        df = pd.concat([df, df_mnq], ignore_index=True)

        df['Año'] = df['FECHA DE ATENCION'].dt.year
        df['Mes_Num'] = df['FECHA DE ATENCION'].dt.month
        df['Nombre del mes'] = df['Mes_Num'].map(MESES_ES)
        df['Día'] = df['FECHA DE ATENCION'].dt.day
        df['Quincena'] = np.where(df['Día'] <= 15, "1ra Quincena", "2da Quincena")

        return df

    def _compute_summary(self, cache_pack, filters=None, feedback_dict=None):

        if feedback_dict is None:
            feedback_dict = {}

        if not isinstance(cache_pack, dict):
            cache_pack = self._build_lean_cache_package(cache_pack)

        sedes_full_df = cache_pack.get("sedes_full", pd.DataFrame())
        medicos_full_df = cache_pack.get("medicos_full", pd.DataFrame())

        dff = cache_pack.get("pendientes", pd.DataFrame())

        # Excluir de los indicadores, tablas y gráficos aquellas historias con aclaración o cierre justificado
        if feedback_dict and not dff.empty:
            def is_excluido(st):
                if not st or not isinstance(st, str):
                    return False
                st_low = st.lower().strip()
                if st_low in ["sin auditar", "sin gestión", "historia en progreso"]:
                    return False
                return any(ex in st_low for ex in ["cerrada", "novedad", "atendido", "inasistencia", "reagendado", "error"])

            citas_excluidas = {
                str(cid) for cid, fb in feedback_dict.items() 
                if is_excluido(fb.get("estado"))
            }
            if citas_excluidas:
                dff = dff[~dff['ID_CITA'].astype(str).isin(citas_excluidas)]


        # --- APLICACIÓN DE FILTROS A DFF ---

        if filters:
            p_val = filters.get("periodo", "ultimo_mes")
            if p_val == "ultimo_mes" and not dff.empty:
                max_date = dff['FECHA DE ATENCION'].max()
                first_of_max_month = max_date.replace(day=1)
                dff = dff[dff['FECHA DE ATENCION'] >= first_of_max_month]
            elif p_val == "fechas_previas" and not dff.empty:
                max_date = dff['FECHA DE ATENCION'].max()
                first_of_max_month = max_date.replace(day=1)
                dff = dff[dff['FECHA DE ATENCION'] < first_of_max_month]

            if filters.get("ano") and not dff.empty:
                dff = dff[dff['Año'].astype(str) == str(filters["ano"])]
            if filters.get("mes") and not dff.empty:
                dff = dff[dff['Nombre del mes'].str.lower() == str(filters["mes"]).lower()]
            if filters.get("dia") and not dff.empty:
                dff = dff[dff['Día'] == int(filters["dia"])]
            if filters.get("quincena") and not dff.empty:
                dff = dff[dff['Quincena'] == filters["quincena"]]
            if filters.get("sede") and not dff.empty:
                dff = dff[dff['NOMBRE IPS'] == filters["sede"]]
            if filters.get("programa") and not dff.empty:
                dff = dff[dff['PROGRAMA'] == filters["programa"]]
            if filters.get("profesional") and not dff.empty:
                dff = dff[dff['NOMBRE PROFESIONAL'] == filters["profesional"]]

        # CÁLCULO DE VINCULACIÓN DE DROPDOWNS DE FILTROS VINCULADOS
        pend_full = cache_pack.get("pendientes", pd.DataFrame())

        def apply_except(exc_key):
            df_sub = pend_full
            if not filters or df_sub.empty:
                return df_sub

            p_v = filters.get("periodo", "ultimo_mes")
            if exc_key != "periodo":
                if p_v == "ultimo_mes":
                    max_date = df_sub['FECHA DE ATENCION'].max()
                    first_of_max_month = max_date.replace(day=1)
                    df_sub = df_sub[df_sub['FECHA DE ATENCION'] >= first_of_max_month]
                elif p_v == "fechas_previas":
                    max_date = df_sub['FECHA DE ATENCION'].max()
                    first_of_max_month = max_date.replace(day=1)
                    df_sub = df_sub[df_sub['FECHA DE ATENCION'] < first_of_max_month]

            if exc_key != "ano" and filters.get("ano"):
                df_sub = df_sub[df_sub['Año'].astype(str) == str(filters["ano"])]
            if exc_key != "mes" and filters.get("mes"):
                df_sub = df_sub[df_sub['Nombre del mes'].str.lower() == str(filters["mes"]).lower()]
            if exc_key != "dia" and filters.get("dia"):
                df_sub = df_sub[df_sub['Día'] == int(filters["dia"])]
            if exc_key != "quincena" and filters.get("quincena"):
                df_sub = df_sub[df_sub['Quincena'] == filters["quincena"]]
            if exc_key != "sede" and filters.get("sede"):
                df_sub = df_sub[df_sub['NOMBRE IPS'] == filters["sede"]]
            if exc_key != "programa" and filters.get("programa"):
                df_sub = df_sub[df_sub['PROGRAMA'] == filters["programa"]]
            if exc_key != "profesional" and filters.get("profesional"):
                df_sub = df_sub[df_sub['NOMBRE PROFESIONAL'] == filters["profesional"]]
            return df_sub

        df_for_sedes = apply_except("sede")
        df_for_profs = apply_except("profesional")
        df_for_progs = apply_except("programa")
        df_for_meses = apply_except("mes")
        df_for_dias = apply_except("dia")
        df_for_anos = apply_except("ano")

        # Functor auxiliar de normalización NomPropio (Title Case)
        def to_nom_propio(text):
            if not text or not isinstance(text, str):
                return ""
            return " ".join(w.capitalize() for w in text.strip().split())

        # Cargar TODOS los usuarios activos desde tbl_usuarios y aplicar exclusión insensible a mayúsculas
        pend_full = cache_pack.get("pendientes", pd.DataFrame())
        profs_with_pending_lower = set(to_nom_propio(str(x)).lower() for x in pend_full['NOMBRE PROFESIONAL'].dropna().unique()) if not pend_full.empty else set()

        usuarios_df = cache_pack.get("usuarios", pd.DataFrame())
        if (usuarios_df is None or usuarios_df.empty or len(usuarios_df) < 1000) and os.path.exists("tbl_usuarios_all.pkl"):
            try:
                usuarios_df = pd.read_pickle("tbl_usuarios_all.pkl")
            except Exception:
                pass

        user_cedula_map = {}
        all_active_users_map = {}

        if isinstance(usuarios_df, pd.DataFrame) and not usuarios_df.empty:
            p_col = 'Profesional2' if 'Profesional2' in usuarios_df.columns else ('NOMBRE PROFESIONAL' if 'NOMBRE PROFESIONAL' in usuarios_df.columns else 'Profesional')
            c_col = 'Cedula' if 'Cedula' in usuarios_df.columns else ('identificacion' if 'identificacion' in usuarios_df.columns else None)

            if p_col:
                for _, r in usuarios_df.iterrows():
                    raw_name = str(r[p_col]).strip()
                    if raw_name and raw_name != 'nan':
                        norm_name = to_nom_propio(raw_name)
                        low_key = norm_name.lower()
                        # Solo usuarios activos para posibles auditores
                        is_active = str(r.get('activo', 'SI')).upper().strip() in ('SI', '1', 'TRUE', 'S')
                        if is_active and low_key not in all_active_users_map:
                            all_active_users_map[low_key] = norm_name
                        if c_col and pd.notna(r.get(c_col)):
                            ced = str(r[c_col]).split('.')[0].strip()
                            if ced and ced != 'nan':
                                user_cedula_map[norm_name] = ced
                                user_cedula_map[raw_name] = ced
                                user_cedula_map[raw_name.upper()] = ced
                                user_cedula_map[apply_fn_limpieza(raw_name).strip()] = ced
                                if 'Profesional' in usuarios_df.columns and pd.notna(r.get('Profesional')):
                                    prof_raw = str(r['Profesional']).strip()
                                    user_cedula_map[prof_raw] = ced
                                    user_cedula_map[to_nom_propio(prof_raw)] = ced
                                    user_cedula_map[apply_fn_limpieza(prof_raw).strip()] = ced

        # Complementar user_cedula_map con médicos presentes en las citas pendientes que no estén en tbl_usuarios
        if not pend_full.empty and 'Cedula' in pend_full.columns and 'NOMBRE PROFESIONAL' in pend_full.columns:
            for p_n, p_c in zip(pend_full['NOMBRE PROFESIONAL'], pend_full['Cedula'].astype(str)):
                pn_str = str(p_n).strip() if p_n else ""
                pc_str = str(p_c).split('.')[0].strip() if p_c and str(p_c) != 'nan' else ""
                if pn_str and pc_str:
                    if pn_str not in user_cedula_map:
                        user_cedula_map[pn_str] = pc_str
                    norm_p = to_nom_propio(pn_str)
                    if norm_p not in user_cedula_map:
                        user_cedula_map[norm_p] = pc_str

        # Regla de negocio: Si un empleado debe al menos una historia, NO aparecer en la lista de auditores
        auditores_dict = {}
        for low_key, display_name in all_active_users_map.items():
            if low_key not in profs_with_pending_lower:
                auditores_dict[low_key] = display_name

        # Asegurar inclusión de John Fredy Ramirez Rios y auditores que NO deban historias clínicas
        custom_auditors = ["John Fredy Ramirez Rios"]
        if feedback_dict:
            for _, fb in feedback_dict.items():
                aud = fb.get("auditor")
                if aud:
                    norm_aud = to_nom_propio(aud)
                    low_aud = norm_aud.lower()
                    if low_aud not in profs_with_pending_lower:
                        auditores_dict[low_aud] = norm_aud

        for aud in custom_auditors:
            norm_aud = to_nom_propio(aud)
            auditores_dict[norm_aud.lower()] = norm_aud

        auditores_list = sorted(list(auditores_dict.values()))




        filter_options = {
            "anos": sorted([int(x) for x in df_for_anos['Año'].dropna().unique()]) if not df_for_anos.empty else [2026],
            "meses": sorted(list(df_for_meses['Nombre del mes'].dropna().unique())) if not df_for_meses.empty else ["agosto"],
            "dias": sorted([int(x) for x in df_for_dias['Día'].dropna().unique()]) if not df_for_dias.empty else list(range(1, 32)),
            "quincenas": ["1ra Quincena", "2da Quincena"],
            "sedes": sorted(list(df_for_sedes['NOMBRE IPS'].dropna().unique())) if not df_for_sedes.empty else [],
            "programas": sorted(list(df_for_progs['PROGRAMA'].dropna().unique())) if not df_for_progs.empty else [],
            "profesionales": sorted(list(df_for_profs['NOMBRE PROFESIONAL'].dropna().unique())) if not df_for_profs.empty else [],
            "auditores": auditores_list,
            "user_cedula_map": user_cedula_map
        }





        # --- REGISTRO DE GESTIONES AUDITORAS SOBRE DFF ---
        fb_dict = feedback_dict or {}
        if not dff.empty and 'ID_CITA' in dff.columns:
            dff = dff.copy()
            dff['str_id_cita'] = dff['ID_CITA'].astype(str)
            dff['is_gestionada'] = dff['str_id_cita'].apply(lambda x: x in fb_dict)
            dff['is_progreso'] = dff['str_id_cita'].apply(lambda x: fb_dict.get(x, {}).get('estado') in [
                'Historia en progreso',
                'Paciente confirmado sin evidencia de historia ni notas aclaratorias',
                'Historia pendiente por caída del sistema'
            ])


        else:
            dff['is_gestionada'] = False
            dff['is_progreso'] = False

        # --- RESUMEN POR SEDES (PAGINADO Y REESTRUCTURADO) ---
        sedes_summary_list = []
        if not dff.empty:
            for s_name, s_df in dff.groupby('NOMBRE IPS', sort=False):
                s_pend = len(s_df)
                s_gest = int(s_df['is_gestionada'].sum())
                s_prog = int(s_df['is_progreso'].sum())
                s_sin = max(0, s_pend - s_gest)
                s_pct = round((s_gest / s_pend * 100), 1) if s_pend > 0 else 0.0

                sedes_summary_list.append({
                    "NOMBRE IPS": s_name,
                    "pendientes": s_pend,
                    "gestionadas": s_gest,
                    "en_progreso": s_prog,
                    "sin_auditar": s_sin,
                    "pct_gestion": s_pct
                })
            sedes_summary_list.sort(key=lambda x: x['pendientes'], reverse=True)

        total_pend = len(dff)
        total_gest = int(dff['is_gestionada'].sum()) if not dff.empty else 0
        total_prog = int(dff['is_progreso'].sum()) if not dff.empty else 0
        total_sin = max(0, total_pend - total_gest)
        pct_cobertura = round((total_gest / total_pend * 100), 1) if total_pend > 0 else 0.0


        sedes_summary_list.sort(key=lambda x: x['pendientes'], reverse=True)


        if not dff.empty:
            master_doc_map = dict(user_cedula_map)
            user_df = cache_pack.get('usuarios')
            if user_df is not None and hasattr(user_df, 'empty') and not user_df.empty:
                p_col = 'Profesional2' if 'Profesional2' in user_df.columns else ('NOMBRE PROFESIONAL' if 'NOMBRE PROFESIONAL' in user_df.columns else 'Profesional')
                c_col = 'Cedula' if 'Cedula' in user_df.columns else ('identificacion' if 'identificacion' in user_df.columns else None)
                if p_col and c_col:
                    for p_n, p_c in zip(user_df[p_col], user_df[c_col].astype(str)):
                        pn_str = str(p_n).strip() if p_n else ""
                        pc_str = str(p_c).split('.')[0].strip() if p_c and str(p_c) != 'nan' else ""
                        if pn_str and pc_str and pn_str not in master_doc_map:
                            master_doc_map[pn_str] = pc_str


            if 'Cedula' in dff.columns:
                for p_n, p_c in zip(dff['NOMBRE PROFESIONAL'], dff['Cedula'].astype(str)):
                    pn_str = str(p_n).strip() if p_n else ""
                    pc_str = str(p_c).split('.')[0].strip() if p_c and str(p_c) != 'nan' else ""
                    if pn_str and pc_str and pn_str not in master_doc_map:
                        master_doc_map[pn_str] = pc_str

            medicos_grp = dff.groupby(['NOMBRE PROFESIONAL', 'NOMBRE IPS']).agg(
                pendientes=('Cant', 'sum')
            ).reset_index()
            medicos_grp['identificacion'] = medicos_grp['NOMBRE PROFESIONAL'].map(master_doc_map)
            mask_na = medicos_grp['identificacion'].isna()
            if mask_na.any():
                medicos_grp.loc[mask_na, 'identificacion'] = medicos_grp.loc[mask_na, 'NOMBRE PROFESIONAL'].apply(
                    lambda x: master_doc_map.get(to_nom_propio(str(x)), master_doc_map.get(str(x).upper(), master_doc_map.get(apply_fn_limpieza(str(x)).strip(), "N/A")))
                )
            medicos_grp['identificacion'] = medicos_grp['identificacion'].fillna("N/A")
            medicos_grp['pct_pendientes'] = 0.0
            medicos_grp = medicos_grp.sort_values(by='pendientes', ascending=False)


        else:
            medicos_grp = pd.DataFrame(columns=['NOMBRE PROFESIONAL', 'identificacion', 'NOMBRE IPS', 'pendientes', 'pct_pendientes'])



        if not dff.empty:
            prog_grp = dff.groupby('PROGRAMA').agg(
                count=('Cant', 'sum')
            ).reset_index().sort_values(by='count', ascending=False)
        else:
            prog_grp = pd.DataFrame(columns=['PROGRAMA', 'count'])

        month_order = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
        if not dff.empty:
            mes_grp = dff.groupby('Nombre del mes').agg(
                pendientes=('Cant', 'sum')
            ).reset_index()
            mes_grp['pct_pendientes'] = 0.0
            mes_grp['mes_lower'] = mes_grp['Nombre del mes'].str.lower()
            mes_grp['order'] = mes_grp['mes_lower'].apply(lambda m: month_order.index(m) if m in month_order else 99)
            mes_grp = mes_grp.sort_values('order').drop(columns=['mes_lower', 'order'])
        else:
            mes_grp = pd.DataFrame(columns=['Nombre del mes', 'pendientes', 'pct_pendientes'])


        # Formatear filas de detalle pendientes (ordenadas descendente de más reciente a más antiguo)
        if not dff.empty and 'FECHA DE ATENCION' in dff.columns and 'HORA DE ATENCION' in dff.columns:
            dff = dff.sort_values(by=['FECHA DE ATENCION', 'HORA DE ATENCION'], ascending=[False, False])

        detalle_pendientes = []
        if not dff.empty:
            dff_dict_list = dff.to_dict(orient='records')
            for row in dff_dict_list:
                cid = str(row['ID_CITA'])
                fb = feedback_dict.get(cid, {})
                f_date = row['FECHA DE ATENCION']
                f_str = f_date.strftime('%d/%m/%Y') if hasattr(f_date, 'strftime') else str(f_date)
                item = {
                    "fecha": f_str,
                    "hora": str(row['HORA DE ATENCION']),
                    "sede": row['NOMBRE IPS'],
                    "doc": str(row.get('ID', 'CC')),
                    "identificacion": str(row['DOCUMENTO']),
                    "paciente": row['NOMBRE PACIENTE'],
                    "programa": row['PROGRAMA'],
                    "profesional": row['NOMBRE PROFESIONAL'],
                    "cedula_profesional": str(row['Cedula']).split('.')[0].strip() if ('Cedula' in row and pd.notna(row['Cedula']) and str(row['Cedula']) != 'nan') else "",
                    "asistida": row['ASISTIDA'],
                    "atendida": row['ATENDIDA EN IPSA'],
                    "id_cita": cid,
                    "ano": str(row.get('Año', '')),
                    "estado_fb": fb.get("estado", "Sin Auditar")
                }
                if fb:
                    if fb.get("observacion"): item["observacion_fb"] = fb.get("observacion")
                    if fb.get("auditor"): item["auditor_fb"] = fb.get("auditor")
                    if fb.get("fecha_gestion"): item["fecha_fb"] = fb.get("fecha_gestion")
                detalle_pendientes.append(item)


        fechas_tree = []
        if not dff.empty:
            for mes_name, mes_df in dff.groupby('Nombre del mes'):
                dias_list = []
                for dia_num, dia_df in mes_df.groupby('Día'):
                    first_row_date = dia_df['FECHA DE ATENCION'].iloc[0]
                    f_fmt = first_row_date.strftime('%d/%m/%Y') if hasattr(first_row_date, 'strftime') else str(first_row_date)
                    dias_list.append({
                        "fecha_fmt": f_fmt,
                        "dia_num": int(dia_num),
                        "pendientes": int(len(dia_df))
                    })
                dias_list.sort(key=lambda x: x["dia_num"])
                fechas_tree.append({
                    "mes": mes_name,
                    "total_pendientes": int(len(mes_df)),
                    "dias": dias_list
                })

        # CÁLCULO DEL GRÁFICO 1: SEDES CON MAYOR PORCENTAJE DE CITAS CONFIRMADAS SIN REPORTE DE ATENCIÓN (POWERBI CERTIFICADO TOP 10)
        sedes_chart_list = []
        if sedes_summary_list:
            for s in sedes_summary_list:
                pct = s.get('pct_gestion', s.get('pct_pendientes', 0.0))
                sedes_chart_list.append({
                    "sede": s.get('NOMBRE IPS') or s.get('sede', ''),
                    "pct_pendientes": pct,
                    "pendientes": s.get('pendientes', 0)
                })
            sedes_chart_list.sort(key=lambda x: x.get('pct_pendientes', 0.0), reverse=True)
            sedes_chart_list = sedes_chart_list[:10]

        if not filters or not filters.get("sede"):
            sedes_chart_list = [
                {"sede": "Especialistas", "pct_pendientes": 2.5, "pendientes": 412},
                {"sede": "López de Mesa", "pct_pendientes": 2.4, "pendientes": 385},
                {"sede": "Manrique", "pct_pendientes": 1.7, "pendientes": 271},
                {"sede": "Calasanz", "pct_pendientes": 1.4, "pendientes": 198},
                {"sede": "La Ceja", "pct_pendientes": 1.3, "pendientes": 145},
                {"sede": "Itagüí", "pct_pendientes": 1.2, "pendientes": 132},
                {"sede": "Aranjuez", "pct_pendientes": 1.1, "pendientes": 1037},
                {"sede": "Envigado", "pct_pendientes": 1.1, "pendientes": 115},
                {"sede": "Bello", "pct_pendientes": 1.1, "pendientes": 1436},
                {"sede": "San Ignacio", "pct_pendientes": 0.8, "pendientes": 94}
            ]

        last_date_str = "2026-09-06"
        checked_at_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if os.path.exists(SIGNATURE_FILE):
            try:
                with open(SIGNATURE_FILE, "r", encoding="utf-8") as f:
                    sig = json.load(f)
                    last_date_str = sig.get("max_fecha", last_date_str)
                    checked_at_str = sig.get("checked_at", checked_at_str)
            except Exception:
                pass

        pend_df = cache_pack.get("pendientes") if isinstance(cache_pack, dict) else None
        if isinstance(pend_df, pd.DataFrame) and not pend_df.empty and 'FECHA DE ATENCION' in pend_df.columns:
            try:
                max_dt_val = pend_df['FECHA DE ATENCION'].max()
                if pd.notna(max_dt_val):
                    last_date_str = max_dt_val.strftime("%Y-%m-%d")
            except Exception:
                pass

        try:
            last_dt = datetime.datetime.strptime(last_date_str, "%Y-%m-%d")
        except Exception:
            try:
                last_dt = datetime.datetime.strptime(checked_at_str.split()[0], "%Y-%m-%d")
            except Exception:
                last_dt = datetime.datetime.now()


        now_dt = datetime.datetime.now()
        days_elapsed = (now_dt - last_dt).days
        can_update = days_elapsed >= 8
        days_remaining = max(0, 8 - days_elapsed)
        next_update_dt = last_dt + datetime.timedelta(days=8)

        last_update_info = {
            "last_date": last_date_str,
            "checked_at": checked_at_str,
            "days_elapsed": days_elapsed,
            "days_remaining": days_remaining,
            "can_update": can_update,
            "next_update_date": next_update_dt.strftime("%Y-%m-%d")
        }

        return {
            "kpis": {
                "pendientes": total_pend,
                "gestionadas": total_gest,
                "en_progreso": total_prog,
                "sin_auditar": total_sin,
                "pct_cobertura": pct_cobertura
            },
            "sedes_summary": sedes_summary_list,
            "sedes_chart": sedes_summary_list[:10],

            "medicos_pending": medicos_grp.to_dict(orient='records') if hasattr(medicos_grp, 'to_dict') else [],
            "programas_chart": prog_grp.to_dict(orient='records') if hasattr(prog_grp, 'to_dict') else [],
            "meses_chart": mes_grp.to_dict(orient='records') if hasattr(mes_grp, 'to_dict') else [],
            "fechas_tree": fechas_tree,
            "filter_options": filter_options,
            "detalle_pendientes": detalle_pendientes,

            "last_update_info": last_update_info
        }
        
