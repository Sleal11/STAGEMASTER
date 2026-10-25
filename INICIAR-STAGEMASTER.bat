@echo off
chcp 65001 >nul
setlocal
title StageMaster - Inicio

rem ================================================================
rem  INICIAR-STAGEMASTER.bat - Arranque del sistema con doble clic
rem
rem  1. Comprueba que Node.js y las dependencias estén instalados
rem  2. Abre el servidor en su propia ventana (si no estaba abierto)
rem  3. Espera a que el servidor responda (/health)
rem  4. Abre la pantalla LED en Chrome (o Edge) en modo kiosco:
rem     pantalla completa, sin barras, sin pestañas
rem
rem  Para salir de la pantalla LED: Alt + F4
rem  Para apagar el sistema: cerrar la ventana "SERVIDOR"
rem ================================================================

rem ---------------- CONFIGURACIÓN ---------------------------------

rem Puerto del servidor (cambiar solo si el 3000 está ocupado)
set PORT=3000

rem Posición horizontal (en píxeles) donde se abre la pantalla LED:
rem   0    = monitor principal
rem   1920 = segundo monitor a la derecha de uno Full HD (Windows + P: "Extender")
set LED_X=0

rem ----------------------------------------------------------------

cd /d "%~dp0"

echo.
echo   ============================================
echo              STAGEMASTER - INICIO
echo   ============================================
echo.

rem --- 1. Comprobaciones ------------------------------------------

where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist "node_modules\express" goto no_modules

rem --- 2. Servidor ------------------------------------------------

rem Si ya hay un servidor respondiendo no se abre otro (evita el puerto ocupado)
call :health
if not errorlevel 1 (
  echo   [i] El servidor ya estaba en marcha.
  goto open_led
)

echo   [1/3] Arrancando el servidor...
start "StageMaster - SERVIDOR (NO CERRAR)" cmd /k node server\index.js

echo   [2/3] Esperando a que el servidor responda...
set /a TRIES=0

:wait_server
call :health
if not errorlevel 1 goto open_led
set /a TRIES+=1
if %TRIES% geq 20 goto server_failed
timeout /t 1 /nobreak >nul
goto wait_server

rem --- 3. Pantalla LED --------------------------------------------

:open_led
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER goto no_browser

echo   [3/3] Abriendo la pantalla LED...

rem Perfil de navegador PROPIO de StageMaster: no mezcla pestañas, extensiones
rem ni avisos del navegador personal, y garantiza que el modo kiosco se aplique.
start "" "%BROWSER%" --kiosk "http://localhost:%PORT%/score.html" ^
  --user-data-dir="%LocalAppData%\StageMaster\navegador" ^
  --window-position=%LED_X%,0 ^
  --no-first-run --noerrdialogs --disable-translate ^
  --overscroll-history-navigation=0

echo.
echo   ============================================
echo    LISTO
echo   ============================================
echo.
echo    Pantalla LED : abierta en modo kiosco (salir: Alt + F4)
echo    iPhone       : abre la dirección "iPhone" que muestra
echo                   la ventana "SERVIDOR" (red Wi-Fi o Ethernet)
echo.
echo    Esta ventana se puede cerrar. La del SERVIDOR NO.
echo.
pause
exit /b 0

rem --- Errores ----------------------------------------------------

:no_node
echo   [X] Node.js no está instalado.
echo       Descárgalo de https://nodejs.org (versión LTS) e instálalo.
echo.
pause
exit /b 1

:no_modules
echo   [X] Faltan las dependencias del proyecto.
echo       Con Internet, abre una terminal en esta carpeta y ejecuta una vez:
echo           npm install
echo.
pause
exit /b 1

:server_failed
echo   [X] El servidor no respondió en 20 segundos.
echo       Revisa el mensaje de la ventana "SERVIDOR".
echo       Si dice que el puerto está ocupado, cierra otras ventanas del
echo       servidor o cambia PORT al principio de este archivo.
echo.
pause
exit /b 1

:no_browser
echo   [X] No se encontró Chrome ni Edge.
echo       Abre manualmente: http://localhost:%PORT%/score.html y pulsa F11.
echo.
pause
exit /b 1

rem --- Subrutina: ¿responde el servidor? (errorlevel 0 = sí) ------

:health
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri 'http://localhost:%PORT%/health' | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
exit /b %errorlevel%
