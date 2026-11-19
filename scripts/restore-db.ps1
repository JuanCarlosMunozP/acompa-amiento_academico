# Restaura un respaldo creado con backup-db.ps1 sobre la base de Docker.
#
# ATENCIÓN: reemplaza TODOS los datos actuales de tutorias_db. Antes de restaurar se crea
# automáticamente un respaldo de seguridad del estado actual.
#
# Uso: .\scripts\restore-db.ps1 -Archivo backups\tutorias_20261107_120000.dump [-Si]
param(
    [Parameter(Mandatory = $true)][string]$Archivo,
    [switch]$Si   # omite la confirmación interactiva
)

# "Continue": docker escribe su progreso en stderr y PowerShell 5.1 lo tomaría por error.
# Los fallos reales se detectan con $LASTEXITCODE.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path $Archivo)) { throw "No existe el archivo: $Archivo" }
    $Archivo = (Resolve-Path $Archivo).Path

    if (-not $Si) {
        $r = Read-Host "Esto reemplazará los datos actuales de tutorias_db. ¿Continuar? (escribe SI)"
        if ($r -ne "SI") { Write-Host "Cancelado."; return }
    }

    Write-Host "Creando respaldo de seguridad del estado actual..."
    & (Join-Path $PSScriptRoot "backup-db.ps1")

    docker compose cp $Archivo "db:/tmp/restaurar.dump"
    if ($LASTEXITCODE -ne 0) { throw "No se pudo copiar el respaldo al contenedor." }

    # Detiene el backend para que no haya conexiones abiertas durante la restauración.
    docker compose stop backend | Out-Null
    try {
        docker compose exec -T db pg_restore -U tutorias_user -d tutorias_db --clean --if-exists --no-owner /tmp/restaurar.dump
        if ($LASTEXITCODE -ne 0) { throw "pg_restore terminó con errores; revisa la salida anterior." }
    } finally {
        docker compose exec -T db rm -f /tmp/restaurar.dump | Out-Null
        docker compose start backend | Out-Null
    }
    Write-Host "Restauración completa desde $Archivo."
} finally {
    Pop-Location
}
