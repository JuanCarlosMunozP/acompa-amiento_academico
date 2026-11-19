$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    throw "No se encontró mkcert. Instálalo (por ejemplo: winget install FiloSottile.mkcert) y vuelve a ejecutar este script."
}

$certDir = Join-Path $root "frontend\certs"
$certPath = Join-Path $certDir "localhost.pem"
$keyPath = Join-Path $certDir "localhost-key.pem"
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

if ((Test-Path $certPath) -and (Test-Path $keyPath)) {
    Write-Host "Ya existen el certificado y su clave en frontend\certs."
    return
}
if ((Test-Path $certPath) -or (Test-Path $keyPath)) {
    throw "frontend\certs contiene solo parte del certificado. Revisa esa carpeta antes de continuar."
}

& mkcert -install
if ($LASTEXITCODE -ne 0) {
    throw "mkcert no pudo instalar su CA local de confianza (código $LASTEXITCODE)."
}

& mkcert -cert-file $certPath -key-file $keyPath localhost 127.0.0.1 ::1
if ($LASTEXITCODE -ne 0) {
    throw "mkcert no pudo generar el certificado local (código $LASTEXITCODE)."
}

Write-Host "Certificado HTTPS local creado en frontend\certs."
