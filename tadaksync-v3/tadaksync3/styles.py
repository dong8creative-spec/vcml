"""자막 스타일 프리셋.

각 프리셋은 inject.SubtitleStyle로 변환된다. UI(web/app.js)의 미리보기
카드와 key가 1:1로 대응한다. 색·외곽선·볼드는 실제 캡컷 프로젝트의 캡션
소재와 필드 단위로 대조해 검증된 값만 쓴다.

배경 박스(bg) 프리셋은 check_flag에 배경 비트(16)를 켜고,
background_height를 0보다 크게 넣어야 캡컷이 박스를 그린다.
(높이 0·비트 미설정 시 패널엔 배경 ON처럼 보여도 미리보기에 안 나옴)
"""

from __future__ import annotations

from .inject import SubtitleStyle


def _rgb(hex_color: str) -> tuple[float, float, float]:
    value = hex_color.strip().lstrip("#")
    if len(value) != 6:
        raise ValueError(f"invalid hex color: {hex_color}")
    return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


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
    {
        "key": "box_warm",
        "name": "웜 베이지 박스",
        "desc": "흰 글자 + 베이지 배경 박스 — 넓은 하단 자막",
        "style": dict(
            color=_rgb("ffffff"),
            border=False,
            bg=True,
            bg_color=_rgb("95866f"),
            bg_alpha=1.0,
            bg_round_radius=0.0,
            # 캡컷 기본 패딩. 높이 0이면 박스가 안 보임
            bg_height=0.14,
            bg_width=0.55,
        ),
    },
    {
        "key": "box_black",
        "name": "블랙 박스",
        "desc": "흰 글자 + 검은 배경 박스 — 선명한 하단 자막",
        "style": dict(
            color=_rgb("ffffff"),
            border=False,
            bg=True,
            bg_color=_rgb("000000"),
            bg_alpha=1.0,
            bg_round_radius=0.0,
            bg_height=0.14,
            bg_width=0.55,
        ),
    },
]

_BY_KEY = {p["key"]: p for p in PRESETS}

# UI의 크기/위치 선택값 → SubtitleStyle 필드
# bottom/middle/top: clip.transform 정규화 좌표 (-1~1)
# pos_*: 캡컷 위치 패널에 보이는 픽셀값 → 삽입 시 캔버스 w/h로 나눔
SIZE_MAP = {"small": 5.0, "medium": 7.0, "large": 9.0}
POSITION_MAP = {
    "bottom": {"transform": (0.0, -0.8)},
    "middle": {"transform": (0.0, 0.0)},
    "top": {"transform": (0.0, 0.8)},
    "pos_1075": {"ui": (0.0, 1075.0)},
    "pos_minus_465": {"ui": (0.0, -465.0)},
}


def list_presets() -> list[dict]:
    """UI 전송용 메타데이터 (style dict 제외)."""
    return [{"key": p["key"], "name": p["name"], "desc": p["desc"]}
            for p in PRESETS]


def build_style(key: str, size: str = "medium",
                position: str = "bottom") -> SubtitleStyle:
    preset = _BY_KEY.get(key) or _BY_KEY["classic"]
    pos = POSITION_MAP.get(position) or POSITION_MAP["bottom"]
    kwargs: dict = {
        "size": SIZE_MAP.get(size, 7.0),
        "as_caption": True,
        **preset["style"],
    }
    if "ui" in pos:
        kwargs["ui_x"], kwargs["ui_y"] = pos["ui"]
        kwargs["transform_x"], kwargs["transform_y"] = 0.0, 0.0
    else:
        kwargs["transform_x"], kwargs["transform_y"] = pos["transform"]
    return SubtitleStyle(**kwargs)
