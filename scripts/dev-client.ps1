param(
    [ValidateSet("web", "mobile")]
    [string]$Platform = "web"
)

# La web usa Expo en el puerto predeterminado 8081. El cliente móvil usa Metro en 8082.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path "$root\frontend\node_modules")) { throw "Faltan las dependencias. Ejecuta primero .\scripts\setup.ps1" }

Push-Location "$root\frontend"
try {
    npm run $Platform
} finally {
    Pop-Location
}
