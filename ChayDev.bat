@echo off
rem Chay server tool level DEV + mo app: http://localhost:<PORT>/app/  (dong cua so nay = tat server)
rem Ten tool / tien to bien / cong / server (RUNTIME=node hoac python): game\game.env.
rem Cau hinh BI Level Hub / dang nhap Google / CI: .env (mau game\.env.example).
rem File cua level-tool-core - game khong sua file nay.
chcp 65001 >nul
cd /d "%~dp0"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("game\game.env") do if not "%%b"=="" set "GAME_%%a=%%b"
if "%GAME_PORT%"=="" set GAME_PORT=8880
if "%GAME_RUNTIME%"=="" set GAME_RUNTIME=python
where node >nul 2>nul || goto :nonode
if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do if not "%%b"=="" set "%%a=%%b"
)
set "%GAME_PREFIX%_DEV=1"
set "%GAME_PREFIX%_PUBLIC_BASE=http://localhost:%GAME_PORT%"
set "%GAME_PREFIX%_DB=%~dp0data\dev.db"
if not exist "data" mkdir data
title %GAME_NAME% DEV (%GAME_RUNTIME%)
if /i "%GAME_RUNTIME%"=="node" goto :node
if not exist ".venv\Scripts\python.exe" (
  echo Lan dau: tao moi truong Python...
  py -m venv .venv || goto :err
  ".venv\Scripts\python.exe" -m pip install -r levelcore\server\requirements-dev.txt || goto :err
  if exist "game\server\requirements.txt" ".venv\Scripts\python.exe" -m pip install -r game\server\requirements.txt || goto :err
)
set "PYTHONPATH=%~dp0levelcore\server;%~dp0game\server"
if "%LEVELCORE_NO_BROWSER%"=="" start "" http://localhost:%GAME_PORT%/app/
".venv\Scripts\python.exe" -m uvicorn --factory levelcore.main:get_app --port %GAME_PORT% --workers 1
goto :eof
:node
set "%GAME_PREFIX%_PORT=%GAME_PORT%"
if "%LEVELCORE_NO_BROWSER%"=="" start "" http://localhost:%GAME_PORT%/app/
node levelcore\node\server.mjs
goto :eof
:nonode
echo Can Node.js 22.13+ (lenh node): luat level cua game la JS - https://nodejs.org
pause
goto :eof
:err
echo Loi cai dat - can Python 3.10+ (lenh py) va Node.js.
pause
