@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "runtime\python.exe" (
  echo Python 실행 파일이 이 폴더에 없습니다.
  echo 만든 쪽에서 prepare_bundle.ps1 을 먼저 실행해 runtime 과 models 를 넣어 주세요.
  pause
  exit /b 1
)
if exist "runtime\pythonw.exe" (
  start "" /D "%~dp0" "runtime\pythonw.exe" "%~dp0main.py"
) else (
  "runtime\python.exe" -u "%~dp0main.py"
)
