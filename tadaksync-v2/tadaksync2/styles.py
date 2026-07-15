"""자막 스타일 프리셋.

각 프리셋은 inject.SubtitleStyle로 변환된다. UI(web/app.js)의 미리보기
카드와 key가 1:1로 대응한다. 색·외곽선·볼드는 실제 캡컷 프로젝트의 캡션
소재와 필드 단위로 대조해 검증된 값만 쓴다.

배경 박스(bg)·그림자(shadow) 프리셋은 실측 템플릿에 필드는 있지만
실제 캡컷(9.0.0.3851)에서 렌더링되지 않는 것으로 실기기 테스트에서
확인돼(2026-07-15) 제외했다. inject.SubtitleStyle의 bg/shadow 필드
자체는 남겨뒀으니, 나중에 올바른 값 조합을 찾으면 다시 추가한다.
"""

from __future__ import annotations

from .inject import SubtitleStyle

# UI에 보여줄 순서대로. key는 web/app.js의 스타일 카드와 일치해야 한다.
PRESETS: list[dict] = [
    {
        "key": "classic",
        "name": "클래식 화이트",
        "desc": "흰 글자 + 검은 외곽선 — 어떤 영상에도 어울리는 기본",
        "style": dict(color=(1.0, 1.0, 1.0), border=True,
                      border_color=(0.0, 0.0, 0.0)),
    },
    {
        "key": "variety",
        "name": "예능 옐로",
        "desc": "노란 볼드 + 검은 외곽선 — 예능·리액션 하이라이트",
        "style": dict(color=(1.0, 0.88, 0.0), border=True,
                      border_color=(0.0, 0.0, 0.0), bold=True),
    },
    {
        "key": "lime",
        "name": "네온 라임",
        "desc": "라임 볼드 + 검은 외곽선 — 쇼츠·트렌디한 영상",
        "style": dict(color=(0.78, 1.0, 0.0), border=True,
                      border_color=(0.0, 0.0, 0.0), bold=True),
    },
]

_BY_KEY = {p["key"]: p for p in PRESETS}

# UI의 크기/위치 선택값 → SubtitleStyle 필드
SIZE_MAP = {"small": 5.0, "medium": 7.0, "large": 9.0}
POSITION_MAP = {"bottom": -0.8, "middle": 0.0, "top": 0.8}


def list_presets() -> list[dict]:
    """UI 전송용 메타데이터 (style dict 제외)."""
    return [{"key": p["key"], "name": p["name"], "desc": p["desc"]}
            for p in PRESETS]


def build_style(key: str, size: str = "medium",
                position: str = "bottom") -> SubtitleStyle:
    preset = _BY_KEY.get(key) or _BY_KEY["classic"]
    return SubtitleStyle(
        size=SIZE_MAP.get(size, 7.0),
        transform_y=POSITION_MAP.get(position, -0.8),
        as_caption=True,
        **preset["style"],
    )
