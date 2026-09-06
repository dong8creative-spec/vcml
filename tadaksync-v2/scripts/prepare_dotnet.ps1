# .NET 8 데스크톱 런타임을 tadaksync-v2/dotnet/ 에 내려받는다.
# TadakSync2.spec 빌드(pyinstaller) 전에 한 번 실행하세요.
# ContextMenu TypeLoadException(coreclr가 시스템 .NET 버전에 따라 pywebview의
# WebView2 WinForms 백엔드와 충돌하는 문제)을 피하려고, 시스템에 뭐가 깔려 있든
# 항상 같은 버전의 런타임을 앱과 함께 배포한다.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$DotnetVer = "8.0.22"
$DotnetDir = Join-Path $Root "dotnet"

if (Test-Path (Join-Path $DotnetDir "dotnet.exe")) {
  Write-Host ".NET 8 런타임이 이미 준비돼 있어요: $DotnetDir"
  exit 0
}

$RuntimeZipName = "dotnet-runtime-$DotnetVer-win-x64.zip"
$DesktopZipName = "windowsdesktop-runtime-$DotnetVer-win-x64.zip"
$RuntimeUrl = "https://builds.dotnet.microsoft.com/dotnet/Runtime/$DotnetVer/$RuntimeZipName"
$DesktopUrl = "https://builds.dotnet.microsoft.com/dotnet/WindowsDesktop/$DotnetVer/$DesktopZipName"

New-Item -ItemType Directory -Force -Path $DotnetDir | Out-Null

Write-Host "Downloading $RuntimeZipName ..."
Invoke-WebRequest -Uri $RuntimeUrl -OutFile (Join-Path $Root $RuntimeZipName)
Expand-Archive -Path (Join-Path $Root $RuntimeZipName) -DestinationPath $DotnetDir -Force
Remove-Item (Join-Path $Root $RuntimeZipName) -Force

Write-Host "Downloading $DesktopZipName ..."
Invoke-WebRequest -Uri $DesktopUrl -OutFile (Join-Path $Root $DesktopZipName)
Expand-Archive -Path (Join-Path $Root $DesktopZipName) -DestinationPath $DotnetDir -Force
Remove-Item (Join-Path $Root $DesktopZipName) -Force

Write-Host "완료: $DotnetDir"
