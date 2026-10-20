import pyodbc
import pandas as pd
import numpy as np
import json
import os
import re
import datetime
import time
import pickle

from google_sheets import get_db_connection_string, load_config
from etl_processor import (
    clean_programa,
    CODIGOS_EXCLUIDOS_SERVICIO,
    apply_fn_limpieza,
    clean_ips,
    get_text_cleaning_rules,
    MESES_ES,
    clean_estado_phc,
    enrich_and_filter_phc,
    is_programa_especialistas
)

print("=== EJECUTANDO ETL REAL CON LAS REGLAS EXACTAS DE POWERQUERY ===")
start_time = time.time()

# 1. CONEXIÓN Y EXTRACCIÓN BDAGENDAWEB
print("1/5 Extrayendo AGENDAWEB desde SQL Server (BDAGENDAWEB)...")
conn_agenda = pyodbc.connect(get_db_connection_string("db_agendaweb"))

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
        codigoservicio AS SERVICIO,
        horaatencion AS HORAATENCION_RAW,
        fechaatencion AS FECHA_ATENCION_RAW
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
    HORAATENCION_RAW,
    FECHA_ATENCION_RAW,
    CASE WHEN BINARIO_ASISTIDA = 1 AND BINARIO_ATENDIDA = 0 THEN 1 ELSE 0 END AS BINARIO_PENDIENTE,
    CASE WHEN BINARIO_ASISTIDA = 0 THEN 1 ELSE 0 END AS BINARIO_INASISTIDA,
    1 AS Cant
FROM CitasClasificadas c
WHERE OrdenDuplicado = 1
  AND (
      (BINARIO_ASISTIDA = 1 AND BINARIO_ATENDIDA = 0)
      OR EXISTS (
          SELECT 1 FROM dbo.tbl_citas_phc p
          WHERE p.[Estado PHC] = 'En progreso'
            AND LTRIM(RTRIM(p.[Identificación Paciente])) = c.DOCUMENTO
            AND CONVERT(varchar(16), p.Hora, 120) = CONVERT(varchar(16), c.HORAATENCION_RAW, 120)
            AND LTRIM(RTRIM(p.[Código SURACUP])) NOT IN ('502222', '50222', '50103', '94108', '700000', '99999', '236', '210', '207')
      )
  )
"""
df_agenda = pd.read_sql(query_agenda, conn_agenda)
conn_agenda.close()

# Extracción limpia y cruce multinivel de tbl_citas_phc
print("   --> Extrayendo TBL_CITAS_PHC para enriquecimiento y depuración...")
conn_phc = pyodbc.connect(get_db_connection_string("db_agendaweb"), timeout=15)
query_phc = """
SELECT 
    LTRIM(RTRIM([Identificación Paciente])) AS doc_phc,
    Hora AS hora_phc,
    LTRIM(RTRIM([Código SURACUP])) AS cup_phc,
    [Estado PHC],
    Orden,
    [Observaciones adicionales PHC] AS obs_phc,
    [accion PHC] AS accion_phc,
    [Nombre Prestación] AS prestacion_phc,
    IPS AS ips_phc,
    [Identificación Médico] AS id_medico_phc
FROM dbo.tbl_citas_phc
WHERE [Identificación Paciente] IS NOT NULL
  AND LTRIM(RTRIM([Identificación Paciente])) <> ''
  AND LTRIM(RTRIM([Código SURACUP])) NOT IN ('502222', '50222', '50103', '94108', '700000', '99999', '236', '210', '207')
"""
try:
    df_phc = pd.read_sql(query_phc, conn_phc)
except Exception as e_phc:
    print(f"   [Warning] No se pudo extraer tbl_citas_phc: {e_phc}")
    df_phc = pd.DataFrame()
conn_phc.close()

df_agenda = enrich_and_filter_phc(df_agenda, df_phc)
print(f"   --> AGENDAWEB depurado con PHC: {len(df_agenda):,} filas activas.")

# Aplicar fnLIMPIEZA inicial a NOMBRE PROFESIONAL
df_agenda['NOMBRE PROFESIONAL_LIMPIO'] = df_agenda['NOMBRE PROFESIONAL'].apply(apply_fn_limpieza).str.strip()

# 2. CONEXIÓN Y EXTRACCIÓN TBL_USUARIOS (BDSVCES)
print("2/5 Extrayendo TBL_USUARIOS desde BDSVCES...")
conn_svces = pyodbc.connect(get_db_connection_string("db_svces"))
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

print(f"   --> TBL_USUARIOS extraído: {len(df_usuarios):,} filas.")

# Inner join MergeUsuarios: Todos los usuarios de AGENDAWEB deben tener registro asociado en tbl_usuarios (activos o inactivos). Los demás se excluyen.
print("3/5 Uniendo AGENDAWEB con TBL_USUARIOS (Inner Join)...")
df_merged = pd.merge(df_agenda, df_usuarios, left_on="NOMBRE PROFESIONAL_LIMPIO", right_on="Profesional", how="inner")
df_merged['NOMBRE PROFESIONAL'] = df_merged['Profesional2']
print(f"   --> Filas tras Inner Join TBL_USUARIOS: {len(df_merged):,} filas.")

# 3. EXTRACCIÓN Y PROCESAMIENTO AUXILIAR_SAP & MEDICOS_SAP (BDSAP)
print("4/5 Extrayendo MEDICOS_SAP y AUXILIAR_SAP desde BDSAP...")
conn_sap = pyodbc.connect(get_db_connection_string("db_sap"))

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
        fechabd >= DATEFROMPARTS(YEAR(GETDATE()) - 1, 1, 1)
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

# Unpivot months for AUXILIAR_SAP (ID SAP 1, 2, 3)
now_dt = datetime.datetime.now()
m1_date = (now_dt.replace(day=1) - datetime.timedelta(days=1)).replace(day=1)
m2_date = now_dt.replace(day=1)
m3_date = (now_dt.replace(day=28) + datetime.timedelta(days=10)).replace(day=1)

dates_info = [(str(dt.year), MESES_ES[dt.month]) for dt in [m1_date, m2_date, m3_date]]
aux_rows = []
if not df_aux_sap.empty:
    for r in df_aux_sap.itertuples(index=False):
        ident = getattr(r, "identificacion")
        nom = getattr(r, "Nombre")
        pos = getattr(r, "descposicion")
        cencos = getattr(r, "desccencos")
        for ano, mes_nom in dates_info:
            aux_rows.append({
                "identificacion": ident,
                "Nombre": nom,
                "Cargo": pos,
                "desccencos": cencos,
                "ced_año_mes": f"{ident}_{ano}_{mes_nom}"
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
    fechabd >= DATEFROMPARTS(YEAR(GETDATE()), 1, 1)
"""
df_med_sap = pd.read_sql(query_med_sap, conn_sap)
conn_sap.close()

df_med_sap['FECHA'] = pd.to_datetime(df_med_sap['fechabd'])
df_med_sap['Año'] = df_med_sap['FECHA'].dt.year.astype(str)
df_med_sap['Nombre del mes'] = df_med_sap['FECHA'].dt.month.map(MESES_ES)
df_med_sap['ced_año_mes'] = df_med_sap['identificacion'].astype(str) + "_" + df_med_sap['Año'] + "_" + df_med_sap['Nombre del mes']

# Combine MEDICOS_SAP + AUXILIAR_SAP
df_medicos_combined = pd.concat([df_med_sap[['ced_año_mes', 'desccencos']], df_aux_proc[['ced_año_mes', 'desccencos']]])
df_medicos_combined = df_medicos_combined.drop_duplicates(subset=['ced_año_mes'])
print(f"   --> MEDICOS_SAP combinado: {len(df_medicos_combined):,} filas.")

# Crear llave ID_año_mes en AGENDAWEB
df_merged['FECHA DE ATENCION'] = pd.to_datetime(df_merged['FECHA DE ATENCION'])
df_merged['Año'] = df_merged['FECHA DE ATENCION'].dt.year.astype(str)
df_merged['Mes_Num'] = df_merged['FECHA DE ATENCION'].dt.month
df_merged['Nombre del mes'] = df_merged['Mes_Num'].map(MESES_ES)
df_merged['ID_año_mes'] = df_merged['Cedula'].astype(str) + "_" + df_merged['Año'] + "_" + df_merged['Nombre del mes']

# Left Join MEDICOS_SAP para no excluir citas válidas de médicos en tbl_usuarios
print("5/5 Uniendo AGENDAWEB con MEDICOS_SAP (Left Join)...")
df_final = pd.merge(df_merged, df_medicos_combined, left_on="ID_año_mes", right_on="ced_año_mes", how="left")

# Formatear columnas finales y limpiar textos
df_final['NOMBRE PACIENTE'] = df_final['NOMBRE PACIENTE'].apply(apply_fn_limpieza).str.title()
df_final['NOMBRE PROFESIONAL'] = df_final['NOMBRE PROFESIONAL'].apply(apply_fn_limpieza).str.title()
df_final['NOMBRE IPS'] = df_final['NOMBRE IPS'].apply(clean_ips)
df_final['PROGRAMA'] = df_final['SERVICIO'].apply(clean_programa)
mask_esp = df_final['PROGRAMA'].apply(is_programa_especialistas)
df_final.loc[mask_esp, 'NOMBRE IPS'] = 'Especialistas'
if 'ESTADO PHC' in df_final.columns:
    df_final['ESTADO PHC'] = df_final['ESTADO PHC'].apply(clean_estado_phc)
else:
    df_final['ESTADO PHC'] = 'Confirmada'

df_final['Día'] = df_final['FECHA DE ATENCION'].dt.day
df_final['Quincena'] = np.where(df_final['Día'] <= 15, "1ra Quincena", "2da Quincena")

# Deduplicar por ID_CITA
df_final = df_final.sort_values(by=['DOCUMENTO', 'FECHA DE ATENCION', 'HORA DE ATENCION'])
df_final = df_final.drop_duplicates(subset=['ID_CITA'])

print(f"\n=======================================================")
print(f" RESULTADO FINAL DEL PROCESAMIENTO ETL SQL REAL:")
print(f" Total filas procesadas: {len(df_final):,}")
print(f" Total pendientes globales: {df_final['BINARIO_PENDIENTE'].sum():,}")

max_month = df_final['FECHA DE ATENCION'].max().replace(day=1)
df_ult_mes = df_final[df_final['FECHA DE ATENCION'] >= max_month]
print(f" Total pendientes en el último mes ({max_month.strftime('%Y-%m')}): {df_ult_mes['BINARIO_PENDIENTE'].sum():,}")
print(f"=======================================================\n")

# Guardar resultado en sql_cache.pkl usando paquete estructurado
from etl_processor import ETLProcessor
from google_sheets import regenerate_static_api

etl_inst = ETLProcessor(autostart=False)
lean_pack = etl_inst._build_lean_cache_package(df_final, df_usuarios=df_usuarios)

with open("sql_cache.pkl", "wb") as f:
    pickle.dump(lean_pack, f)
print(f"Guardado sql_cache.pkl exitosamente ({time.time() - start_time:.2f}s)!")

regenerate_static_api(processor=etl_inst, pack=lean_pack)
print("Archivos JSON en static/api regenerados exitosamente!")

# Actualizar db_signature.json
try:
    sig = etl_inst._get_sql_signature()
    if sig:
        with open("db_signature.json", "w", encoding="utf-8") as f_sig:
            json.dump(sig, f_sig, ensure_ascii=False, indent=2)
        print("db_signature.json actualizado exitosamente!")
except Exception as e_sig:
    print(f"Aviso al actualizar db_signature.json: {e_sig}")



