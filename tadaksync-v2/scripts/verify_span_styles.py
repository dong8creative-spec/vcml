#!/usr/bin/env python3
"""CapCut span 스타일 삽입 검증용 — 1줄 테스트 자막 JSON 출력."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tadaksync2.inject import SubtitleStyle, _build_content  # noqa: E402


def main() -> None:
    text = "일반 단어 영상편집 일반"
    kw_start = text.index("영상편집")
    kw_end = kw_start + len("영상편집")
    spans = [{
        "start": kw_start,
        "end": kw_end,
        "color": "#ffef3b",
        "bold": True,
        "bold_width": 0.008,
        "italic": True,
        "italic_degree": 10,
    }]
    content = _build_content(text, SubtitleStyle(), "", spans)
    data = json.loads(content)
    print("=== CapCut content JSON (키워드 구간 강조) ===")
    print(json.dumps(data, ensure_ascii=False, indent=2))
    print("\n체크리스트:")
    print("- styles 배열에 range가 3구간(앞·키워드·뒤)으로 나뉘는지")
    print("- 키워드 구간 style entry에 bold / italic / italic_degree 있는지")
    print("- CapCut AI 자막 트랙에서 실제 렌더링 확인")


if __name__ == "__main__":
    main()
