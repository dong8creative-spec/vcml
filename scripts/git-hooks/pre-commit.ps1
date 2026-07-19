# TadakSync2 WIP commit guard - blocks only staged files under tadaksync-v2/
$ErrorActionPreference = 'Stop'
if ($env:TADAKSYNC2_COMMIT_OK -eq '1') { exit 0 }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $here '..\..')).Path
Set-Location -LiteralPath $root

$marker = Join-Path $root 'tadaksync-v2\.WIP_NO_COMMIT'
if (-not (Test-Path -LiteralPath $marker)) { exit 0 }

$blocked = @(git diff --cached --name-only -- tadaksync-v2/)
if ($blocked.Count -eq 0) { exit 0 }

Write-Host ''
Write-Host '========================================' -ForegroundColor Yellow
Write-Host ' TadakSync2 WIP - commit BLOCKED' -ForegroundColor Yellow
Write-Host '========================================' -ForegroundColor Yellow
Write-Host 'Staged tadaksync-v2 files:'
$blocked | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host 'Uncheck tadaksync-v2 files to commit the rest (schema, admin, ...).'
Write-Host 'When v2 is ready: .\scripts\tadaksync2-commit-guard.ps1 unblock'
Write-Host ''
exit 1
