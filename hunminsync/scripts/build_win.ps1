$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    throw "가상환경이 없습니다. py -3.12 -m venv .venv 후 의존성을 설치해 주세요."
}

& $Python "scripts\smoke_check.py"
& $Python -m pip install -q -U pyinstaller
& $Python -m PyInstaller --noconfirm --clean "HunminSync.spec"

$Exe = Join-Path $Root "dist\HunminSync\HunminSync.exe"
if (-not (Test-Path $Exe)) {
    throw "빌드 실패: $Exe 를 찾지 못했습니다."
}

Write-Host "완료: $Exe"

