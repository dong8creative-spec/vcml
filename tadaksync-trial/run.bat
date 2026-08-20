@echo off
cd /d "%~dp0"
if not exist "runtime\python.exe" (
  echo Python runtime is missing from this folder.
  echo Unzip the whole TadakSyncTrial folder, then run this file again.
  pause
  exit /b 1
)
if exist "runtime\pythonw.exe" (
  start "" /D "%~dp0" "runtime\pythonw.exe" "%~dp0main.py"
) else (
  "runtime\python.exe" -u "%~dp0main.py"
)
