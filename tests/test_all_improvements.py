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
        with open("server.py", "r", encoding="utf-8") as f:
            self.server_py = f.read()

    def test_kpi_cards_and_quick_filters(self):
        """Verificar presencia de tarjetas KPI ejecutivas y filtros rápidos (pills)"""
        self.assertIn("kpiCardsSection", self.index_html)
        self.assertIn("kpiValPendientes", self.index_html)
        self.assertIn("kpiValAvance", self.index_html)
        self.assertIn("kpiValTopSede", self.index_html)
        self.assertIn("kpiValMoraCritica", self.index_html)
        self.assertIn("function renderKpiCards", self.app_js)
        self.assertIn("function setQuickFilter", self.app_js)
        self.assertIn("quick-pill", self.index_html)
        self.assertIn("quick-pill", self.styles_css)

    def test_mora_aging_brackets_and_badges(self):
        """Verificar cálculo y semaforización de antigüedad / mora por días"""
        self.assertIn("function calculateMoraDias", self.app_js)
        self.assertIn("badge-mora-green", self.styles_css)
        self.assertIn("badge-mora-yellow", self.styles_css)
        self.assertIn("badge-mora-orange", self.styles_css)
        self.assertIn("badge-mora-red", self.styles_css)
        self.assertIn("col-mora", self.styles_css)

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


if __name__ == "__main__":
    unittest.main()

