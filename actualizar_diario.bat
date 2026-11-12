@echo off
chcp 65001 >nul
title Actualización Diaria - Seguimiento Agendaweb Cierre de Historias

echo =======================================================================
echo  ACTUALIZACION DIARIA AUTOMATICA - CIERRE DE HISTORIAS CLINICAS
echo =======================================================================
echo Fecha y hora de inicio: %DATE% %TIME%
echo Directorio de trabajo: %~dp0
echo.

cd /d "%~dp0"

:: 1. Detectar interprete Python
set "PYTHON_EXE=C:\Users\Medico Apoyo TI\AppData\Roaming\uv\python\cpython-3.11-windows-x86_64-none\python.exe"
if not exist "%PYTHON_EXE%" (
    set "PYTHON_EXE=python"
)

echo Utilizando interprete Python: %PYTHON_EXE%
echo.

:: 2. Ejecutar script de actualizacion integral y publicacion a GitHub
"%PYTHON_EXE%" "%~dp0actualizar_y_publicar.py" %*

set EXIT_CODE=%ERRORLEVEL%
echo.
echo =======================================================================
if %EXIT_CODE% equ 0 (
    echo  PROCESO COMPLETADO EXITOSAMENTE [CODIGO: 0]
) else (
    echo  ERROR DURANTE LA EJECUCION [CODIGO: %EXIT_CODE%]
)
echo Fecha y hora de finalizacion: %DATE% %TIME%
echo =======================================================================

exit /b %EXIT_CODE%
