@echo off
chcp 65001 >nul
title Asistente de Programación de Tarea Windows - Cierre de Historias

echo =======================================================================
echo  ASISTENTE PARA PROGRAMAR ACTUALIZACION DIARIA DESATENDIDA EN WINDOWS
echo =======================================================================
echo.
echo Este asistente programa una tarea en el "Programador de Tareas de Windows"
echo para que la base de datos, las auditorías y GitHub se actualicen
echo automáticamente todos los días a la hora que elijas.
echo.
echo Archivo a ejecutar: "%~dp0actualizar_diario.bat"
echo.

set "TASK_NAME=ActualizacionDiariaCierreHistorias"
set "BAT_PATH=%~dp0actualizar_diario.bat"

echo Opciones:
echo  [1] Crear / Actualizar tarea para ejecutarse a las 06:00 AM todos los días (Recomendado)
echo  [2] Personalizar hora de ejecución diaria (ej: 05:30, 07:00, 22:00)
echo  [3] Probar ejecución inmediata de la tarea programada
echo  [4] Ver estado de la tarea programada
echo  [5] Eliminar tarea programada
echo  [6] Salir
echo.

set /p OPT="Seleccione una opción (1-6): "

if "%OPT%"=="1" goto CREAR_DEFAULT
if "%OPT%"=="2" goto CREAR_CUSTOM
if "%OPT%"=="3" goto EJECUTAR_AHORA
if "%OPT%"=="4" goto VER_ESTADO
if "%OPT%"=="5" goto ELIMINAR
if "%OPT%"=="6" goto SALIR

:CREAR_DEFAULT
set "HORA=06:00"
goto APLICAR_TAREA

:CREAR_CUSTOM
echo.
set /p HORA="Ingrese la hora en formato 24 horas (HH:MM, ej: 05:30): "
if "%HORA%"=="" set "HORA=06:00"
goto APLICAR_TAREA

:APLICAR_TAREA
echo.
echo Creando tarea programada "%TASK_NAME%" para las %HORA% diariamente...
schtasks /create /tn "%TASK_NAME%" /tr "\"%BAT_PATH%\"" /sc daily /st %HORA% /f /rl HIGHEST
if %ERRORLEVEL% equ 0 (
    echo.
    echo =======================================================================
    echo  ¡TAREA PROGRAMADA EXITOSAMENTE!
    echo  Nombre: %TASK_NAME%
    echo  Frecuencia: Todos los días a las %HORA%
    echo  Acción: %BAT_PATH%
    echo =======================================================================
) else (
    echo.
    echo [AVISO] Si la creación falló por permisos de administrador, haz clic derecho
    echo sobre este archivo .bat y selecciona "Ejecutar como administrador".
)
goto PAUSA_FINAL

:EJECUTAR_AHORA
echo.
echo Iniciando tarea "%TASK_NAME%" en segundo plano...
schtasks /run /tn "%TASK_NAME%"
goto PAUSA_FINAL

:VER_ESTADO
echo.
schtasks /query /tn "%TASK_NAME%" /fo LIST /v
goto PAUSA_FINAL

:ELIMINAR
echo.
schtasks /delete /tn "%TASK_NAME%" /f
if %ERRORLEVEL% equ 0 (
    echo Tarea "%TASK_NAME%" eliminada correctamente.
)
goto PAUSA_FINAL

:PAUSA_FINAL
echo.
echo Presione cualquier tecla para salir...
pause >nul

:SALIR
