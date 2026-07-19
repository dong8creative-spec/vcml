import unittest

from tadaksync2 import keyword_spans


class KeywordSpansTest(unittest.TestCase):
    def test_exact_match(self):
        hits = keyword_spans.find_matches("영상편집 그리고 영상편집", "영상편집", "exact")
        self.assertEqual(len(hits), 2)

    def test_contains_match(self):
        hits = keyword_spans.find_matches("영상편집을 배워요", "영상편집", "contains")
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["start"], 0)

    def test_apply_all_occurrences(self):
        blocks = [{"text": "A B A", "start_us": 0, "end_us": 1_000_000}]
        out, n = keyword_spans.apply_keyword_spans(
            blocks, "A", "exact", {"color": "#ff0000"}, merge=True)
        self.assertEqual(n, 2)
        self.assertEqual(len(out[0]["spans"]), 2)

    def test_replace_keyword(self):
        blocks = [{"text": "영상편집 배우기", "spans": [{"start": 0, "end": 4, "color": "#ff0000"}]}]
        out, n = keyword_spans.replace_keyword_text(blocks, "영상편집", "동영상", "exact")
        self.assertEqual(n, 1)
        self.assertEqual(out[0]["text"], "동영상 배우기")

    def test_clear_keyword(self):
        blocks = [{"text": "A B A", "start_us": 0, "end_us": 1, "spans": [
            {"start": 0, "end": 1, "color": "#ff0000"},
            {"start": 4, "end": 5, "color": "#ff0000"},
        ]}]
        out = keyword_spans.clear_keyword_spans(blocks, "A", "exact")
        self.assertEqual(out[0]["spans"], [])


if __name__ == "__main__":
    unittest.main()
