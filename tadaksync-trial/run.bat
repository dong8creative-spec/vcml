@echo off
cd /d "%~dp0"

echo %~dp0 | find /i "\Temp\" >nul
if not errorlevel 1 (
  echo This is running from a temporary folder inside the zip file.
  echo Right-click the zip, choose Extract All, then run run.bat in the extracted folder.
  pause
  exit /b 1
)

set MISSING=
if not exist "runtime\python.exe" set MISSING=runtime\python.exe
if not exist "runtime\Lib\site-packages\webview\__init__.py" set MISSING=runtime\Lib\site-packages\webview
if not exist "models\faster-whisper-base\model.bin" set MISSING=models\faster-whisper-base\model.bin

if not "%MISSING%"=="" (
  echo The unzip did not finish. Missing: %MISSING%
  echo.
  echo 1. Delete this folder.
  echo 2. Right-click the zip file and choose Extract All.
  echo 3. Run run.bat inside the extracted folder.
  pause
  exit /b 1
)

if exist "runtime\pythonw.exe" (
  start "" /D "%~dp0" "runtime\pythonw.exe" "%~dp0main.py"
) else (
  "runtime\python.exe" -u "%~dp0main.py"
)
