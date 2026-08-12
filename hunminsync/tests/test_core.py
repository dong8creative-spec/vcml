from __future__ import annotations

import unittest
import tempfile
import wave
from pathlib import Path

import numpy as np

from hunminsync.billing import manual_split_coins, recognition_coins
from hunminsync.playback import write_wav
from hunminsync.pro_plan import build_enter_lines, split_enter_lines
from hunminsync.srt import dumps, loads
from hunminsync.transcribe import SubtitleLine


class BillingTests(unittest.TestCase):
    def test_recognition_rounds_up_each_thirty_seconds(self) -> None:
        self.assertEqual(recognition_coins(0), 0)
        self.assertEqual(recognition_coins(1), 1)
        self.assertEqual(recognition_coins(30_000_000), 1)
        self.assertEqual(recognition_coins(30_000_001), 2)
        self.assertEqual(manual_split_coins(), 2)


class EnterMappingTests(unittest.TestCase):
    def test_only_nonempty_enter_lines_make_blocks(self) -> None:
        self.assertEqual(split_enter_lines(" 첫 줄 \n\n둘째 줄"), ["첫 줄", "둘째 줄"])

    def test_mapping_survives_text_edits(self) -> None:
        words = [
            (" 안녕하세요", 0, 500_000),
            (" 여러분", 550_000, 900_000),
            (" 오늘은", 1_000_000, 1_400_000),
            (" 테스트입니다", 1_450_000, 2_000_000),
        ]
        lines = build_enter_lines("안녕하십니까 여러분\n오늘 테스트예요", words)
        self.assertEqual([line.text for line in lines],
                         ["안녕하십니까 여러분", "오늘 테스트예요"])
        self.assertEqual(lines[0].words, words[:2])
        self.assertEqual(lines[1].words, words[2:])


class SrtTests(unittest.TestCase):
    def test_round_trip_preserves_multiline_text(self) -> None:
        original = [SubtitleLine(1_234_000, 3_456_000, "첫 줄\n둘째 줄")]
        parsed = loads(dumps(original))
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0].text, original[0].text)
        self.assertEqual((parsed[0].start_us, parsed[0].end_us),
                         (1_234_000, 3_456_000))


class PlaybackTests(unittest.TestCase):
    def test_preview_wav_is_mono_16khz_pcm(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "preview.wav"
            write_wav(np.zeros(1600, dtype=np.float32), path)
            with wave.open(str(path), "rb") as source:
                self.assertEqual(source.getnchannels(), 1)
                self.assertEqual(source.getframerate(), 16_000)
                self.assertEqual(source.getsampwidth(), 2)
                self.assertEqual(source.getnframes(), 1600)


if __name__ == "__main__":
    unittest.main()
