"""로컬 엔진 모드 — 인식·번역은 PC에서, 코인 차감은 vcml 서버.

TADAKSYNC_OFFLINE=1 이면 GPT 대신 Argos Translate로 블록별 번역합니다.
로그인·코인 API는 그대로 서버를 사용합니다.
"""

from __future__ import annotations

import os
from typing import Any

# Argos Translate 언어 코드 (from → to)
TARGET_LANGS = {"en", "ja", "zh"}
SOURCE_CODE_MAP = {
    "한국어": "ko",
    "korean": "ko",
    "ko": "ko",
    "日本語": "ja",
    "japanese": "ja",
    "ja": "ja",
    "english": "en",
    "en": "en",
    "chinese": "zh",
    "zh": "zh",
}

_TRANSLATOR_CACHE: dict[tuple[str, str], Any] = {}


def is_offline_mode() -> bool:
    """로컬 번역 엔진 사용 여부 (인식은 항상 로컬)."""
    return os.environ.get("TADAKSYNC_OFFLINE", "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def source_to_code(source_lang: str) -> str:
    raw = str(source_lang or "").strip().lower()
    if not raw:
        return "ko"
    for key, code in SOURCE_CODE_MAP.items():
        if key.lower() in raw or raw == key.lower():
            return code
    return "ko"


def _get_argos_translation(from_code: str, to_code: str):
    key = (from_code, to_code)
    if key in _TRANSLATOR_CACHE:
        return _TRANSLATOR_CACHE[key]

    try:
        import argostranslate.translate
    except ImportError as e:
        raise RuntimeError(
            "로컬 번역 패키지가 없어요. tadaksync-v3 폴더에서 "
            "`.venv\\Scripts\\pip install -r requirements-offline.txt` 후 "
            "`python -m tadaksync3.offline_mode --install` 을 실행해 주세요."
        ) from e

    langs = argostranslate.translate.get_installed_languages()
    from_lang = next((l for l in langs if l.code == from_code), None)
    to_lang = next((l for l in langs if l.code == to_code), None)
    if not from_lang or not to_lang:
        raise RuntimeError(
            f"로컬 번역 언어팩이 없어요 ({from_code}→{to_code}). "
            "한 번만 인터넷에 연결한 뒤 "
            "`python -m tadaksync3.offline_mode --install` 을 실행해 주세요."
        )
    tr = from_lang.get_translation(to_lang)
    if tr is None:
        raise RuntimeError(
            f"{from_code}→{to_code} 번역기를 찾지 못했어요. "
            "`python -m tadaksync3.offline_mode --install` 로 언어팩을 설치해 주세요."
        )
    _TRANSLATOR_CACHE[key] = tr
    return tr


def translate_text(text: str, from_code: str, to_code: str) -> str:
    text = str(text or "").strip()
    if not text:
        return ""
    if from_code == to_code:
        return text
    tr = _get_argos_translation(from_code, to_code)
    out = tr.translate(text)
    return str(out or "").strip()


def translate_blocks(
    blocks: list[dict],
    target_lang: str,
    source_lang: str = "",
) -> list[dict]:
    """블록별 로컬 번역 (Argos Translate)."""
    to_code = str(target_lang or "").strip().lower()
    if to_code not in TARGET_LANGS:
        raise RuntimeError("지원하지 않는 번역 언어예요. (영어/일본어/중국어)")
    from_code = source_to_code(source_lang)

    out: list[dict] = []
    for b in blocks or []:
        item = dict(b)
        item["text_translated"] = translate_text(
            str(b.get("text") or ""),
            from_code,
            to_code,
        )
        out.append(item)
    return out


def install_argos_packages(pairs: list[tuple[str, str]] | None = None) -> list[str]:
    """언어팩 다운로드·설치 (최초 1회, 인터넷 필요)."""
    import argostranslate.package
    import argostranslate.translate

    if pairs is None:
        pairs = [("ko", "en"), ("ko", "ja"), ("ko", "zh")]

    argostranslate.package.update_package_index()
    available = argostranslate.package.get_available_packages()
    installed: list[str] = []

    for from_code, to_code in pairs:
        if from_code == to_code:
            continue
        pkg = next(
            (p for p in available
             if p.from_code == from_code and p.to_code == to_code),
            None,
        )
        if pkg is None:
            raise RuntimeError(f"다운로드 가능한 언어팩이 없어요: {from_code}→{to_code}")
        label = f"{from_code}→{to_code}"
        path = pkg.download()
        argostranslate.package.install_from_path(path)
        installed.append(label)
        _TRANSLATOR_CACHE.pop((from_code, to_code), None)

    return installed


def _cli_install() -> None:
    print("Argos 언어팩 설치 중… (인터넷 필요)")
    done = install_argos_packages()
    print("설치 완료:", ", ".join(done))


if __name__ == "__main__":
    import sys
    if "--install" in sys.argv:
        _cli_install()
    else:
        print("사용법: python -m tadaksync3.offline_mode --install")
