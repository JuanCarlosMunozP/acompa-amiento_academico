# Aplica migraciones y levanta la API en http://localhost:8001.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) { throw "Falta el entorno de Python. Ejecuta primero .\scripts\setup.ps1" }

Push-Location "$root\backend"
try {
    & $python manage.py migrate
    # Si las migraciones fallan no se levanta la API a medias.
    if ($LASTEXITCODE -ne 0) {
        throw @"
Falló 'migrate'; la API no se inició en el puerto 8001.
Si la base ya existe, revisa DATABASE_URL y verifica que tutorias_user pueda crear tablas:
GRANT CREATE ON SCHEMA public TO tutorias_user;
Ejecuta ese GRANT en la base configurada como propietario o administrador y vuelve a iniciar.
"@
    }
    & $python manage.py runserver 0.0.0.0:8001
} finally {
    Pop-Location
}
