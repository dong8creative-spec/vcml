# -*- mode: python ; coding: utf-8 -*-
# 타닥싱크 2-1 (맥) PyInstaller 스펙.
# 빌드: ./.venv/bin/pyinstaller --noconfirm --clean TadakSync-2-1.spec
# 결과물: dist/TadakSync 2-1.app  (서명·공증은 별도, 이 범위 아님)
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []

# Whisper 인식 엔진과 의존 라이브러리 전체 수집
for pkg in ("ctranslate2", "faster_whisper", "av", "onnxruntime"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

# 웹 UI(HTML/CSS/JS)를 앱 번들 안 tadaksync2/web 로 포함.
# app.py의 _web_dir()가 frozen일 때 sys._MEIPASS/tadaksync2/web 를 읽는다.
datas += [("tadaksync2/web", "tadaksync2/web")]

# 맥 pywebview 백엔드
hiddenimports += [
    "webview.platforms.cocoa",
    "objc",
    "Cocoa",
    "WebKit",
    "Foundation",
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
    name="TadakSync 2-1",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # 맥에서 upx는 서명/실행 문제를 일으킬 수 있어 끔
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
    name="TadakSync 2-1",
)
app = BUNDLE(
    coll,
    name="TadakSync 2-1.app",
    icon=None,
    bundle_identifier="kr.vcml.tadaksync21",
    info_plist={
        "CFBundleName": "TadakSync 2-1",
        "CFBundleDisplayName": "타닥싱크 2-1",
        "CFBundleShortVersionString": "2.16.0",
        "CFBundleVersion": "2.16.0",
        "NSHighResolutionCapable": True,
        # 마이크가 아닌 파일 접근만 사용하지만, 폴더 접근 안내를 위해 명시
        "NSHumanReadableCopyright": "TadakSync",
        "LSMinimumSystemVersion": "11.0",
    },
)
