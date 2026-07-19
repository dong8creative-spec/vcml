"""키워드 일치 구간 검색·spans 일괄 적용."""

from __future__ import annotations

import re
from copy import deepcopy

_TOKEN_RE = re.compile(r"\S+")


def normalize_match_mode(mode: str | None) -> str:
    return "contains" if str(mode or "").strip().lower() == "contains" else "exact"


def find_matches(text: str, keyword: str, mode: str | None = "exact") -> list[dict]:
    """text에서 keyword와 일치하는 구간 [{start,end}] 반환."""
    kw = str(keyword or "").strip()
    if not kw:
        return []
    src = str(text or "")
    mmode = normalize_match_mode(mode)
    out: list[dict] = []

    if mmode == "exact":
        for m in _TOKEN_RE.finditer(src):
            if m.group(0) == kw:
                out.append({"start": m.start(), "end": m.end()})
        return out

    start = 0
    while True:
        idx = src.find(kw, start)
        if idx < 0:
            break
        out.append({"start": idx, "end": idx + len(kw)})
        start = idx + max(1, len(kw))
    return out


def scan_blocks(blocks: list[dict], keyword: str, mode: str | None = "exact") -> dict:
    kw = str(keyword or "").strip()
    if not kw:
        return {"count": 0, "block_count": 0, "matches": []}
    matches: list[dict] = []
    for bi, block in enumerate(blocks or []):
        text = str(block.get("text") or "")
        for hit in find_matches(text, kw, mode):
            snippet = text[max(0, hit["start"] - 8):min(len(text), hit["end"] + 8)]
            matches.append({
                "block_index": bi,
                "start": hit["start"],
                "end": hit["end"],
                "snippet": snippet,
            })
    block_ids = {m["block_index"] for m in matches}
    return {
        "count": len(matches),
        "block_count": len(block_ids),
        "matches": matches,
    }


def _merge_span(existing: dict | None, style: dict) -> dict:
    merged = dict(existing or {})
    for key in ("color", "bold", "bold_width", "italic", "italic_degree"):
        if key in style and style[key] is not None:
            merged[key] = style[key]
    return merged


def apply_keyword_spans(
    blocks: list[dict],
    keyword: str,
    mode: str | None,
    style: dict,
    *,
    merge: bool = True,
) -> tuple[list[dict], int]:
    """매칭된 모든 occurrence에 style spans 적용. (blocks, applied_count)."""
    scan = scan_blocks(blocks, keyword, mode)
    if not scan["count"]:
        return blocks, 0

    out = deepcopy(blocks or [])
    applied = 0
    for hit in scan["matches"]:
        bi = hit["block_index"]
        start, end = hit["start"], hit["end"]
        block = out[bi]
        spans = list(block.get("spans") or [])
        if merge:
            prev = next((s for s in spans if s.get("start") == start and s.get("end") == end), None)
            if prev:
                spans = [s for s in spans if not (s.get("start") == start and s.get("end") == end)]
                spans.append(_merge_span(prev, style))
            else:
                entry = {"start": start, "end": end}
                entry.update({k: v for k, v in style.items() if v is not None})
                spans.append(entry)
        else:
            spans = [s for s in spans if not (s.get("start") == start and s.get("end") == end)]
            entry = {"start": start, "end": end}
            entry.update({k: v for k, v in style.items() if v is not None})
            spans.append(entry)
        block["spans"] = spans
        applied += 1
    return out, applied


def clear_keyword_spans(blocks: list[dict], keyword: str, mode: str | None) -> list[dict]:
    scan = scan_blocks(blocks, keyword, mode)
    if not scan["count"]:
        return blocks
    out = deepcopy(blocks or [])
    targets = {(m["block_index"], m["start"], m["end"]) for m in scan["matches"]}
    for bi, start, end in targets:
        block = out[bi]
        block["spans"] = [
            s for s in (block.get("spans") or [])
            if not (s.get("start") == start and s.get("end") == end)
        ]
    return out


def _remap_spans_on_text_change(old_text: str, new_text: str, spans: list[dict]) -> list[dict]:
    """텍스트 치환 후 span 위치를 부분 문자열 매칭으로 재계산."""
    if not spans:
        return []
    src = str(old_text or "")
    dst = str(new_text or "")
    if src == dst:
        return list(spans)
    out: list[dict] = []
    from_idx = 0
    for span in spans:
        frag = src[span.get("start", 0):span.get("end", 0)]
        if not frag:
            continue
        idx = dst.find(frag, from_idx)
        if idx < 0:
            continue
        out.append({**span, "start": idx, "end": idx + len(frag)})
        from_idx = idx + len(frag)
    return out


def replace_keyword_text(
    blocks: list[dict],
    keyword: str,
    replacement: str,
    mode: str | None = "exact",
) -> tuple[list[dict], int]:
    """검색된 키워드를 replacement로 치환. spans 위치도 갱신."""
    kw = str(keyword or "").strip()
    if not kw:
        return blocks, 0
    repl = str(replacement if replacement is not None else "")
    out = deepcopy(blocks or [])
    total = 0
    for block in out:
        old = str(block.get("text") or "")
        text = old
        hits = find_matches(text, kw, mode)
        for hit in reversed(hits):
            text = text[: hit["start"]] + repl + text[hit["end"] :]
            total += 1
        if text != old:
            block["text"] = text
            block["spans"] = _remap_spans_on_text_change(
                old, text, block.get("spans") or [])
    return out, total
