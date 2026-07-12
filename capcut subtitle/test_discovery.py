#!/usr/bin/env python3
"""초안 폴더 다층 탐색 검증.

1) 실제 환경: 기본 경로 + globalSetting 커스텀 경로 인식
2) 모의 환경: LOCALAPPDATA를 가짜로 바꿔 커스텀 초안 위치·수동 등록 동작 확인
"""

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).parent))

from capcut_subtitle import capcut

ok = True

print("=" * 70)
print("1) 실제 환경 탐색")
print("=" * 70)
roots = capcut.find_draft_roots()
for r in roots:
    print(f"  root: {r}")
projects = capcut.list_projects()
print(f"  프로젝트 {len(projects)}개: {[p.name for p in projects[:5]]}")
if not roots or not projects:
    print("  ✗ 기본 환경에서 탐색 실패")
    ok = False
else:
    print("  ✓ 기본 탐색 OK")

print("=" * 70)
print("2) 모의 환경: 초안 위치를 옮긴 사용자 (globalSetting 인식)")
print("=" * 70)
tmp = Path(tempfile.mkdtemp(prefix="tadak_test_"))
try:
    # 가짜 LOCALAPPDATA: 기본 경로에는 프로젝트 없음
    fake_local = tmp / "AppData"
    custom_draft = tmp / "D_drive" / "MyDrafts" / "com.lveditor.draft"
    proj = custom_draft / "테스트프로젝트"
    proj.mkdir(parents=True)
    (proj / "draft_content.json").write_text(
        json.dumps({"id": "X", "duration": 3_000_000}), encoding="utf-8")

    cfg_dir = fake_local / "CapCut" / "User Data" / "Config"
    cfg_dir.mkdir(parents=True)
    escaped = str(custom_draft).replace("\\", "\\\\")
    (cfg_dir / "globalSetting").write_text(
        f"[General]\ncurrentCustomDraftPath={escaped}\n", encoding="utf-8")

    old_local = os.environ.get("LOCALAPPDATA", "")
    os.environ["LOCALAPPDATA"] = str(fake_local)
    try:
        roots2 = capcut.find_draft_roots()
        found = any(r.resolve() == custom_draft.resolve() for r in roots2)
        projects2 = capcut.list_projects()
        names = [p.name for p in projects2]
        print(f"  roots: {[str(r) for r in roots2]}")
        print(f"  projects: {names}")
        if found and "테스트프로젝트" in names:
            print("  ✓ 커스텀 초안 위치 인식 OK")
        else:
            print("  ✗ 커스텀 초안 위치 인식 실패")
            ok = False
    finally:
        os.environ["LOCALAPPDATA"] = old_local

    print("=" * 70)
    print("3) 수동 등록: 프로젝트 폴더를 직접 골라도 부모를 루트로 등록")
    print("=" * 70)
    registered = capcut.add_manual_draft_root(proj)  # 프로젝트 폴더를 선택한 상황
    print(f"  등록된 루트: {registered}")
    if registered.resolve() == custom_draft.resolve():
        print("  ✓ 부모 폴더로 정규화 OK")
    else:
        print("  ✗ 정규화 실패")
        ok = False
    projects3 = capcut.list_projects()
    if "테스트프로젝트" in [p.name for p in projects3]:
        print("  ✓ 수동 등록 폴더의 프로젝트 인식 OK")
    else:
        print("  ✗ 수동 등록 인식 실패")
        ok = False

    # 정리: 테스트로 등록한 임시 루트를 설정에서 제거
    sp = capcut._settings_path()
    settings = json.loads(sp.read_text(encoding="utf-8"))
    settings["draft_roots"] = [
        r for r in settings.get("draft_roots", []) if not r.startswith(str(tmp))]
    sp.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
    print("  (테스트 등록 항목 정리 완료)")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print("\n" + ("✓ 전체 합격" if ok else "✗ 실패"))
sys.exit(0 if ok else 1)
