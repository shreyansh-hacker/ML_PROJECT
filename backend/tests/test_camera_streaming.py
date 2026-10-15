import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from starlette.requests import ClientDisconnect

from app.routers import onboarding
from app.routers.stream import (
    CameraStreamingResponse,
    _ffmpeg_mjpeg_command,
    generate_mjpeg_stream,
)


class FfmpegMjpegCommandTests(unittest.TestCase):
    def test_rtsp_uses_rtsp_transport_not_http_reconnect_options(self):
        command = _ffmpeg_mjpeg_command("rtsp://camera.example/stream")

        self.assertIn("-rtsp_transport", command)
        self.assertIn("tcp", command)
        self.assertNotIn("-reconnect", command)
        self.assertNotIn("-reconnect_at_eof", command)
        self.assertNotIn("-reconnect_streamed", command)

    def test_http_uses_http_reconnect_options_without_rtsp_transport(self):
        command = _ffmpeg_mjpeg_command("https://camera.example/stream.mjpg")

        self.assertIn("-reconnect", command)
        self.assertIn("-reconnect_at_eof", command)
        self.assertIn("-reconnect_streamed", command)
        self.assertNotIn("-rtsp_transport", command)

    def test_local_video_is_looped(self):
        command = _ffmpeg_mjpeg_command("/app/data/sample.mp4")

        self.assertIn("-stream_loop", command)
        self.assertIn("-1", command)
        self.assertIn("-re", command)


class MjpegStreamCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancellation_terminates_ffmpeg_process(self):
        process = SimpleNamespace(
            stdout=asyncio.StreamReader(),
            returncode=None,
            terminate=Mock(),
            wait=AsyncMock(),
        )
        with (
            patch("app.routers.stream.shutil.which", return_value="/usr/bin/ffmpeg"),
            patch(
                "app.routers.stream.asyncio.create_subprocess_exec",
                new=AsyncMock(return_value=process),
            ),
        ):
            stream = generate_mjpeg_stream("rtsp://camera.example/stream")
            with self.assertRaises(TimeoutError):
                await asyncio.wait_for(anext(stream), timeout=0.01)

        process.terminate.assert_called_once()
        process.wait.assert_awaited_once()

    async def test_client_disconnect_closes_stream_generator(self):
        stream_closed = asyncio.Event()

        async def stream():
            try:
                yield b"frame"
            finally:
                stream_closed.set()

        async def send(message):
            if message["type"] == "http.response.body":
                raise OSError("client disconnected")

        response = CameraStreamingResponse(
            stream(),
            media_type="multipart/x-mixed-replace; boundary=frame",
        )
        with self.assertRaises(ClientDisconnect):
            await response(
                {"type": "http", "asgi": {"spec_version": "2.4"}},
                AsyncMock(),
                send,
            )

        self.assertTrue(stream_closed.is_set())


class CameraDeletionTests(unittest.IsolatedAsyncioTestCase):
    async def test_delete_also_removes_stream_and_onvif_credentials(self):
        camera = {
            "credential_id": "sentinel:CAM_TEST",
            "onvif_device_id": "device-test",
        }
        with (
            patch.object(
                onboarding.memory_registry,
                "get_camera_by_id",
                return_value=camera,
            ),
            patch.object(onboarding.memory_registry, "delete_camera", return_value=True),
            patch.object(onboarding, "delete_credentials") as delete_credentials,
        ):
            await onboarding.delete_camera("CAM_TEST", None)

        delete_credentials.assert_has_calls(
            [unittest.mock.call("sentinel:CAM_TEST"), unittest.mock.call("device-test")],
            any_order=True,
        )


if __name__ == "__main__":
    unittest.main()
