# 타닥싱크 3 — 로컬 엔진 모드 (인식·번역 PC 처리, 코인 서버 차감)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:TADAKSYNC_OFFLINE = "1"
if (-not $env:CAPCUT_SUBTITLE_API) {
  $env:CAPCUT_SUBTITLE_API = "http://localhost:3300"
}
Write-Host "로컬 엔진 모드 — 인식·번역은 PC, 코인 차감은 $($env:CAPCUT_SUBTITLE_API)"
Write-Host "번역 언어팩 미설치 시: .\.venv\Scripts\python -m tadaksync3.offline_mode --install"
.\.venv\Scripts\python.exe run.py
