# Crea el rol y la base local (tutorias_user / tutorias_db) y aplica las migraciones.
# Es idempotente: se puede repetir sin duplicar nada.
#
# Contraseña del superusuario 'postgres': se toma de la variable PGPASSWORD si ya está definida
# (útil para automatizar); si no, se pide por pantalla y no se guarda en ningún sitio.
param([string]$PgHost = "localhost", [int]$Port = 5432)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    throw "No se encuentra 'psql'. Instala PostgreSQL y agrega su carpeta bin al PATH."
}
$python = Join-Path $root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) { throw "Falta el entorno de Python. Ejecuta primero .\scripts\setup.ps1" }

$pedida = $false
if (-not $env:PGPASSWORD) {
    $secure = Read-Host "Contraseña de 'postgres'" -AsSecureString
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    $pedida = $true
}
try {
    $psql = @("-U", "postgres", "-h", $PgHost, "-p", $Port, "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-tA")
    $rol = psql @psql -c "SELECT 1 FROM pg_roles WHERE rolname = 'tutorias_user'"
    if ($LASTEXITCODE -ne 0) { throw "No se pudo conectar a PostgreSQL (¿contraseña de postgres incorrecta?)" }
    if (-not $rol) { psql @psql -c "CREATE ROLE tutorias_user LOGIN PASSWORD 'tutorias_pass' CREATEDB" }
    if ($LASTEXITCODE -ne 0) { throw "Falló la creación del rol tutorias_user" }
    $base = psql @psql -c "SELECT 1 FROM pg_database WHERE datname = 'tutorias_db'"
    if (-not $base) { psql @psql -c "CREATE DATABASE tutorias_db OWNER tutorias_user ENCODING 'UTF8'" }
    if ($LASTEXITCODE -ne 0) { throw "Falló la creación de la base tutorias_db" }
} finally {
    # Solo se borra si la pedimos nosotros: no pisamos una variable que el usuario ya tenía.
    if ($pedida) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}

Push-Location "$root\backend"
try {
    & $python manage.py migrate
    if ($LASTEXITCODE -ne 0) { throw "Falló 'migrate'. Revisa DATABASE_URL en backend\.env" }
} finally {
    Pop-Location
}
Write-Host "Base de datos lista: tutorias_db (usuario tutorias_user)."
