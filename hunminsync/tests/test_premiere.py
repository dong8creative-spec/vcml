from __future__ import annotations

import gzip
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from hunminsync.premiere import (
    SAMPLE_RATE,
    TICKS_PER_SECOND,
    build_sequence_audio,
    parse_project,
    read_project_xml,
)


def _project_xml(media_path: Path) -> bytes:
    one_second = TICKS_PER_SECOND
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<PremiereData>
  <Sequence ObjectUID="sequence-1">
    <Name>인터뷰 편집본</Name>
    <TrackGroups><TrackGroup><Second ObjectRef="10"/></TrackGroup></TrackGroups>
  </Sequence>
  <AudioTrackGroup ObjectID="10">
    <TrackGroup><Tracks><Track ObjectURef="track-1"/></Tracks></TrackGroup>
  </AudioTrackGroup>
  <AudioClipTrack ObjectUID="track-1">
    <ClipTrack>
      <Track><ID>1</ID></Track>
      <ClipItems><TrackItems><TrackItem ObjectRef="20"/></TrackItems></ClipItems>
    </ClipTrack>
  </AudioClipTrack>
  <AudioClipTrackItem ObjectID="20">
    <ClipTrackItem>
      <TrackItem><Start>{one_second}</Start><End>{one_second * 3}</End></TrackItem>
      <SubClip ObjectRef="30"/>
    </ClipTrackItem>
  </AudioClipTrackItem>
  <SubClip ObjectID="30">
    <MasterClip ObjectURef="master-1"/>
    <Clip ObjectRef="40"/>
  </SubClip>
  <MasterClip ObjectUID="master-1">
    <Clips><Clip ObjectRef="40"/></Clips>
  </MasterClip>
  <AudioClip ObjectID="40">
    <Clip>
      <InPoint>0</InPoint><OutPoint>{one_second * 2}</OutPoint>
      <PlaybackSpeed>1</PlaybackSpeed>
      <Source ObjectRef="50"/>
    </Clip>
  </AudioClip>
  <AudioMediaSource ObjectID="50">
    <MediaSource><Media ObjectURef="media-1"/></MediaSource>
  </AudioMediaSource>
  <Media ObjectUID="media-1"><FilePath>{media_path.as_posix()}</FilePath></Media>
</PremiereData>""".encode()


class PremiereProjectTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.media_path = root / "speech.wav"
        self.media_path.touch()
        self.project_path = root / "sample.prproj"
        self.project_path.write_bytes(gzip.compress(_project_xml(self.media_path)))

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_reads_gzip_and_parses_sequence_graph(self) -> None:
        self.assertIn(b"<PremiereData>", read_project_xml(self.project_path))
        project = parse_project(self.project_path)
        self.assertEqual(project.name, "sample")
        self.assertEqual(len(project.sequences), 1)
        sequence = project.sequences[0]
        self.assertEqual(sequence.name, "인터뷰 편집본")
        self.assertEqual(sequence.duration_us, 3_000_000)
        self.assertEqual(len(sequence.clips), 1)
        clip = sequence.clips[0]
        self.assertEqual(clip.timeline_start_us, 1_000_000)
        self.assertEqual(clip.source_out_us, 2_000_000)
        self.assertEqual(clip.media_path, self.media_path.resolve())

    def test_builds_timeline_silence_and_clip_audio(self) -> None:
        project = parse_project(self.project_path)
        source = np.full(SAMPLE_RATE * 2, 0.25, dtype=np.float32)
        with patch("hunminsync.premiere._Decoder.decode", return_value=source):
            result = build_sequence_audio(project, project.sequences[0])
        self.assertEqual(result.duration_us, 3_000_000)
        self.assertTrue(np.allclose(result.audio[:SAMPLE_RATE], 0))
        self.assertTrue(np.allclose(result.audio[SAMPLE_RATE:SAMPLE_RATE * 3], 0.25))
        self.assertEqual(result.used_files, [str(self.media_path.resolve())])


if __name__ == "__main__":
    unittest.main()
