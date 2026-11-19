# Instala las dependencias y crea los .env locales si faltan.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Ejecutar($descripcion) {
    if ($LASTEXITCODE -ne 0) { throw "Falló: $descripcion (código $LASTEXITCODE)" }
}

Push-Location "$root\backend"
try {
    if (-not (Test-Path .venv)) {
        python -m venv .venv
        Ejecutar "crear el entorno virtual de Python (¿está instalado Python 3.12+?)"
    }
    & .\.venv\Scripts\python.exe -m pip install -r requirements\dev.txt
    Ejecutar "instalar las dependencias de la API"
    if (-not (Test-Path .env)) {
        Copy-Item .env.example .env
        Write-Host "Creado backend\.env: edita SECRET_KEY y DATABASE_URL"
    }
} finally {
    Pop-Location
}

Push-Location "$root\frontend"
try {
    npm install
    Ejecutar "instalar las dependencias del cliente (¿está instalado Node 20+?)"
    if (-not (Test-Path .env)) {
        Copy-Item .env.example .env
        Write-Host "Creado frontend\.env"
    }
} finally {
    Pop-Location
}
Write-Host "Listo. Siguiente: .\scripts\setup-db.ps1 y luego .\scripts\dev-api.ps1"
