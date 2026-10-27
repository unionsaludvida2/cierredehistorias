import unittest
import os
import sys
import json
import threading

# Asegurar path
sys.path.insert(0, os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

from google_sheets import mask_db_config, load_db_config, save_db_config, load_feedback, save_feedback_record, _FEEDBACK_LOCK
from etl_processor import apply_fn_limpieza, clean_ips, clean_programa, clean_estado_phc, CODIGOS_EXCLUIDOS_SERVICIO, enrich_and_filter_phc, is_programa_especialistas

class TestSecurityAndSecrets(unittest.TestCase):
    def test_mask_db_config(self):
        sample = {
            "database": {
                "server": "172.200.6.135",
                "user": "gesis",
                "password": "SecretPassword123"
            },
            "github": {
                "repo": "user/repo",
                "token": "ghp_abcdef1234567890abcdef"
            }
        }
        masked = mask_db_config(sample)
        self.assertEqual(masked["database"]["password"], "••••••••")
        self.assertTrue(masked["github"]["token"].startswith("ghp_"))
        self.assertIn("••••••••", masked["github"]["token"])
        self.assertNotIn("SecretPassword123", str(masked))

    def test_no_hardcoded_passwords_in_google_sheets_code(self):
        with open("google_sheets.py", "r", encoding="utf-8") as f:
            code = f.read()
        self.assertNotIn("Gesis1234@;", code, "No debe haber contraseñas institucionales en texto plano dentro de google_sheets.py")

    def test_preserve_masked_secret_on_save(self):
        # Config actual
        current = load_db_config()
        original_pwd = current.get("database", {}).get("password", "")
        original_tok = current.get("github", {}).get("token", "")

        original_content = None
        if os.path.exists("db_config.json"):
            with open("db_config.json", "r", encoding="utf-8") as f:
                original_content = f.read()

        try:
            # Simular envío desde frontend con máscara
            mock_submitted = {
                "database": {
                    "server": current.get("database", {}).get("server", "127.0.0.1"),
                    "password": "••••••••"
                },
                "github": {
                    "token": "••••••••"
                }
            }
            saved = save_db_config(mock_submitted)
            self.assertTrue(saved)

            reloaded = load_db_config()
            self.assertEqual(reloaded["database"]["password"], original_pwd, "La contraseña real debe ser preservada si se envía una máscara")
            self.assertEqual(reloaded["github"]["token"], original_tok, "El token real debe ser preservado si se envía una máscara")
        finally:
            if original_content is not None:
                with open("db_config.json", "w", encoding="utf-8") as f:
                    f.write(original_content)


class TestETLRules(unittest.TestCase):
    def test_apply_fn_limpieza(self):
        # Acentos y caracteres especiales
        res = apply_fn_limpieza("GUTIERREZ HERNANDEZ DIOSOTIS MARIA")
        self.assertEqual(res, "GUTIERREZ HERNANDEZ DIOSOTIS")

        res_nino = apply_fn_limpieza("NINO JAIMES")
        self.assertEqual(res_nino, "NIÑO JAIMES")

    def test_clean_programa(self):
        # Código directo
        self.assertEqual(clean_programa("50110"), "Consulta Medicina General")
        self.assertEqual(clean_programa("50120"), "Consulta Medicina Interna")
        # Prefijo
        self.assertEqual(clean_programa("Consulta Servicio 50110"), "Consulta Medicina General")
        # Exclusión
        self.assertIn("50937", CODIGOS_EXCLUIDOS_SERVICIO)

    def test_clean_estado_phc(self):
        self.assertEqual(clean_estado_phc(None), "Confirmada")
        self.assertEqual(clean_estado_phc(""), "Confirmada")
        self.assertEqual(clean_estado_phc("Sin Registro"), "Confirmada")
        self.assertEqual(clean_estado_phc("CONFIRMADA"), "Confirmada")
        self.assertEqual(clean_estado_phc("En progreso"), "En progreso")
        self.assertEqual(clean_estado_phc("Sin confirmar"), "Sin confirmar")
        self.assertEqual(clean_estado_phc("Novedad"), "Novedad")
        self.assertEqual(clean_estado_phc("Reprogramada"), "Reprogramada")
        self.assertEqual(clean_estado_phc("Error de dato"), "Error de dato")
        self.assertEqual(clean_estado_phc("ERROR INCONSISTENCIA"), "Error de dato")

    def test_is_programa_especialistas(self):
        programas_esperados = [
            "Consulta Dermatologia",
            "Procedimientos Menores Especialistas Comfama",
            "Ingreso Obstetra",
            "Consulta Pediatra",
            "Consulta Programa Especializado",
            "Control Obstetra",
            "Consulta Ginecológica",
            "Consulta Ginecologica",
            "Consulta Medicina Interna",
            "Evalucion Medico Dermatologica Asistida",
            "Evaluacion Medico Dermatologica Asistida"
        ]
        for p in programas_esperados:
            self.assertTrue(is_programa_especialistas(p), f"Debe reconocer {p} como programa especialista")
            self.assertTrue(is_programa_especialistas(p.lower()), f"Debe reconocer {p.lower()} como programa especialista")
            self.assertTrue(is_programa_especialistas(p.upper()), f"Debe reconocer {p.upper()} como programa especialista")

        # Programas no especialistas
        self.assertFalse(is_programa_especialistas("Consulta Medicina General"))
        self.assertFalse(is_programa_especialistas("Odontologia General"))
        self.assertFalse(is_programa_especialistas(None))
        self.assertFalse(is_programa_especialistas(""))

    def test_especialistas_sede_mapping_in_lean_pack(self):
        import pandas as pd
        from etl_processor import ETLProcessor
        df = pd.DataFrame([
            {
                'FECHA DE ATENCION': pd.Timestamp('2026-10-15'),
                'NOMBRE IPS': 'Envigado',
                'NOMBRE PROFESIONAL': 'Dr. Especialista',
                'PROGRAMA': 'Consulta Pediatra',
                'Cant': 1,
                'BINARIO_ASISTIDA': 1,
                'BINARIO_INASISTIDA': 0,
                'BINARIO_PENDIENTE': 1,
                'Año': 2026,
                'Nombre del mes': 'octubre',
                'Día': 15,
                'Quincena': '1ra Quincena'
            },
            {
                'FECHA DE ATENCION': pd.Timestamp('2026-10-15'),
                'NOMBRE IPS': 'Envigado',
                'NOMBRE PROFESIONAL': 'Dr. General',
                'PROGRAMA': 'Consulta Medicina General',
                'Cant': 1,
                'BINARIO_ASISTIDA': 1,
                'BINARIO_INASISTIDA': 0,
                'BINARIO_PENDIENTE': 1,
                'Año': 2026,
                'Nombre del mes': 'octubre',
                'Día': 15,
                'Quincena': '1ra Quincena'
            }
        ])
        pack = ETLProcessor._build_lean_cache_package(df)
        pends = pack['pendientes']
        pediatra_row = pends[pends['PROGRAMA'] == 'Consulta Pediatra'].iloc[0]
        general_row = pends[pends['PROGRAMA'] == 'Consulta Medicina General'].iloc[0]
        self.assertEqual(pediatra_row['NOMBRE IPS'], 'Especialistas', "El programa especialista debe pertenecer a la sede Especialistas")
        self.assertEqual(general_row['NOMBRE IPS'], 'Envigado', "El programa general debe permanecer en su sede original")

    def test_enrich_and_filter_phc(self):
        import pandas as pd
        df_ag = pd.DataFrame([{
            'DOCUMENTO': '1017156082',
            'FECHA DE ATENCION': pd.Timestamp('2026-10-08'),
            'HORA DE ATENCION': '19:40:00',
            'FECHA_ATENCION_RAW': pd.Timestamp('2026-10-08 19:40:00'),
            'SERVICIO': '50110',
            'ID_CITA': 4637652
        }, {
            'DOCUMENTO': '1234989639',
            'FECHA DE ATENCION': pd.Timestamp('2026-10-01'),
            'HORA DE ATENCION': '14:00:00',
            'FECHA_ATENCION_RAW': pd.Timestamp('2026-10-01 14:00:00'),
            'SERVICIO': '50110',
            'ID_CITA': 1111111
        }, {
            'DOCUMENTO': '999888777',
            'FECHA DE ATENCION': pd.Timestamp('2026-10-05'),
            'HORA DE ATENCION': '10:00:00',
            'FECHA_ATENCION_RAW': pd.Timestamp('2026-10-05 10:00:00'),
            'SERVICIO': '50110',
            'ID_CITA': 2222222
        }, {
            'DOCUMENTO': '555444333',
            'FECHA DE ATENCION': pd.Timestamp('2026-10-05'),
            'HORA DE ATENCION': '11:00:00',
            'FECHA_ATENCION_RAW': pd.Timestamp('2026-10-05 11:00:00'),
            'SERVICIO': '70100',
            'ID_CITA': 3333333
        }])

        df_phc = pd.DataFrame([{
            'doc_phc': '1017156082 ',
            'hora_phc': '2026-10-08 19:40:00',
            'cup_phc': '50110',
            'Estado PHC': 'En progreso',
            'Orden': '30-416937602'
        }, {
            'doc_phc': '1234989639',
            'hora_phc': '2026-10-01 14:20:00',  # 20 min shifted -> Finalizada (debe excluirse)
            'cup_phc': '50110',
            'Estado PHC': 'Finalizada',
            'Orden': '30-416937111'
        }, {
            'doc_phc': '999888777',
            'hora_phc': '2026-10-05 10:30:00',  # 30 min shifted y con código diferente -> En progreso (Nivel 2)
            'cup_phc': '890201',  # Código SURACUP diferente al agendado
            'Estado PHC': 'En progreso',
            'Orden': '30-416937222'
        }])

        res = enrich_and_filter_phc(df_ag, df_phc)
        self.assertEqual(len(res), 3, "La cita resuelta como 'Finalizada' debe ser excluida")
        # Astrid Huertas (exact match)
        self.assertEqual(res[res['DOCUMENTO'] == '1017156082']['ESTADO PHC'].iloc[0], 'En progreso')
        # Shifted time match
        self.assertEqual(res[res['DOCUMENTO'] == '999888777']['ESTADO PHC'].iloc[0], 'En progreso')
        # Unmatched patient (defaults to Confirmada)
        self.assertEqual(res[res['DOCUMENTO'] == '555444333']['ESTADO PHC'].iloc[0], 'Confirmada')

    def test_phc_source_of_truth_overrides_attended(self):
        """Si una cita figuraba como atendida en AgendaWeb pero en PHC está 'En progreso', se mantiene como pendiente"""
        import pandas as pd
        df_ag = pd.DataFrame([{
            'DOCUMENTO': '1001',
            'FECHA DE ATENCION': pd.Timestamp('2026-10-05'),
            'HORA DE ATENCION': '08:00:00',
            'FECHA_ATENCION_RAW': pd.Timestamp('2026-10-05 08:00:00'),
            'SERVICIO': '50110',
            'ID_CITA': 1,
            'BINARIO_ATENDIDA': 1,  # Marcada como atendida en AgendaWeb
            'BINARIO_PENDIENTE': 0
        }, {
            'DOCUMENTO': '1002',
            'FECHA DE ATENCION': pd.Timestamp('2026-10-05'),
            'HORA DE ATENCION': '09:00:00',
            'FECHA_ATENCION_RAW': pd.Timestamp('2026-10-05 09:00:00'),
            'SERVICIO': '50110',
            'ID_CITA': 2,
            'BINARIO_ATENDIDA': 1,  # Marcada como atendida y cerrada en PHC
            'BINARIO_PENDIENTE': 0
        }])
        df_phc = pd.DataFrame([{
            'doc_phc': '1001',
            'hora_phc': '2026-10-05 08:00:00',
            'cup_phc': '50110',
            'Estado PHC': 'En progreso',
            'Orden': 'ORD-1'
        }, {
            'doc_phc': '1002',
            'hora_phc': '2026-10-05 09:00:00',
            'cup_phc': '50110',
            'Estado PHC': 'Finalizada',
            'Orden': 'ORD-2'
        }])
        res = enrich_and_filter_phc(df_ag, df_phc)
        self.assertEqual(len(res), 1, "Solo debe quedar la cita cuya historia en PHC sigue 'En progreso'")
        self.assertEqual(res['DOCUMENTO'].iloc[0], '1001')
        self.assertEqual(res['ESTADO PHC'].iloc[0], 'En progreso')
        self.assertEqual(res['BINARIO_PENDIENTE'].iloc[0], 1, "Debe quedar clasificada con BINARIO_PENDIENTE = 1")
        self.assertEqual(res['BINARIO_ATENDIDA'].iloc[0], 0, "Debe quedar clasificada con BINARIO_ATENDIDA = 0")

    def test_phc_en_progreso_attended_and_shifted_preservation(self):
        """Verificar que citas con estado 'En progreso' en PHC se preserven como pendientes verídicas,
        incluso si en AgendaWeb figuraban como atendidas (atendidoipsa='SI'), inasistidas o con hora desplazada."""
        import pandas as pd
        df_ag = pd.DataFrame([{
            'DOCUMENTO': '43529406',  # Luz Mery Perez (Caso Joubert Alvarez)
            'FECHA DE ATENCION': pd.Timestamp('2026-10-22'),
            'HORA DE ATENCION': '15:40:00',
            'FECHA_ATENCION_RAW': pd.Timestamp('2026-10-22 15:40:00'),
            'SERVICIO': '50110',
            'ID_CITA': 4757765,
            'BINARIO_ASISTIDA': 1,
            'BINARIO_ATENDIDA': 1,  # Marcada atendida en AgendaWeb
            'BINARIO_PENDIENTE': 0
        }, {
            'DOCUMENTO': '1036669074',  # Inasistencia en AgendaWeb, pero abierta en PHC
            'FECHA DE ATENCION': pd.Timestamp('2026-10-22'),
            'HORA DE ATENCION': '20:00:00',
            'FECHA_ATENCION_RAW': pd.Timestamp('2026-10-22 20:00:00'),
            'SERVICIO': '70101',
            'ID_CITA': 4758550,
            'BINARIO_ASISTIDA': 0,
            'BINARIO_ATENDIDA': 0,
            'BINARIO_PENDIENTE': 0
        }, {
            'DOCUMENTO': '999111222',  # Atendida en Agenda pero con hora desplazada 20 min en PHC (En progreso)
            'FECHA DE ATENCION': pd.Timestamp('2026-10-22'),
            'HORA DE ATENCION': '10:00:00',
            'FECHA_ATENCION_RAW': pd.Timestamp('2026-10-22 10:00:00'),
            'SERVICIO': '50110',
            'ID_CITA': 4758999,
            'BINARIO_ASISTIDA': 1,
            'BINARIO_ATENDIDA': 1,
            'BINARIO_PENDIENTE': 0
        }])

        df_phc = pd.DataFrame([{
            'doc_phc': '43529406',
            'hora_phc': '2026-10-22 15:40:00',
            'cup_phc': '50110',
            'Estado PHC': 'En progreso',
            'Orden': '30-421363202'
        }, {
            'doc_phc': '1036669074',
            'hora_phc': '2026-10-22 20:00:00',
            'cup_phc': '70101',
            'Estado PHC': 'En progreso',
            'Orden': '962233004'
        }, {
            'doc_phc': '999111222',
            'hora_phc': '2026-10-22 10:20:00',  # 20 min desplazada en PHC
            'cup_phc': '50110',
            'Estado PHC': 'En progreso',
            'Orden': '30-421363999'
        }])

        res = enrich_and_filter_phc(df_ag, df_phc)
        self.assertEqual(len(res), 3, "Todas las citas con estado 'En progreso' en PHC deben ser preservadas")
        for doc in ['43529406', '1036669074', '999111222']:
            sub = res[res['DOCUMENTO'] == doc]
            self.assertEqual(len(sub), 1)
            self.assertEqual(sub['ESTADO PHC'].iloc[0], 'En progreso')
            self.assertEqual(sub['BINARIO_PENDIENTE'].iloc[0], 1)
            self.assertEqual(sub['BINARIO_ATENDIDA'].iloc[0], 0)

    def test_audit_novedad_reprogramada_exclusion(self):
        from etl_processor import ETLProcessor
        proc = ETLProcessor()
        # Mock lean cache pack
        import pandas as pd
        df_pendientes = pd.DataFrame([{
            'ID_CITA': '1001',
            'DOCUMENTO': '111',
            'FECHA DE ATENCION': pd.Timestamp('2026-10-10'),
            'HORA DE ATENCION': '08:00:00',
            'NOMBRE IPS': 'Sede Centro',
            'NOMBRE PACIENTE': 'Paciente Uno',
            'PROGRAMA': 'Consulta Medicina General',
            'NOMBRE PROFESIONAL': 'Dr. Uno',
            'ESTADO PHC': 'Confirmada',
            'Nombre del mes': 'octubre',
            'Día': 10,
            'Año': 2026,
            'Cant': 1
        }, {
            'ID_CITA': '1002',
            'DOCUMENTO': '222',
            'FECHA DE ATENCION': pd.Timestamp('2026-10-10'),
            'HORA DE ATENCION': '09:00:00',
            'NOMBRE IPS': 'Sede Centro',
            'NOMBRE PACIENTE': 'Paciente Dos',
            'PROGRAMA': 'Consulta Medicina General',
            'NOMBRE PROFESIONAL': 'Dr. Dos',
            'ESTADO PHC': 'Confirmada',
            'Nombre del mes': 'octubre',
            'Día': 10,
            'Año': 2026,
            'Cant': 1
        }])
        cache_pack = {
            'pendientes': df_pendientes,
            'sedes_full': pd.DataFrame(),
            'medicos_full': pd.DataFrame()
        }
        # Sin feedback -> 2 pendientes
        s1 = proc._compute_summary(cache_pack, filters={'periodo': 'ambos'}, feedback_dict={})
        self.assertEqual(len(s1['detalle_pendientes']), 2)

        # Con feedback de Novedad -> 1001 debe ser excluida
        fb = {
            '1001': {'estado_phc': 'Novedad', 'estado': 'Novedad médica (incapacidad, calamidad, etc.)'}
        }
        s2 = proc._compute_summary(cache_pack, filters={'periodo': 'ambos'}, feedback_dict=fb)
        self.assertEqual(len(s2['detalle_pendientes']), 1)
        self.assertEqual(s2['detalle_pendientes'][0]['id_cita'], '1002')

        # Con feedback de Reprogramada -> 1002 debe ser excluida
        fb2 = {
            '1002': {'estado_phc': 'Reprogramada', 'estado': 'Paciente reagendado'}
        }
        s3 = proc._compute_summary(cache_pack, filters={'periodo': 'ambos'}, feedback_dict=fb2)
        self.assertEqual(len(s3['detalle_pendientes']), 1)
        self.assertEqual(s3['detalle_pendientes'][0]['id_cita'], '1001')

        # Con feedback de Error de dato -> 1001 debe ser excluida
        fb3 = {
            '1001': {'estado_phc': 'Error de dato', 'estado': 'Error de dato'}
        }
        s4 = proc._compute_summary(cache_pack, filters={'periodo': 'ambos'}, feedback_dict=fb3)
        self.assertEqual(len(s4['detalle_pendientes']), 1)
        self.assertEqual(s4['detalle_pendientes'][0]['id_cita'], '1002')

        # Con auditoría que marca finalizada/cerrada en PHC -> debe ser excluida
        fb4 = {
            '1001': {'estado_phc': 'Atendido en IPSA / Finalizada', 'estado': 'Historia ya cerrada en sistema'}
        }
        s5 = proc._compute_summary(cache_pack, filters={'periodo': 'ambos'}, feedback_dict=fb4)
        self.assertEqual(len(s5['detalle_pendientes']), 1)
        self.assertEqual(s5['detalle_pendientes'][0]['id_cita'], '1002')


class TestConcurrencyAndThreadSafety(unittest.TestCase):
    def test_concurrent_feedback_saving(self):
        threads = []
        errors = []

        def worker(worker_id):
            try:
                for i in range(5):
                    cid = f"test_concurrency_{worker_id}_{i}"
                    save_feedback_record(
                        id_cita=cid,
                        estado="En progreso",
                        observacion=f"Auditoría concurrente test hilo {worker_id}",
                        auditor="Test Runner",
                        cedula_auditor="1234"
                    )
            except Exception as e:
                errors.append(e)

        for w in range(5):
            t = threading.Thread(target=worker, args=(w,))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0, f"Ocurrieron errores de concurrencia: {errors}")

        fb = load_feedback()
        for w in range(5):
            for i in range(5):
                cid = f"test_concurrency_{w}_{i}"
                self.assertIn(cid, fb, f"El registro {cid} debería haber persistido correctamente")
                # Limpiar registro de test
                with _FEEDBACK_LOCK:
                    fb.pop(cid, None)
                    with open("feedback_store.json", "w", encoding="utf-8") as f:
                        json.dump(fb, f, ensure_ascii=False, indent=2)


class TestWebEnvironmentCompatibility(unittest.TestCase):
    def test_static_jsons_validity(self):
        for fname in ["dashboard_ultimo_mes.json", "dashboard_fechas_previas.json", "dashboard_ambos.json"]:
            path = os.path.join("static", "api", fname)
            self.assertTrue(os.path.exists(path), f"El archivo de caché web {path} debe existir para GitHub Pages")
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.assertIn("kpis", data)
            self.assertIn("sedes_summary", data)
            self.assertIn("medicos_pending", data)
            self.assertIn("detalle_pendientes", data)
            self.assertIn("filter_options", data)

    def test_index_and_static_index_sync(self):
        with open("index.html", "r", encoding="utf-8") as f1, open("static/index.html", "r", encoding="utf-8") as f2:
            self.assertEqual(f1.read(), f2.read(), "index.html y static/index.html deben estar estrictamente sincronizados para servidor local y GitHub Pages")


class TestSharePointAndWebImprovements(unittest.TestCase):
    def setUp(self):
        with open("static/app.js", "r", encoding="utf-8") as f:
            self.app_js = f.read()
        with open("static/styles.css", "r", encoding="utf-8") as f:
            self.styles_css = f.read()
        with open("index.html", "r", encoding="utf-8") as f:
            self.index_html = f.read()

    def test_strict_no_url_manipulation_for_sharepoint_privacy(self):
        """Los auditores ven el sistema en iframe de SharePoint.
        Cualquier manipulación de URL violaría la política de privacidad y sandbox de iframe."""
        forbidden_patterns = [
            "URLSearchParams",
            "history.pushState",
            "history.replaceState",
            "window.location.search",
            "window.location.hash"
        ]
        for pattern in forbidden_patterns:
            self.assertNotIn(
                pattern,
                self.app_js,
                f"No se permite manipular URLs en app.js ({pattern}) por restricciones de privacidad de SharePoint."
            )

    def test_removal_of_hourly_oportunidad_segmentations(self):
        """Verificar el retiro completo de segmentaciones, semaforizaciones y resúmenes de 24h/48h.
        Dado que las descargas se realizan cada 15 días, no tiene sentido segmentar por horas."""
        for pattern in ["toggleOportunidadFilter", "calculateOportunidad", "_oportunidad", "oportunidadHeaderPills"]:
            self.assertNotIn(
                pattern,
                self.app_js,
                f"El código {pattern} debe haber sido retirado de app.js"
            )
        self.assertNotIn("oportunidadHeaderPills", self.index_html)
        self.assertNotIn("badge-oportunidad", self.styles_css)
        self.assertNotIn("oportunidad-pill", self.styles_css)

    def test_improvement_2_faceted_counts(self):
        """Mejora: Contadores numéricos en desplegables (faceted counts)"""
        self.assertIn("ms-opt-count", self.styles_css)
        self.assertIn("zero-count", self.styles_css)
        self.assertIn("currentFilterCounts", self.app_js)
        self.assertIn("counts: counts", self.app_js)

    def test_improvement_3_progress_bars_tbl_sedes(self):
        """Mejora: Micro-barras de progreso visual en tblSedes"""
        self.assertIn("progress-cell-wrapper", self.styles_css)
        self.assertIn("progress-bar-fill", self.styles_css)
        self.assertIn("prog-green", self.styles_css)
        self.assertIn("prog-yellow", self.styles_css)
        self.assertIn("prog-red", self.styles_css)
        self.assertIn("progress-cell-wrapper", self.app_js)

    def test_improvement_4_page_size_selector(self):
        """Mejora: Selector de tamaño de página (25, 50, 100, 250)"""
        self.assertIn("onPageSizeChange", self.app_js)
        self.assertIn("selectPageSize", self.index_html)
        self.assertIn("select-page-size", self.styles_css)

    def test_improvement_5_pre_indexing_in_memory(self):
        """Mejora: Pre-indexación en memoria de atributos normalizados a 60 FPS"""
        self.assertIn("_sedeNorm", self.app_js)
        self.assertIn("_profNorm", self.app_js)
        self.assertIn("_progNorm", self.app_js)
    def test_modal_estado_phc_options_and_default(self):
        """Verificar que modalEstadoPHC no tenga estado por defecto y contenga únicamente los 6 estados definitivos."""
        import re
        # Extraer el bloque del select modalEstadoPHC de index.html
        match = re.search(r'<select id="modalEstadoPHC"[^>]*>(.*?)</select>', self.index_html, re.DOTALL)
        self.assertIsNotNone(match, "Debe existir el elemento select id='modalEstadoPHC'")
        select_block = match.group(1)

        # Verificar opción por defecto vacía
        self.assertIn('<option value="" selected>-- Seleccione estado actual en PHC --</option>', select_block)

        # Estados permitidos requeridos (6 definitivos)
        expected_states = [
            "En progreso",
            "Finalizada",
            "Inasistencia",
            "Pendiente",
            "Novedad",
            "Error de dato"
        ]
        for st in expected_states:
            self.assertIn(f'<option value="{st}">{st}</option>', select_block)

        # Estados confusos, retirados o no permitidos
        forbidden_states = [
            '<option value="Confirmada">',
            '<option value="Reprogramada">',
            '<option value="Atendido en IPSA / Finalizada">',
            '<option value="Asistida sin atención">',
            '<option value="Sin confirmar">',
            '<option value="Bloqueada">'
        ]
        for fst in forbidden_states:
            self.assertNotIn(fst, select_block, f"El estado {fst} no debe estar en modalEstadoPHC")

        # Verificar en app.js que openFeedbackModal inicialice selectPHC.value = ""
        self.assertIn('selectPHC.value = "";', self.app_js)
        self.assertNotIn('if (!selectPHC.value) selectPHC.value = "Confirmada";', self.app_js)

    def test_modal_cascading_notas_aclaratorias(self):
        """Verificar estructura de cascada de notas aclaratorias y obligatoriedad."""
        import re
        # Verificar NOTAS_POR_ESTADO_PHC en app_js
        self.assertIn("const NOTAS_POR_ESTADO_PHC = {", self.app_js)
        self.assertIn('"Historia en progreso"', self.app_js)
        self.assertIn('"Paciente con marcación de inasistencia"', self.app_js)
        self.assertIn('"Historia ya cerrada en PHC"', self.app_js)
        self.assertIn('"Paciente atendido con otro código o por otro profesional"', self.app_js)
        self.assertIn('"Paciente atendido pero historia no iniciada"', self.app_js)
        self.assertIn('"Historia pendiente por caída del sistema"', self.app_js)
        self.assertIn('"Paciente confirmado sin evidencia de historia ni notas aclaratorias"', self.app_js)
        self.assertIn('"Novedad médica (incapacidad, calamidad, etc)"', self.app_js)
        self.assertIn('"Paciente reagendado"', self.app_js)
        self.assertIn('"Tipo de servicio siempre aparece como pendiente"', self.app_js)
        self.assertIn('"No se permite registrar el servicio por medio de PHC"', self.app_js)
        self.assertIn('"Otros tipos de errores (describir en observaciones el error)"', self.app_js)

        # Verificar función onModalEstadoPHCChange
        self.assertIn("function onModalEstadoPHCChange", self.app_js)
        self.assertIn("selectNota.value = notas[0];", self.app_js)
        self.assertIn("-- Seleccione una Nota aclaratoria --", self.app_js)

        # Verificar modalNotaAclaratoria obligatorio en index.html
        match = re.search(r'<select id="modalNotaAclaratoria"[^>]*>(.*?)</select>', self.index_html, re.DOTALL)
        self.assertIsNotNone(match, "Debe existir select id='modalNotaAclaratoria'")
        self.assertIn('<option value="" selected>-- Primero seleccione un Estado --</option>', match.group(1))
        self.assertIn('<label>Nota aclaratoria (Obligatorio)</label>', self.index_html)

        # Verificar validación estricta de nota obligatoria en saveFeedback
        self.assertIn('if (!nota_aclaratoria) {', self.app_js)
        self.assertIn('Por favor seleccione la Nota aclaratoria (Obligatorio).', self.app_js)

    def test_version_synchronization(self):
        """Verificar que APP_CURRENT_VERSION en static/app.js coincida exactamente con version.json y static/version.json"""
        import re
        match = re.search(r'const\s+APP_CURRENT_VERSION\s*=\s*["\']([^"\']+)["\'];', self.app_js)
        self.assertIsNotNone(match, "Debe existir APP_CURRENT_VERSION en app.js")
        app_version = match.group(1)

        with open("version.json", "r", encoding="utf-8") as f:
            v_data = json.load(f)
        self.assertEqual(app_version, v_data.get("version"), "APP_CURRENT_VERSION en app.js debe ser idéntico a version.json")

        with open("static/version.json", "r", encoding="utf-8") as f:
            sv_data = json.load(f)
        self.assertEqual(app_version, sv_data.get("version"), "APP_CURRENT_VERSION en app.js debe ser idéntico a static/version.json")


class TestNewSuggestedImprovements(unittest.TestCase):
    def setUp(self):
        with open("static/app.js", "r", encoding="utf-8") as f:
            self.app_js = f.read()
        with open("static/styles.css", "r", encoding="utf-8") as f:
            self.styles_css = f.read()
        with open("index.html", "r", encoding="utf-8") as f:
            self.index_html = f.read()
        with open("static/index.html", "r", encoding="utf-8") as f:
            self.static_index_html = f.read()
        with open("server.py", "r", encoding="utf-8") as f:
            self.server_py = f.read()

    def test_kpi_cards_and_quick_filters(self):
        """Verificar presencia de tarjetas KPI ejecutivas y filtros rápidos (pills)"""
        self.assertIn("kpiCardsSection", self.index_html)
        self.assertIn("kpiValPendientes", self.index_html)
        self.assertIn("kpiValAvance", self.index_html)
        self.assertIn("kpiValTopSede", self.index_html)
        self.assertTrue("kpiValAuditadas" in self.index_html or "kpiValMoraCritica" in self.index_html)
        self.assertIn("function renderKpiCards", self.app_js)
        self.assertIn("function setQuickFilter", self.app_js)
        self.assertIn("quick-pill", self.index_html)
        self.assertIn("quick-pill", self.styles_css)

        # Validar los 6 filtros rápidos en orden: Todas, Sin Auditar, Auditadas, En Progreso, Especialistas, Médicos Generales
        expected_filters = ["all", "sin_auditar", "auditadas", "en_progreso", "especialistas", "medicos_generales"]
        for html, name in [(self.index_html, "index.html"), (self.static_index_html, "static/index.html")]:
            last_pos = -1
            for qf in expected_filters:
                pos = html.find(f'data-qfilter="{qf}"')
                self.assertGreater(pos, -1, f"Filtro {qf} no encontrado en {name}")
                self.assertGreater(pos, last_pos, f"El filtro {qf} debe aparecer en el orden correcto en {name}")
                last_pos = pos

        # Validar soporte en app.js para auditadas
        self.assertIn("if (activeQFilters.has('auditadas'))", self.app_js)

    def test_mora_aging_brackets_and_badges(self):
        """Verificar eliminación de filtros, tablas, gráficos y métricas de mora de historias"""
        for html in [self.index_html, self.static_index_html]:
            self.assertNotIn('col-mora', html)
            self.assertNotIn('colPick_mora', html)
            self.assertNotIn('data-qfilter="mora_critica"', html)
            self.assertNotIn('data-qfilter="mora_alta"', html)
            self.assertNotIn('id="btnChartModeMora"', html)
            self.assertNotIn('id="dashExecKpiMora"', html)

    def test_favorite_filters_feature(self):
        """Verificar botones y lógica de filtros favoritos en localStorage"""
        self.assertIn("btnSaveFavoriteFilter", self.index_html)
        self.assertIn("btnApplyFavoriteFilter", self.index_html)
        self.assertIn("function saveFavoriteFilter", self.app_js)
        self.assertIn("function applyFavoriteFilter", self.app_js)
        self.assertIn("function checkFavoriteFilterButton", self.app_js)

    def test_column_picker_customization(self):
        """Verificar selector dinámico de columnas visibles"""
        self.assertIn("columnPickerPopover", self.index_html)
        self.assertIn("toggleColumnPicker", self.app_js)
        self.assertIn("toggleColumnVisibility", self.app_js)
        self.assertIn("applyColumnVisibility", self.app_js)
        self.assertIn("col-hora", self.styles_css)
        self.assertIn("col-sede", self.styles_css)

    def test_global_multipage_selection(self):
        """Verificar banner y selector de todas las citas filtradas multi-página"""
        self.assertIn("globalSelectionBanner", self.index_html)
        self.assertIn("selectAllFilteredCitasGlobal", self.app_js)
        self.assertIn("clearGlobalSelection", self.app_js)
        self.assertIn("global-selection-banner", self.styles_css)

    def test_dark_mode_theme(self):
        """Verificar soporte completo de tema oscuro"""
        self.assertIn("btnToggleTheme", self.index_html)
        self.assertIn("body.dark-theme", self.styles_css)
        self.assertIn("function toggleTheme", self.app_js)
        self.assertIn("function initTheme", self.app_js)

    def test_productivity_modal_and_endpoint(self):
        """Verificar modal de productividad y endpoint backend /api/productivity"""
        self.assertIn("productivityModal", self.index_html)
        self.assertIn("tblProductivity", self.index_html)
        self.assertIn("openProductivityModal", self.app_js)
        self.assertIn("exportProductivityExcel", self.app_js)
        self.assertIn("/api/productivity", self.server_py)

    def test_multi_sheet_excel_export(self):
        """Verificar que las descargas de Excel generen las 3 hojas consolidada y detallada"""
        # Frontend SheetJS
        self.assertIn('"Resumen Sedes"', self.app_js)
        self.assertIn('"Por Profesional"', self.app_js)
        self.assertIn('"Detalle Citas"', self.app_js)
        # Backend openpyxl
        self.assertIn('title = "Resumen Sedes"', self.server_py)
        self.assertIn('title="Por Profesional"', self.server_py)
        self.assertIn('title="Detalle Citas"', self.server_py)

    def test_keyboard_shortcuts_and_snippets(self):
        """Verificar retiro de modal de atajos, presencia de filtro Especialistas y snippets de texto"""
        # Modal de atajos retirado
        self.assertNotIn("shortcutsModal", self.index_html)
        self.assertNotIn("openShortcutsModal", self.app_js)
        # Snippets de observación mantenidos
        self.assertIn("appendObservationSnippet", self.app_js)
        self.assertIn("btn-snippet", self.styles_css)
        # Filtros rápidos de Especialistas y Médicos Generales
        self.assertIn('data-qfilter="especialistas"', self.index_html)
        self.assertIn('data-qfilter="medicos_generales"', self.index_html)
        self.assertNotIn('data-qfilter="cambio_servicio"', self.index_html)
        self.assertIn("currentQuickFilter === 'especialistas'", self.app_js)
        self.assertIn("currentQuickFilter === 'medicos_generales'", self.app_js)
        # Limpieza de subtítulo repetitivo en encabezado y mayor ancho de fechas
        self.assertNotIn("AGENDAWEB • Unión para la Salud y la Vida S.A.S", self.index_html)
        self.assertIn("card-fechas-rango", self.styles_css)
        self.assertIn("275px", self.styles_css)
        # Reporte de productividad sin columna Cédula y con formateo local de fecha
        self.assertNotIn("Cédula (val.)", self.index_html)
        self.assertIn("formatLocalDateTime", self.app_js)
        self.assertIn("parse_gestion_datetime", self.server_py)

    def test_print_executive_report(self):
        """Verificar reporte imprimible / PDF ejecutivo"""
        self.assertIn("btnPrintReport", self.index_html)
        self.assertIn("printExecutiveReport", self.app_js)
        self.assertIn("@media print", self.styles_css)

    def test_multiselect_quickfilters_and_tbldetalle_redistribution(self):
        """Verificar multi-selección de filtros rápidos, pageSize=100 por defecto y redistribución de columnas tblDetalle"""
        self.assertIn("currentQuickFilters", self.app_js)
        self.assertIn("var pageSize = 100;", self.app_js)
        self.assertIn('<option value="100" selected>100</option>', self.index_html)
        self.assertIn(".col-paciente", self.styles_css)
        self.assertIn(".col-profesional", self.styles_css)

    def test_chart_meses_avance_toggle(self):
        """Verificar presencia de botones Total/Avance y funciones correspondientes para el gráfico de pendientes por mes"""
        self.assertIn("btnChartMesesTotal", self.index_html)
        self.assertIn("btnChartMesesStacked", self.index_html)
        self.assertIn("chartMesesTitle", self.index_html)
        self.assertIn("switchChartMesesMode", self.app_js)
        self.assertIn("renderChartMesesStacked", self.app_js)
        self.assertIn("var chartMesesMode", self.app_js)

    def test_numeral_1_dynamic_top_sedes(self):
        """Numeral 1: Verificar cálculo y asignación dinámica de Top 10 sedes sin mocks harcodeados"""
        with open("etl_processor.py", "r", encoding="utf-8") as f:
            etl_code = f.read()
        self.assertNotIn('"sede": "Especialistas", "NOMBRE IPS": "Especialistas", "pendientes": 105', etl_code)
        self.assertIn('"sedes_chart": sedes_chart_list,', etl_code)

    def test_numeral_4_safe_fallback(self):
        """Numeral 4: Fallback seguro sin datos sintéticos simulados que induzcan a error clínico"""
        with open("etl_processor.py", "r", encoding="utf-8") as f:
            etl_code = f.read()
        self.assertNotIn("n_rows = 35000", etl_code)
        self.assertNotIn("Datos Sintéticos (PowerBI Certificado)", etl_code)
        self.assertIn("Servicio No Disponible (Sin Conexión SQL ni Caché)", etl_code)
        
        from etl_processor import ETLProcessor
        proc = ETLProcessor(autostart=False)
        fallback_df = proc._generate_fallback_data()
        self.assertTrue(fallback_df.empty, "El fallback debe ser un DataFrame vacío sin inventar historias")
        lean = proc._build_lean_cache_package(fallback_df)
        self.assertEqual(lean["total_historico_asignadas"], 0)
        self.assertEqual(lean["total_historico_asistidas"], 0)
        self.assertTrue(lean["pendientes"].empty)

    def test_numeral_5_sql_nolock_optimization(self):
        """Numeral 5: Verificar aislamiento WITH (NOLOCK) en tablas de producción SQL Server"""
        with open("etl_processor.py", "r", encoding="utf-8") as f:
            etl_code = f.read()
        self.assertIn("dbo.tbl_citas_atendidas WITH (NOLOCK)", etl_code)
        self.assertIn("dbo.tbl_citas_phc WITH (NOLOCK)", etl_code)
        self.assertIn("tbl_usuarios WITH (NOLOCK)", etl_code)
        self.assertIn("tbl_personalsap WITH (NOLOCK)", etl_code)

    def test_numeral_8_gzip_compression_and_minified_json(self):
        """Numeral 8: Verificar compresión Gzip y serialización compacta en server.py y etl_processor.py"""
        with open("server.py", "r", encoding="utf-8") as f:
            srv_code = f.read()
        with open("etl_processor.py", "r", encoding="utf-8") as f:
            etl_code = f.read()

        self.assertIn("import gzip", srv_code)
        self.assertIn("Content-Encoding", srv_code)
        self.assertIn("gzip.compress", srv_code)
        self.assertIn("separators=(',', ':')", srv_code)
    def test_phc_policy_cutover_and_historical_integrity(self):
        """Verificar la política de corte 23/10/2026: histórico tbl_citas_atendidas hasta 22/10/2026 y PHC en adelante"""
        from etl_processor import PHC_POLICY_CUTOVER_DATE, HISTORICAL_MAX_DATE, resolve_ips_name
        self.assertEqual(PHC_POLICY_CUTOVER_DATE, "2026-10-23")
        self.assertEqual(HISTORICAL_MAX_DATE, "2026-10-22")

        # Verificar resolución canónica de sedes por código IPS de PHC
        self.assertEqual(resolve_ips_name("29"), "San Ignacio")
        self.assertEqual(resolve_ips_name("27"), "Envigado")
        self.assertEqual(resolve_ips_name("37"), "Bello")
        self.assertEqual(resolve_ips_name("34"), "Caldas")
        self.assertEqual(resolve_ips_name("2785"), "Parque Fabricato")

        # Verificar presencia de reglas de corte en etl_processor.py
        with open("etl_processor.py", "r", encoding="utf-8") as f:
            etl_code = f.read()
        self.assertTrue("fechaatencion <= '{HISTORICAL_MAX_DATE}'" in etl_code or "fechaatencion < DATEADD(day, 1, CAST('{HISTORICAL_MAX_DATE}' AS date))" in etl_code)
        self.assertIn("Hora >= '{PHC_POLICY_CUTOVER_DATE}'", etl_code)
        self.assertIn("p.Orden AS ID_CITA", etl_code)

        # Verificar presencia de reglas de corte en run_real_etl.py
        with open("run_real_etl.py", "r", encoding="utf-8") as f:
            run_code = f.read()
        self.assertTrue("fechaatencion <= '{HISTORICAL_MAX_DATE}'" in run_code or "fechaatencion < DATEADD(day, 1, CAST('{HISTORICAL_MAX_DATE}' AS date))" in run_code)
        self.assertIn("Hora >= '{PHC_POLICY_CUTOVER_DATE}'", run_code)
        self.assertIn("p.Orden AS ID_CITA", run_code)

        # Verificar que google_sheets.py consulte tbl_citas_phc por Orden y limite tbl_citas_atendidas a 2026-10-22
        with open("google_sheets.py", "r", encoding="utf-8") as f:
            gs_code = f.read()
        self.assertIn("FROM dbo.tbl_citas_phc WITH (NOLOCK)", gs_code)
        self.assertIn("WHERE Orden = ?", gs_code)
        self.assertIn("WHERE identitycitas = ?", gs_code)
        self.assertIn("fechaatencion <= '2026-10-22'", gs_code)

    def test_dashboard_redistribution_and_clean_header(self):
        """Verificar los 4 requerimientos:
        1. Gráfico de programas con nombres legibles (afterFit y formatChartProgramLabel)
        2. tblMedicos con 4 columnas, sin Especialidad, y anchos ampliados
        3. Header institucional limpio (solo logo, título y fecha de actualización)
        4. Botones agrupados en mini-action-toolbar
        5. Dashboard modal con mini KPIs y agrupación de los 3 gráficos
        """
        # 1. Header limpio en index.html
        self.assertIn('class="app-header"', self.index_html)
        self.assertIn('id="updateDate"', self.index_html)
        header_part = self.index_html.split('<nav class="mini-action-toolbar"')[0]
        self.assertNotIn('btnProductivity', header_part, "btnProductivity no debe estar en app-header")
        self.assertNotIn('btnRefreshLive', header_part, "btnRefreshLive no debe estar en app-header")

        # 2. Mini Action Toolbar
        self.assertIn('class="mini-action-toolbar"', self.index_html)
        self.assertTrue('id="btnOpenDashboard"' in self.index_html or 'id="btnViewDashboard"' in self.index_html)
        self.assertIn('id="btnProductivity"', self.index_html)
        self.assertIn('id="btnRefreshLive"', self.index_html)
        self.assertIn('id="btnToggleTheme"', self.index_html)

        # 3. tblMedicos sin Especialidad y con 4 columnas
        self.assertNotIn('<th>Especialidad</th>', self.index_html)
        self.assertIn('col-medico-prof', self.index_html)
        self.assertIn('col-medico-doc', self.index_html)
        self.assertIn('col-medico-pend', self.index_html)
        self.assertNotIn('{ key: "specialty", type: "string" }', self.app_js)

        # 4. Dashboard como Página Integrada
        self.assertTrue('id="dashboardModal"' in self.index_html or 'id="viewDashboardAnalytics"' in self.index_html)
        self.assertTrue('dashboard-mini-kpi-row' in self.index_html)
        self.assertIn('id="chartProgramas"', self.index_html)
        self.assertIn('id="chartSedesPct"', self.index_html)
        self.assertIn('id="chartMeses"', self.index_html)
        self.assertIn('function openDashboardModal()', self.app_js)
        self.assertIn('function closeDashboardModal()', self.app_js)
        self.assertIn('function updateDashboardModalKPIs()', self.app_js)
        self.assertIn('function switchMainView(', self.app_js)
        self.assertIn('chartAuditoresGestiones', self.app_js)
        self.assertIn('chartEstadosAuditoria', self.app_js)
        self.assertIn('chartInconsistenciasProgramas', self.app_js)

        # 5. Program chart labels formatting
        self.assertIn('function formatChartProgramLabel(', self.app_js)
        self.assertIn('afterFit: function (axis)', self.app_js)

        # 6. Grid middle a 1fr para detalle amplio
        self.assertIn('grid-template-columns: 1fr;', self.styles_css)

    def test_dashboard_audits_and_closed_kpi(self):
        """Verificar la nueva tarjeta KPI 'Cerradas al Auditar' y el universo completo de auditorías"""
        import os
        import json

        # 1. Tarjeta en index.html y static/index.html
        self.assertIn('id="cardKpiCerradasPHC"', self.index_html)
        self.assertIn('id="dashExecKpiCerradas"', self.index_html)
        self.assertIn('id="dashExecKpiBadgeCerradas"', self.index_html)
        self.assertIn('CERRADAS AL AUDITAR', self.index_html)

        # 2. Lógica en app.js para cálculo de cerradas al auditar y filtrado de auditorías
        self.assertIn('getFilteredFeedbackList', self.app_js)
        self.assertIn('cerradasAlAuditarList', self.app_js)
        self.assertIn('dashExecKpiCerradas', self.app_js)
        self.assertIn('renderChartAuditoresGestiones(filteredFb)', self.app_js)
        self.assertIn('renderChartEstadosAuditoria(filteredFb', self.app_js)

        # 3. Archivo estático fallback de feedback existe y tiene más de 1900 auditorías
        fb_path = os.path.join('static', 'api', 'feedback.json')
        self.assertTrue(os.path.exists(fb_path), "static/api/feedback.json debe existir para modo offline/estático")
        with open(fb_path, 'r', encoding='utf-8') as f:
            fb_data = json.load(f)                                                                                                                                                                                                                                                                                                      
        self.assertGreaterEqual(len(fb_data), 1900, "Debe contener el universo de más de 1.900 auditorías")

    def test_dashboard_single_row_kpis_and_vertical_spacing(self):
        """Verificar requerimientos de:
        1. Espacio separador vertical entre elementos (.main-view-container con gap)
        2. Tarjetas informativas en 1 sola fila de 7 columnas
        3. Integridad de cálculo de Mora Crítica en el Dashboard Analytics
        """
        # 1. Espaciador vertical en vistas
        self.assertIn('.main-view-container', self.styles_css)
        self.assertIn('flex-direction: column', self.styles_css)

        # 2. Tarjetas en 1 sola fila de 7 columnas
        self.assertIn('repeat(7, minmax(0, 1fr))', self.styles_css)
        self.assertIn('.dashboard-exec-kpis-grid', self.styles_css)

        # 3. Integridad de datos en Avance y Cobertura
        self.assertIn('dashExecKpiAuditadas', self.app_js)
        self.assertIn('totalIncons = allProgs.reduce', self.app_js)

        # 4. Integridad de inconsistencias proyectando divergencias y errores del universo auditado
        self.assertIn('getInconsistenciasByPrograma(detalle, filteredFb)', self.app_js)
        self.assertIn('renderChartInconsistenciasProgramas(detalle, filteredFb)', self.app_js)
        self.assertIn('renderTblInconsistenciasProgramas(detalle, filteredFb)', self.app_js)

    def test_dashboard_bugfixes_spacing_filters_and_programs(self):
        """Verificar los 3 requerimientos del usuario:
        1. Separación vertical garantizada en .main-view-container y switchMainView usando display flex
        2. Respuesta de gráficos y KPIs a filtros de Fecha, Mes, Día, Quincena, Sede, Programa, etc.
        3. Preservación del programa asistencial en sincronización en vivo y sin colapso a Consulta Medicina General
        """
        # 1. Separación vertical en CSS y JS
        self.assertIn('.main-view-container {', self.styles_css)
        self.assertIn('gap: 14px !important;', self.styles_css)
        self.assertIn('viewDash.style.display = "flex";', self.app_js)
        self.assertIn('viewSeg.style.display = "flex";', self.app_js)
        self.assertNotIn('viewSeg.style.display = "block";', self.app_js)
        self.assertNotIn('viewDash.style.display = "block";', self.app_js)

        # 2. getFilteredFeedbackList evalúa todos los filtros (Año, Mes, Día, Quincena, Sede, Programa, etc.)
        self.assertIn('const anoFilterList', self.app_js)
        self.assertIn('const mesFilterList', self.app_js)
        self.assertIn('const diaFilterList', self.app_js)
        self.assertIn('const quinFilterList', self.app_js)
        self.assertIn('dp.mesName', self.app_js)
        self.assertIn('quinFilterList.some', self.app_js)

        # 3. Preservación de programa en sincronización con Google Sheets y getInconsistenciasByPrograma
        self.assertIn('const newLocalStore = { ...localFeedbackStore };', self.app_js)
        self.assertIn('r.programa || prev.programa', self.app_js)
        self.assertIn('const apptProgLookup', self.app_js)
        self.assertIn('apptProgLookup[cid]', self.app_js)

    def test_program_error_rate_vs_total_audits(self):
        """Verificar que el análisis de inconsistencias compara errores de datos contra la totalidad
        de auditorías de cada programa, excluyendo divergencias CUP:
        % Error = Errores de dato / Total auditorías
        Ej: Dislipidemia tiene 255 errores de 279 auditorías (91.4%)
        """
        import json

        # 1. Validación en index.html de las nuevas columnas de la tabla
        self.assertTrue('Total Auditorías' in self.index_html or 'Total Audit.' in self.index_html)
        self.assertTrue('Errores de Dato' in self.index_html or 'Errores' in self.index_html)
        self.assertIn('% Error', self.index_html)

        # 2. Validación en app.js de la lógica de tasa de error y barra única integrada
        self.assertIn('p.pctError = p.totalAuditorias > 0 ? ((p.errores / p.totalAuditorias) * 100) : 0;', self.app_js)
        self.assertIn("label: 'Errores de Dato'", self.app_js)
        self.assertIn("label: 'Auditorías Sin Error'", self.app_js)
        self.assertIn('stacked: true', self.app_js)

        # 3. Validación con datos reales de feedback_store.json
        with open('feedback_store.json', 'r', encoding='utf-8') as f:
            feedbacks = json.load(f)

        dislip_audits = [v for v in feedbacks.values() if 'dislipidemia' in (v.get('programa') or '').lower() and 'control' in (v.get('programa') or '').lower()]
        self.assertGreaterEqual(len(dislip_audits), 270, "Dislipidemia debe tener al menos 270 registros de auditoría")

        dislip_errors = [v for v in dislip_audits if any(w in ((v.get('estado') or '') + ' ' + (v.get('nota_aclaratoria') or '') + ' ' + (v.get('estado_phc') or '')).lower() for w in ['error', 'novedad'])]
        self.assertGreaterEqual(len(dislip_errors), 250, "Dislipidemia debe tener al menos 250 errores de dato")

        error_rate = (len(dislip_errors) / len(dislip_audits)) * 100
        self.assertGreaterEqual(error_rate, 80.0, msg="La tasa de error de Dislipidemia debe ser >80%")

    def test_program_error_sorting_by_error_percentage(self):
        """Verificar que en getInconsistenciasByPrograma el ordenamiento de los programas
        sea por porcentaje de error de mayor a menor (b.pctError - a.pctError).
        """
        self.assertIn("b.pctError - a.pctError || b.errores - a.errores", self.app_js,
                      "Los programas con errores deben estar ordenados descendentemente por % de error")

    def test_medicos_chart_datalabels_at_right(self):
        """Verificar que en renderChartDemoraMedicos los valores se distribuyan al lado derecho
        con el formato 'pendientes / total (pct%)', sin saturar el interior de las barras,
        con padding derecho suficiente en el canvas.
        """
        # Verificar que el padding derecho sea de 145px
        self.assertIn("layout: { padding: { right: 145, top: 4, bottom: 4, left: 6 } }", self.app_js)
        # Verificar que el formatter genere el formato 'pendientes / total (pct%)'
        self.assertIn("${(m.pendientes || 0).toLocaleString('es-CO')} / ${(m.total || 0).toLocaleString('es-CO')} (${pct}%)", self.app_js)
        # Verificar que el plugin datalabels use anchor: 'end' y align: 'end'
        self.assertIn("anchor: 'end'", self.app_js)
        self.assertIn("align: 'end'", self.app_js)

    def test_resumen_general_contains_all_charts(self):
        """Verificar que en 'Resumen General' se encuentren reunidos todos los gráficos
        y tablas analíticas para posibilitar análisis globales integrales.
        """
        required_chart_ids = [
            "chartEstadosAuditoria",
            "chartInconsistenciasProgramas",
            "chartDemoraMeses",
            "chartMeses",
            "chartDemoraMedicos",
            "chartDemoraSedes",
            "chartSedesPct",
            "chartProgramas",
            "tblInconsistenciasProgramas",
            "chartAuditoresGestiones"
        ]

        with open("static/index.html", "r", encoding="utf-8") as f:
            static_index_html = f.read()

        # Validar en index.html y static/index.html
        for html_content, path_name in [(self.index_html, "index.html"), (static_index_html, "static/index.html")]:
            self.assertIn('id="dashAnalyticsContainer"', html_content, f"Falta dashAnalyticsContainer en {path_name}")
            for cid in required_chart_ids:
                self.assertIn(f'id="{cid}"', html_content, f"El gráfico {cid} debe existir en {path_name}")

            # Validar que se eliminó la tarjeta RESUMEN DE INDICADORES OPERATIVOS
            self.assertNotIn("RESUMEN DE INDICADORES OPERATIVOS", html_content, f"RESUMEN DE INDICADORES OPERATIVOS debe estar eliminado de {path_name}")
            self.assertNotIn('id="badgeResumenMoraCritica"', html_content, f"badgeResumenMoraCritica debe estar eliminado de {path_name}")

            # Validar distribución en filas de 3 columnas
            self.assertIn("dashboard-analytics-row-3col", html_content, f"Debe haber filas de 3 columnas en {path_name}")

            # Validar que el gráfico de errores y la tabla de inconsistencias compartan la misma fila
            pos_chart_incons = html_content.find('id="chartInconsistenciasProgramas"')
            pos_tbl_incons = html_content.find('id="tblInconsistenciasProgramas"')
            self.assertGreater(pos_chart_incons, 0)
            self.assertGreater(pos_tbl_incons, 0)
            # Buscar el inicio de la fila que los contiene
            row_start = html_content.rfind('<div class="dashboard-analytics-row dash-analytics-section"', 0, pos_chart_incons)
            row_end = html_content.find('<!-- FILA 4:', row_start)
            self.assertGreater(row_start, 0)
            self.assertTrue(pos_chart_incons < row_end and pos_tbl_incons < row_end,
                            f"El gráfico de errores y la tabla de inconsistencias deben estar en la misma fila en {path_name}")

        # Validar que switchDashboardTab muestre todas las secciones en 'general'
        self.assertIn("if (tabName === 'general')", self.app_js)
        self.assertIn("sec.style.display = '';", self.app_js)

    def test_no_redundant_chart_meses_vstotal(self):
        """Validar que no exista el botón redundante btnChartMesesVsTotal que clonaba MESES - CIERRE"""
        for html_content, path_name in [(self.index_html, "index.html"), (self.static_index_html, "static/index.html")]:
            self.assertNotIn('id="btnChartMesesVsTotal"', html_content, f"btnChartMesesVsTotal no debe existir en {path_name}")
            self.assertIn('id="btnChartMesesTotal"', html_content, f"btnChartMesesTotal debe existir en {path_name}")
            self.assertIn('id="btnChartMesesStacked"', html_content, f"btnChartMesesStacked debe existir en {path_name}")
            self.assertIn('id="chartDemoraMeses"', html_content, f"chartDemoraMeses debe existir en {path_name}")
            self.assertIn('id="chartMeses"', html_content, f"chartMeses debe existir en {path_name}")
        
        # Validar que app.js no intente renderizar renderChartDemoraMeses dentro de chartMeses
        self.assertNotIn('renderChartDemoraMeses(data.demora_meses, "comparativa", "chartMeses")', self.app_js)

    def test_inconsistencias_programas_all_labels_visible(self):
        """Validar que el gráfico de inconsistencias muestre todos los programas sin omitir etiquetas en el eje Y"""
        for html_content, path_name in [(self.index_html, "index.html"), (self.static_index_html, "static/index.html")]:
            self.assertIn('id="wrapperChartInconsistencias"', html_content, f"wrapperChartInconsistencias debe existir en {path_name}")
        
        self.assertIn("autoSkip: false", self.app_js, "El eje Y de inconsistencias debe tener autoSkip: false para no omitir programas")
        self.assertNotIn("allProgs.slice(0, 8)", self.app_js, "No debe recortar arbitrariamente a 8 programas")

    def test_auditores_gestiones_fecha_gestion_octubre(self):
        """Validar que las gestiones por auditor se filtren y evalúen por fecha_gestion
        (cuando se hizo la auditoría) y no por fecha_cita (fecha de la cita clínica).
        Ana María Vergara debe tener >600 auditorías en octubre de 2026.
        """
        import json

        # 1. Validar en app.js que se priorice fb.fecha_gestion
        self.assertIn('const fgRaw = (fb.fecha_gestion || fb.fecha_cita', self.app_js,
                      "getFilteredFeedbackList debe priorizar fb.fecha_gestion sobre fb.fecha_cita")
        self.assertIn('parseIsoDate(fgRaw)', self.app_js)
        self.assertIn('parseDateParts(fgRaw)', self.app_js)

        # 2. Validar que en feedback_store.json, al filtrar por fecha_gestion en octubre (2026-10),
        # Ana Maria Vergara tenga más de 600 auditorías y el total sea >2000
        with open('feedback_store.json', 'r', encoding='utf-8') as f:
            feedbacks = json.load(f)

        oct_audits_anamaria = [
            v for v in feedbacks.values()
            if (v.get('fecha_gestion') or '').startswith('2026-10')
            and 'ana maria vergara' in (v.get('auditor') or '').lower()
        ]
        self.assertGreaterEqual(
            len(oct_audits_anamaria),
            600,
            f"Ana María Vergara debe tener >600 auditorías realizadas en octubre, se encontraron {len(oct_audits_anamaria)}"
        )

        total_oct_gestiones = sum(
            1 for v in feedbacks.values()
            if (v.get('fecha_gestion') or '').startswith('2026-10')
        )
        self.assertGreaterEqual(
            total_oct_gestiones,
            2000,
            f"El total de gestiones en octubre debe ser superior a 2000, se encontraron {total_oct_gestiones}"
        )


if __name__ == "__main__":
    unittest.main()



