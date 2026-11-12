@echo off
chcp 65001 >nul
title Asistente de Tareas Programadas - Cierre de Historias
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0programar_tarea.ps1"
if %errorlevel% neq 0 (
    echo.
    echo Si ocurrio algun problema al abrir el asistente, haz clic derecho sobre 'programar_tarea.ps1' y selecciona 'Ejecutar con PowerShell'.
    pause
)
