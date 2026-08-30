@echo off
setlocal
cd /d "%~dp0"

title Servidor Node - Puerto 3000

echo.
echo ==========================================
echo       INICIANDO SERVIDOR NODE
echo ==========================================
echo.

REM Instalar dependencias si no existen
if not exist "node_modules" (
    echo Instalando dependencias por primera vez...
    call npm install

    if errorlevel 1 (
        echo.
        echo ERROR: No se pudieron instalar las dependencias.
        pause
        exit /b 1
    )
)

REM Crear la interfaz si no existe
if not exist "client\dist" (
    echo Preparando la interfaz...
    call npm run build

    if errorlevel 1 (
        echo.
        echo ERROR: No se pudo compilar la interfaz.
        pause
        exit /b 1
    )
)

REM Configuracion opcional del servidor
if exist "sonora.env.cmd" call "sonora.env.cmd"
if not defined HOST set HOST=0.0.0.0
if not defined PORT set PORT=3000

REM Obtener IP local de Windows
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$ip = Get-NetIPConfiguration ^| Where-Object {$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'} ^| ForEach-Object {$_.IPv4Address.IPAddress} ^| Where-Object {$_ -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)'} ^| Select-Object -First 1; Write-Output $ip"`) do (
    set LOCAL_IP=%%I
)

echo.
echo ==========================================
echo             SERVIDOR LISTO
echo ==========================================
echo.
echo PC:
echo http://localhost:%PORT%
echo.
echo MOVIL:
echo http://%LOCAL_IP%:%PORT%
echo.
echo ==========================================
echo.

REM Abrir automaticamente en este ordenador
start "" "http://localhost:3000"

REM Iniciar servidor
call npm start

echo.
echo El servidor se ha detenido.
pause
