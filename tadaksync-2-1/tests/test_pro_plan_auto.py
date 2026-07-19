import unittest

from tadaksync2.pro_plan import _chunk_sentence, build_lines_auto


def _w(text: str, start: int = 0, end: int = 100_000) -> tuple:
    return (text, start, end)


class TestProPlanAuto(unittest.TestCase):
    def test_sentence_boundary_not_merged(self):
        words = [
            _w("안녕하세요.", 0, 100_000),
            _w("반갑습니다.", 900_000, 1_000_000),
        ]
        lines = build_lines_auto(words, min_words_per_line=1, max_words_per_line=6)
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0].text, "안녕하세요.")
        self.assertEqual(lines[1].text, "반갑습니다.")

    def test_max_words_respected(self):
        words = [_w(f"어{i}", i * 100_000, (i + 1) * 100_000) for i in range(1, 8)]
        words[-1] = ("어7.", 700_000, 800_000)
        lines = build_lines_auto(words, min_words_per_line=1, max_words_per_line=3)
        texts = [ln.text for ln in lines]
        self.assertEqual(texts, ["어1어2어3", "어4어5어6", "어7."])

    def test_min_words_merge_within_sentence(self):
        words = [_w(f"어{i}", i * 100_000, (i + 1) * 100_000) for i in range(1, 6)]
        words[-1] = ("어5.", 500_000, 600_000)
        lines = build_lines_auto(words, min_words_per_line=2, max_words_per_line=3)
        texts = [ln.text for ln in lines]
        self.assertEqual(texts, ["어1어2어3", "어4어5."])

    def test_chunk_sentence_tail_merge(self):
        sent = [_w("a"), _w("b"), _w("c"), _w("d.")]
        chunks = _chunk_sentence(sent, min_words=2, max_words=3)
        self.assertEqual(len(chunks), 2)
        self.assertEqual(len(chunks[0]), 3)
        self.assertEqual(len(chunks[1]), 1)


if __name__ == "__main__":
    unittest.main()
