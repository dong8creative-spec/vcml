# -*- mode: python ; coding: utf-8 -*-
import os
from PyInstaller.utils.hooks import collect_all

datas = [('tadaksync2/web', 'tadaksync2/web')]
binaries = []
# scripts/prepare_dotnet.ps1 로 미리 받아둔 .NET 8 데스크톱 런타임을 그대로 동봉한다.
# ContextMenu TypeLoadException(체험판에서 겪은 것과 같은 coreclr/WebView2 버전 불일치
# 문제)을 시스템 .NET 버전에 상관없이 피하기 위함 — dotnet_runtime.py 참고.
if os.path.isdir('dotnet'):
    datas.append(('dotnet', 'dotnet'))
hiddenimports = [
    'clr',
    'pythonnet',
    'clr_loader',
    'webview.platforms.winforms',
    'webview.platforms.edgechromium',
]

for pkg in (
    'ctranslate2',
    'faster_whisper',
    'av',
    'onnxruntime',
    'webview',
    'pythonnet',
    'clr_loader',
    'argostranslate',
):
    tmp_ret = collect_all(pkg)
    datas += tmp_ret[0]
    binaries += tmp_ret[1]
    hiddenimports += tmp_ret[2]

a = Analysis(
    ['run.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=['pyi_rth_dotnet.py'],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='TadakSync2',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='TadakSync2',
)
