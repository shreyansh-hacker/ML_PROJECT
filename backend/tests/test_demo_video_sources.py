import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.routers import anpr
from app.services import anpr_engine
from app.services.camera_sources import get_registered_camera


class DemoVideoSourceTests(unittest.TestCase):
    def test_sources_include_two_distinct_bundled_feeds(self):
        sources = anpr_engine.ANPREngine().get_sources()
        demos = [source for source in sources if source["source_type"] == "DEMO_VIDEO"]

        self.assertEqual(
            [(source["id"], source["camera_code"]) for source in demos],
            [("demo_video", "DEMO-01"), ("demo_video_2", "DEMO-02")],
        )
        self.assertNotEqual(
            anpr_engine.DEMO_VIDEO_SOURCES["demo_video"]["video_path"],
            anpr_engine.DEMO_VIDEO_SOURCES["demo_video_2"]["video_path"],
        )
        self.assertTrue(
            all(source["video_path"].is_file() for source in anpr_engine.DEMO_VIDEO_SOURCES.values())
        )

    def test_demo_capture_uses_the_selected_bundled_clip(self):
        engine = anpr_engine.ANPREngine()
        original_source_type = engine.source_type
        original_source_id = engine.source_id
        engine.source_type = "DEMO_VIDEO"
        engine.source_id = "demo_video_2"
        capture = object()

        try:
            with patch.object(anpr_engine.cv2, "VideoCapture", return_value=capture) as open_video:
                self.assertIs(engine._open_capture(), capture)
            open_video.assert_called_once_with(
                str(anpr_engine.DEMO_VIDEO_SOURCES["demo_video_2"]["video_path"])
            )
        finally:
            engine.source_type = original_source_type
            engine.source_id = original_source_id

    def test_demo_source_aliases_resolve_without_accepting_paths(self):
        self.assertEqual(
            anpr_engine.get_demo_video_source("DEMO-02")["id"],
            "demo_video_2",
        )
        self.assertIsNone(anpr_engine.get_demo_video_source("../ANPR/t.mp4"))

    def test_unknown_demo_does_not_stop_an_active_engine(self):
        engine = anpr_engine.ANPREngine()
        with patch.object(engine, "stop") as stop_engine:
            with self.assertRaises(ValueError):
                engine.start("DEMO_VIDEO", "../ANPR/t.mp4")
        stop_engine.assert_not_called()

    def test_registered_database_cameras_are_available_as_private_anpr_sources(self):
        database = object()
        camera_row = {
            "id": "database-camera-id",
            "camera_code": "DB-CAM-01",
            "source_type": "NETWORK_CCTV",
            "status": "ONLINE",
            "rtsp_url": "rtsp://camera.local/stream",
            "dept_name": "Sample Department",
        }
        with (
            patch.object(anpr.anpr_engine, "get_sources", return_value=[]),
            patch.object(
                anpr,
                "list_database_cameras",
                new=AsyncMock(return_value=[camera_row]),
            ),
        ):
            sources = asyncio.run(anpr.get_sources(database))

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0]["id"], "database-camera-id")
        self.assertEqual(sources[0]["source_type"], "CAMERA")
        self.assertEqual(sources[0]["rtsp_url"], "")
        self.assertNotIn("camera.local", str(sources))

    def test_database_camera_resolution_preserves_encrypted_credential_reference(self):
        database = AsyncMock()
        database.fetchrow.return_value = {
            "id": "database-camera-id",
            "camera_code": "ONVIF-CAM-01",
            "rtsp_url": "rtsp://camera.local/stream",
            "source_type": "NETWORK_CCTV",
        }
        stored_camera = {
            "camera_code": "ONVIF-CAM-01",
            "credential_id": "encrypted-camera-record",
            "onvif_device_id": "onvif-device",
        }
        with patch(
            "app.services.camera_sources.memory_registry.get_all_cameras",
            return_value=[stored_camera],
        ):
            camera = asyncio.run(get_registered_camera("database-camera-id", database))

        self.assertEqual(camera["id"], "database-camera-id")
        self.assertEqual(camera["credential_id"], "encrypted-camera-record")


if __name__ == "__main__":
    unittest.main()
