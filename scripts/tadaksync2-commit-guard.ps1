# TadakSync2 WIP commit guard (local pre-commit hook)
param(
    [Parameter(Position = 0)]
    [ValidateSet('block', 'unblock', 'status')]
    [string]$Action = 'status'
)

$Root = Join-Path $PSScriptRoot '..'
$Root = (Resolve-Path $Root).Path
$Hook = Join-Path $Root '.git\hooks\pre-commit'
$Marker = Join-Path $Root 'tadaksync-v2\.WIP_NO_COMMIT'

function Install-Hook {
    $shHook = Join-Path $Root '.git\hooks\pre-commit'
    $psHook = Join-Path $Root 'scripts\git-hooks\pre-commit.ps1'
    $sh = @(
        '#!/bin/sh',
        'if [ "$TADAKSYNC2_COMMIT_OK" = "1" ]; then exit 0; fi',
        'cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 0',
        'if [ ! -f "tadaksync-v2/.WIP_NO_COMMIT" ]; then exit 0; fi',
        'blocked=$(git diff --cached --name-only -- tadaksync-v2/)',
        '[ -z "$blocked" ] && exit 0',
        'printf "\nTadakSync2 WIP - commit BLOCKED (tadaksync-v2 only)\n\n"',
        'printf "%s\n" "$blocked" | sed "s/^/  /"',
        'printf "\nUncheck tadaksync-v2 in GitHub Desktop to commit other files.\n"',
        'printf "Unblock: .\\scripts\\tadaksync2-commit-guard.ps1 unblock\n\n"',
        'exit 1'
    )
    [System.IO.File]::WriteAllText($shHook, ($sh -join "`n") + "`n")
    if (Test-Path $psHook) { Write-Host "pre-commit hook installed (sh + scripts/git-hooks/pre-commit.ps1)" }
    else { Write-Host "pre-commit hook installed" }
}

switch ($Action) {
    'block' {
        if (-not (Test-Path (Join-Path $Root 'tadaksync-v2'))) {
            Write-Error 'tadaksync-v2 not found'
            exit 1
        }
        Set-Content -Path $Marker -Value 'WIP' -Encoding ASCII
        Install-Hook
        Write-Host 'TadakSync2 commit guard ON'
    }
    'unblock' {
        if (Test-Path $Marker) { Remove-Item $Marker -Force }
        if (Test-Path $Hook) {
            $head = Get-Content $Hook -Raw -ErrorAction SilentlyContinue
            if ($head -match 'TADAKSYNC2_COMMIT_OK') {
                Remove-Item $Hook -Force
                Write-Host 'pre-commit hook removed'
            }
        }
        Write-Host 'TadakSync2 commit guard OFF'
    }
    'status' {
        $on = Test-Path $Marker
        $hook = Test-Path $Hook
        Write-Host ("WIP marker: " + $(if ($on) { 'ON' } else { 'OFF' }))
        Write-Host ("pre-commit: " + $(if ($hook) { 'installed' } else { 'none' }))
        if ($on) {
            Write-Host 'When ready: .\scripts\tadaksync2-commit-guard.ps1 unblock'
        }
    }
}
