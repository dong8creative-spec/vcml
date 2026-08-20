# 체험판 폴더에 embed Python + Whisper base 모델을 넣는다.
# 공유 전에 이 스크립트를 한 번 실행하세요.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$PyVer = "3.12.10"
$PyZipName = "python-$PyVer-embed-amd64.zip"
$PyUrl = "https://www.python.org/ftp/python/$PyVer/$PyZipName"
$Runtime = Join-Path $Root "runtime"
$Models = Join-Path $Root "models"
$GetPip = Join-Path $Root "get-pip.py"

Write-Host "=== TadakSync trial bundle ==="

if (-not (Test-Path (Join-Path $Runtime "python.exe"))) {
  $zip = Join-Path $Root $PyZipName
  Write-Host "Downloading $PyZipName ..."
  Invoke-WebRequest -Uri $PyUrl -OutFile $zip
  New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
  Expand-Archive -Path $zip -DestinationPath $Runtime -Force
  Remove-Item $zip -Force
}

$pth = Get-ChildItem $Runtime -Filter "python*._pth" | Select-Object -First 1
if ($pth) {
  $text = Get-Content $pth.FullName -Raw
  $text = $text -replace '(?m)^#import site', 'import site'
  if ($text -notmatch 'Lib\\site-packages') {
    $text = "Lib\site-packages`r`n" + $text
  }
  Set-Content -Path $pth.FullName -Value $text.TrimEnd() -Encoding ascii
}

$py = Join-Path $Runtime "python.exe"
if (-not (Test-Path (Join-Path $Runtime "Scripts\pip.exe")) -and -not (Test-Path (Join-Path $Runtime "Lib\site-packages\pip"))) {
  Write-Host "Installing pip ..."
  Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $GetPip
  & $py $GetPip --no-warn-script-location
  Remove-Item $GetPip -Force -ErrorAction SilentlyContinue
}

Write-Host "Installing faster-whisper + numpy + pywebview + pythonnet ..."
& $py -m pip install --no-warn-script-location "faster-whisper>=1.2" "numpy" "pywebview>=5" "pythonnet>=3"

$DotnetDir = Join-Path $Root "dotnet"
if (-not (Test-Path (Join-Path $DotnetDir "dotnet.exe"))) {
  $RuntimeZipName = "dotnet-runtime-8.0.22-win-x64.zip"
  $DesktopZipName = "windowsdesktop-runtime-8.0.22-win-x64.zip"
  $RuntimeUrl = "https://builds.dotnet.microsoft.com/dotnet/Runtime/8.0.22/$RuntimeZipName"
  $DesktopUrl = "https://builds.dotnet.microsoft.com/dotnet/WindowsDesktop/8.0.22/$DesktopZipName"
  New-Item -ItemType Directory -Force -Path $DotnetDir | Out-Null
  Write-Host "Downloading $RuntimeZipName ..."
  Invoke-WebRequest -Uri $RuntimeUrl -OutFile (Join-Path $Root $RuntimeZipName)
  Expand-Archive -Path (Join-Path $Root $RuntimeZipName) -DestinationPath $DotnetDir -Force
  Remove-Item (Join-Path $Root $RuntimeZipName) -Force
  Write-Host "Downloading $DesktopZipName ..."
  Invoke-WebRequest -Uri $DesktopUrl -OutFile (Join-Path $Root $DesktopZipName)
  Expand-Archive -Path (Join-Path $Root $DesktopZipName) -DestinationPath $DotnetDir -Force
  Remove-Item (Join-Path $Root $DesktopZipName) -Force
}

New-Item -ItemType Directory -Force -Path $Models | Out-Null
Write-Host "Downloading Whisper base into models\ ..."
$env:HF_HUB_DISABLE_SYMLINKS = "1"
& $py -c @"
from pathlib import Path
from faster_whisper.utils import download_model
root = Path(r'$Models')
target = root / 'faster-whisper-base'
target.mkdir(parents=True, exist_ok=True)
path = download_model('base')
src = Path(path)
if (target / 'model.bin').is_file():
    print('model already in', target)
else:
    import shutil
    if src.resolve() != target.resolve():
        if src.is_dir():
            for item in src.iterdir():
                dest = target / item.name
                if item.is_dir():
                    if dest.exists():
                        shutil.rmtree(dest)
                    shutil.copytree(item, dest)
                else:
                    shutil.copy2(item, dest)
    print('copied model from', src, 'to', target)
"@

Write-Host "Done. Share this whole folder (including runtime and models)."
Write-Host "Recipients: double-click run.bat"
