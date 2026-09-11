@echo off
title VYRA SAREES
setlocal enabledelayedexpansion

REM ============================================================
REM  VYRA SAREES - one-click start
REM  The shop data lives in Firebase now, so there is no database
REM  and no server to set up. This only puts the app on an
REM  http:// address, which the browser needs, and opens it.
REM  Double-click this file. Leave the black window open while
REM  the shop is working; closing it closes the app.
REM ============================================================

set "APPDIR=%~dp0"
set "PORT=5000"
set "URL=http://localhost:5000"

echo.
echo   VYRA SAREES
echo   -----------------------------------------
echo.

if not exist "%APPDIR%public\index.html" (
  echo   The "public" folder was not found next to this file.
  echo   Looked in: %APPDIR%
  echo.
  echo   Keep "START VYRA SAREES.bat" inside the VYRA SAREES folder.
  echo   To make a desktop icon, right-click this file ^> Send to ^> Desktop.
  echo.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js is not installed on this PC.
  echo   Install it from https://nodejs.org  then run this file again.
  echo.
  pause
  exit /b 1
)

call :isup %PORT%
if errorlevel 1 (
  call :start
) else (
  REM Something is already on the port. An older copy has no printer bridge,
  REM and printing would quietly fall back to the browser - which puts labels
  REM on the roll sideways. So replace it.
  call :hasprint %PORT%
  if errorlevel 1 (
    echo   An older VYRA SAREES is running. Restarting it ...
    call :stopport %PORT%
    call :start
  ) else (
    echo   Already running.
  )
)

echo.
echo   Opening %URL%
start "" "%URL%"
echo.
echo   Ready. Keep the "VYRA SAREES" window open while billing.
echo   Bills and labels print on the USB printer through this window,
echo   so leave it open - phones on the shop Wi-Fi print through it too.
echo   The first time on a new phone, connect to the internet once
echo   so it can sign in; after that it keeps working offline.
echo.
ping -n 4 127.0.0.1 >nul
exit /b 0

REM ---------- helper: start the server ----------
:start
echo   Starting VYRA SAREES ...
start "VYRA SAREES" /d "%APPDIR%" cmd /k node "tools\serve.js" %PORT%
call :waitport %PORT% 20
if errorlevel 1 (
   echo.
   echo   It did not start. Look at the window titled "VYRA SAREES"
   echo   for the reason.
   echo.
   pause
   exit /b 1
)
echo   Started.
exit /b 0

REM ---------- helper: does the running server have the printer bridge ----------
:hasprint
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 'http://localhost:%~1/api/health'; if ($r.Content -like '*vyra-sarees*') { exit 0 } else { exit 1 } } catch { exit 1 }"
exit /b %errorlevel%

REM ---------- helper: stop whatever is listening on this port ----------
:stopport
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /r /c:":%~1 .*LISTENING"') do (
  taskkill /pid %%P /t /f >nul 2>&1
)
ping -n 3 127.0.0.1 >nul
exit /b 0

REM ---------- helper: is something listening on this port ----------
:isup
netstat -ano -p tcp | findstr /r /c:":%~1 .*LISTENING" >nul 2>&1
exit /b %errorlevel%

REM ---------- helper: wait for a port to start listening ----------
:waitport
set /a _tries=%~2
:waitloop
call :isup %~1
if not errorlevel 1 exit /b 0
set /a _tries-=1
if %_tries% leq 0 exit /b 1
ping -n 2 127.0.0.1 >nul
goto waitloop
