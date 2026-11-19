# Compila el APK de Android (release) apuntando a la API indicada.
# Requisitos: Node, Java 17 y Android SDK (variable ANDROID_HOME). Cierra otros programas pesados:
# la compilación necesita ~3 GB de memoria libre.
param(
    [string]$ApiUrl = "https://tutorias-api-production.up.railway.app/api",
    [string]$Salida = "tutorias-sprint1.apk",
    [string]$MemoriaGradle = "2048m"
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$cliente = Join-Path $raiz "frontend"
$sdk = $env:ANDROID_HOME
if (-not $sdk -or -not (Test-Path $sdk)) { throw "Define ANDROID_HOME con la ruta del Android SDK" }
try { $apiUri = [Uri]$ApiUrl } catch { throw "ApiUrl debe ser una URL absoluta." }
if ($apiUri.Scheme -ne "https") { throw "El APK de producción requiere una API pública HTTPS." }
if ($apiUri.Host -eq "localhost" -or $apiUri.Host -eq "::1" -or $apiUri.Host.StartsWith("127.")) {
    throw "El APK no puede apuntar a localhost; usa el dominio público del backend."
}
if ($apiUri.Host -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') {
    throw "El APK no puede apuntar a una IP privada de tu red local; usa el dominio público del backend."
}

# La URL queda fija dentro del APK al compilar.
$env:EXPO_PUBLIC_API_URL = $ApiUrl
Write-Host "API: $ApiUrl"

Push-Location $cliente
try {
    # Regenera la carpeta android/ desde app.json (es un artefacto generado, no se versiona).
    # Expo escribe avisos en stderr: con 'Stop' PowerShell los tomaría por errores.
    $ErrorActionPreference = "Continue"
    npx expo prebuild --platform android --clean --no-install 2>&1 | Out-Host
    $ErrorActionPreference = "Stop"
    if ($LASTEXITCODE -ne 0) { throw "Falló expo prebuild" }

    $android = Join-Path $cliente "android"
    Set-Content -Path (Join-Path $android "local.properties") -Value ("sdk.dir=" + ($sdk -replace "\\", "/"))
    $props = Join-Path $android "gradle.properties"
    (Get-Content $props) -replace "-Xmx\d+m", "-Xmx$MemoriaGradle" | Set-Content $props

    Push-Location $android
    try {
        # Solo arm64 (teléfonos actuales): más rápido y liviano.
        .\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
        if ($LASTEXITCODE -ne 0) { throw "Falló Gradle (revisa la memoria libre)" }
    } finally {
        Pop-Location
    }
} finally {
    Pop-Location
}

$apk = Join-Path $cliente "android\app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $apk)) { throw "No se generó el APK" }
$dist = Join-Path $raiz "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item $apk (Join-Path $dist $Salida) -Force
Write-Host ("APK listo: " + (Join-Path $dist $Salida) + " (" + [math]::Round((Get-Item $apk).Length / 1MB, 1) + " MB)")
