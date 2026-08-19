# -*- mode: python ; coding: utf-8 -*-

import sys

from PyInstaller.utils.hooks import collect_all

datas = [("hunminsync/web", "hunminsync/web")]
binaries = []
hiddenimports = []

for package in (
    "faster_whisper", "ctranslate2", "tokenizers", "av",
    "onnxruntime", "webview",
):
    package_datas, package_binaries, package_hidden = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hidden

if sys.platform == "darwin":
    hiddenimports += [
        "webview.platforms.cocoa",
        "objc",
        "Cocoa",
        "WebKit",
        "Foundation",
        "AppKit",
    ]

a = Analysis(
    ["run.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
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
    name="HunminSync",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=sys.platform == "darwin",
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
    name="HunminSync",
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="HunminSync.app",
        icon=None,
        bundle_identifier="kr.vcml.hunminsync",
        info_plist={
            "CFBundleName": "HunminSync",
            "CFBundleDisplayName": "훈민정음 싱크",
            "CFBundleShortVersionString": "1.0.0",
            "CFBundleVersion": "1.0.0",
            "NSHumanReadableCopyright": "VCML",
            "NSHighResolutionCapable": True,
            "LSMinimumSystemVersion": "12.0",
        },
    )

