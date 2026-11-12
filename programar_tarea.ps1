# -*- coding: utf-8 -*-
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Asistente de Tareas Programadas - Cierre de Historias"

$taskName = "ActualizacionDiariaCierreHistorias"
$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $baseDir) { $baseDir = Get-Location }
$batPath = Join-Path $baseDir "actualizar_diario.bat"

function Show-Header {
    Clear-Host
    Write-Host "=======================================================================" -ForegroundColor Cyan
    Write-Host "  ASISTENTE DE ACTUALIZACIÓN DIARIA AUTOMÁTICA (WINDOWS TASK SCHEDULER)" -ForegroundColor Yellow
    Write-Host "=======================================================================" -ForegroundColor Cyan
    Write-Host "Carpeta del programa : $baseDir" -ForegroundColor Gray
    Write-Host "Archivo a ejecutar   : $batPath" -ForegroundColor Gray
    Write-Host ""
    
    # Consultar estado actual de la tarea
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
        Write-Host "Estado de la tarea actual:" -ForegroundColor White
        Write-Host "  - Nombre           : $($existing.TaskName)" -ForegroundColor Green
        Write-Host "  - Estado           : $($existing.State)" -ForegroundColor Green
        if ($existing.Triggers -and $existing.Triggers[0].StartBoundary) {
            $horaProg = $existing.Triggers[0].StartBoundary.Substring(11, 5)
            Write-Host "  - Hora programada  : $horaProg (Diariamente)" -ForegroundColor Green
        }
        if ($taskInfo) {
            $lastRun = if ($taskInfo.LastRunTime -and $taskInfo.LastRunTime.Year -gt 2000) { $taskInfo.LastRunTime } else { "Pendiente" }
            Write-Host "  - Última ejecución : $lastRun (Resultado: $($taskInfo.LastTaskResult))" -ForegroundColor Gray
            Write-Host "  - Próxima ejecución: $($taskInfo.NextRunTime)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Estado de la tarea actual: NO ESTÁ INSTALADA" -ForegroundColor DarkYellow
    }
    Write-Host "-----------------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
}

function Registrar-Tarea([string]$hora) {
    Write-Host ""
    Write-Host "Configurando tarea programada para las $hora diariamente..." -ForegroundColor Cyan
    
    try {
        $action = New-ScheduledTaskAction `
            -Execute "cmd.exe" `
            -Argument "/c `"$batPath`"" `
            -WorkingDirectory $baseDir

        $trigger = New-ScheduledTaskTrigger -Daily -At $hora

        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -ExecutionTimeLimit (New-TimeSpan -Hours 2)

        $res = Register-ScheduledTask `
            -TaskName $taskName `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -Description "Actualización automática de base de datos SQL, auditorías de Google Sheets y publicación en GitHub para Seguimiento Agendaweb." `
            -Force

        Write-Host ""
        Write-Host "=======================================================================" -ForegroundColor Green
        Write-Host " ¡TAREA PROGRAMADA EXITOSAMENTE!" -ForegroundColor Green
        Write-Host "=======================================================================" -ForegroundColor Green
        Write-Host " Nombre     : $($res.TaskName)" -ForegroundColor White
        Write-Host " Frecuencia : Todos los días a las $hora" -ForegroundColor White
        Write-Host " Acción     : $batPath" -ForegroundColor White
        Write-Host " Estado     : $($res.State)" -ForegroundColor White
        Write-Host "=======================================================================" -ForegroundColor Green
    } catch {
        Write-Host ""
        Write-Host "ERROR al registrar la tarea: $_" -ForegroundColor Red
        Write-Host "Sugerencia: si es necesario, ejecuta el archivo haciendo clic derecho -> 'Ejecutar con PowerShell' o 'Ejecutar como administrador'." -ForegroundColor Yellow
    }
}

do {
    Show-Header
    Write-Host "Seleccione una opción:" -ForegroundColor White
    Write-Host " [1] Programar a las 06:00 AM todos los días (Recomendado)" -ForegroundColor Yellow
    Write-Host " [2] Personalizar hora de ejecución diaria (ej: 05:30, 07:00, 22:00)" -ForegroundColor White
    Write-Host " [3] Probar ejecución inmediata de la tarea" -ForegroundColor Cyan
    Write-Host " [4] Ver historial y registro de ejecuciones (registro_actualizacion.log)" -ForegroundColor White
    Write-Host " [5] Eliminar tarea programada" -ForegroundColor Red
    Write-Host " [6] Salir" -ForegroundColor Gray
    Write-Host ""
    
    $opt = Read-Host "Ingrese su opción (1-6)"
    
    switch ($opt) {
        "1" {
            Registrar-Tarea "06:00"
            Write-Host ""
            Read-Host "Presione Enter para continuar"
        }
        "2" {
            $h = Read-Host "Ingrese la hora diaria en formato 24h (HH:MM, ej: 05:30)"
            if (-not $h -or $h -notmatch '^\d{2}:\d{2}$') {
                Write-Host "Hora inválida. Usando 06:00 por defecto." -ForegroundColor DarkYellow
                $h = "06:00"
            }
            Registrar-Tarea $h
            Write-Host ""
            Read-Host "Presione Enter para continuar"
        }
        "3" {
            Write-Host ""
            Write-Host "Iniciando tarea '$taskName'..." -ForegroundColor Cyan
            try {
                Start-ScheduledTask -TaskName $taskName
                Write-Host "Tarea iniciada. Puedes revisar el progreso en 'registro_actualizacion.log'." -ForegroundColor Green
            } catch {
                Write-Host "Error iniciando tarea: $_" -ForegroundColor Red
            }
            Write-Host ""
            Read-Host "Presione Enter para continuar"
        }
        "4" {
            Write-Host ""
            $logPath = Join-Path $baseDir "registro_actualizacion.log"
            if (Test-Path $logPath) {
                Write-Host "=== ÚLTIMAS 25 LÍNEAS DE registro_actualizacion.log ===" -ForegroundColor Cyan
                Get-Content $logPath -Tail 25
            } else {
                Write-Host "El archivo de log aún no ha sido creado." -ForegroundColor DarkYellow
            }
            Write-Host ""
            Read-Host "Presione Enter para continuar"
        }
        "5" {
            Write-Host ""
            $confirm = Read-Host "¿Está seguro de eliminar la tarea '$taskName'? (S/N)"
            if ($confirm -eq 'S' -or $confirm -eq 's') {
                try {
                    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
                    Write-Host "Tarea '$taskName' eliminada correctamente." -ForegroundColor Green
                } catch {
                    Write-Host "Error eliminando tarea: $_" -ForegroundColor Red
                }
            }
            Write-Host ""
            Read-Host "Presione Enter para continuar"
        }
        "6" {
            break
        }
        default {
            Write-Host "Opción inválida." -ForegroundColor Red
            Start-Sleep -Seconds 1
        }
    }
} while ($opt -ne "6")
