# Respaldo de la base de datos de Docker (PostgreSQL) en backups\tutorias_AAAAMMDD_HHmmss.dump
#
# Uso:
#   .\scripts\backup-db.ps1                 # crea un respaldo y conserva los últimos 14
#   .\scripts\backup-db.ps1 -Conservar 30   # conserva los últimos 30
#
# El volcado se genera DENTRO del contenedor y se copia con `docker compose cp`: redirigir la
# salida binaria de pg_dump con ">" en PowerShell 5.1 corrompe el archivo.
# Para restaurar: .\scripts\restore-db.ps1 -Archivo backups\<archivo>.dump
param([int]$Conservar = 14)

# "Continue": docker escribe su progreso en stderr y PowerShell 5.1 lo tomaría por error.
# Los fallos reales se detectan con $LASTEXITCODE.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $db = docker compose ps --status running --services 2>$null | Where-Object { $_ -eq "db" }
    if (-not $db) { throw "El contenedor 'db' no está corriendo. Ejecuta: docker compose up -d db" }

    $carpeta = Join-Path $root "backups"
    New-Item -ItemType Directory -Force $carpeta | Out-Null
    $nombre = "tutorias_{0}.dump" -f (Get-Date -Format "yyyyMMdd_HHmmss")
    $destino = Join-Path $carpeta $nombre

    docker compose exec -T db pg_dump -U tutorias_user -d tutorias_db -Fc --no-owner -f "/tmp/$nombre"
    if ($LASTEXITCODE -ne 0) { throw "pg_dump falló." }
    docker compose cp "db:/tmp/$nombre" $destino
    if ($LASTEXITCODE -ne 0) { throw "No se pudo copiar el respaldo fuera del contenedor." }
    docker compose exec -T db rm -f "/tmp/$nombre" | Out-Null

    # Comprueba que el archivo es legible antes de dar el respaldo por bueno.
    docker compose cp $destino "db:/tmp/verificar.dump" | Out-Null
    $tablas = docker compose exec -T db pg_restore --list /tmp/verificar.dump
    $ok = $LASTEXITCODE -eq 0
    docker compose exec -T db rm -f /tmp/verificar.dump | Out-Null
    if (-not $ok) { Remove-Item $destino -Force; throw "El respaldo generado no es válido; se descartó." }

    $kb = [math]::Round((Get-Item $destino).Length / 1KB, 1)
    Write-Host "Respaldo creado: $destino ($kb KB, $(@($tablas).Count) objetos)."

    # Rotación: borra solo los respaldos viejos de esta misma carpeta.
    Get-ChildItem $carpeta -Filter "tutorias_*.dump" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $Conservar |
        ForEach-Object { Remove-Item $_.FullName -Force; Write-Host "Eliminado respaldo antiguo: $($_.Name)" }
} finally {
    Pop-Location
}
