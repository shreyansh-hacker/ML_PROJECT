import asyncio
import logging
import shutil
from typing import AsyncGenerator
from urllib.parse import urlsplit

import cv2
import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse, Response
from starlette.types import Receive, Scope, Send
from app.db import get_optional_pool
from app.services.camera_sources import get_registered_camera
from app.services.onvif_credentials import add_rtsp_credentials, load_credentials

router = APIRouter(prefix="/api/cameras", tags=["Live Camera Streaming"])
logger = logging.getLogger("uvicorn.error")


class CameraStreamingResponse(StreamingResponse):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            close_stream = getattr(self.body_iterator, "aclose", None)
            if close_stream:
                await close_stream()


def _camera_stream_input(camera) -> str:
    if isinstance(camera, dict):
        rtsp_url = camera.get("rtsp_url")
        http_stream_url = camera.get("http_stream_url")
        credential_id = camera.get("credential_id")
    else:
        rtsp_url = getattr(camera, "rtsp_url", None)
        http_stream_url = getattr(camera, "http_stream_url", None)
        credential_id = getattr(camera, "credential_id", None)

    stream_url = rtsp_url or http_stream_url or ""
    if credential_id and rtsp_url:
        try:
            credentials = load_credentials(credential_id)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if credentials:
            try:
                stream_url = add_rtsp_credentials(
                    rtsp_url,
                    credentials["username"],
                    credentials["password"],
                )
            except ValueError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
    return stream_url


async def generate_mjpeg_stream(stream_url: str) -> AsyncGenerator[bytes, None]:
    """Spawns FFmpeg to read RTSP/HTTP or looped local video and yield MJPEG frames directly to client."""
    if not shutil.which("ffmpeg"):
        async for frame in _generate_opencv_mjpeg_stream(stream_url):
            yield frame
        return

    cmd = _ffmpeg_mjpeg_command(stream_url)

    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )

        buffer = bytearray()
        while True:
            chunk = await process.stdout.read(8192)
            if not chunk:
                break
            buffer.extend(chunk)

            while True:
                soi = buffer.find(b"\xff\xd8")
                if soi == -1:
                    buffer.clear()
                    break
                eoi = buffer.find(b"\xff\xd9", soi + 2)
                if eoi == -1:
                    if soi > 0:
                        buffer = buffer[soi:]
                    break

                frame = bytes(buffer[soi:eoi + 2])
                buffer = buffer[eoi + 2:]

                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n" +
                    frame                     + b"\r\n"
                )
        if process.returncode is None:
            await process.wait()
        if process.returncode:
            logger.warning(
                "FFmpeg exited with status %s while streaming a camera feed.",
                process.returncode,
            )
    except asyncio.CancelledError:
        raise
    except GeneratorExit:
        pass
    except Exception as exc:
        logger.warning(f"Error in MJPEG stream: {exc}")
    finally:
        if process:
            try:
                if process.returncode is None:
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), timeout=2.0)
                    except asyncio.TimeoutError:
                        process.kill()
                        await process.wait()
            except ProcessLookupError:
                await process.wait()
            except Exception as exc:
                logger.warning("Could not cleanly stop FFmpeg camera process: %s", exc)


def _ffmpeg_mjpeg_command(stream_url: str) -> list[str]:
    scheme = urlsplit(stream_url).scheme.lower()
    command = ["ffmpeg", "-nostdin", "-loglevel", "error"]

    if scheme in {"rtsp", "rtsps"}:
        command.extend(["-rtsp_transport", "tcp"])
    elif scheme in {"http", "https"}:
        command.extend(
            [
                "-reconnect",
                "1",
                "-reconnect_at_eof",
                "1",
                "-reconnect_streamed",
                "1",
                "-reconnect_delay_max",
                "5",
            ]
        )
    else:
        command.extend(["-stream_loop", "-1", "-re"])

    command.extend(
        [
            "-analyzeduration",
            "2000000",
            "-probesize",
            "2000000",
            "-i",
            stream_url,
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "-q:v",
            "4",
            "-r",
            "20",
            "-vf",
            "scale=960:-1",
            "-",
        ]
    )
    return command


async def _generate_opencv_mjpeg_stream(stream_url: str) -> AsyncGenerator[bytes, None]:
    """Use OpenCV's bundled FFmpeg decoder when a system ffmpeg executable is unavailable."""
    def open_capture():
        capture = cv2.VideoCapture(
            stream_url,
            cv2.CAP_FFMPEG,
            [
                cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,
                8000,
                cv2.CAP_PROP_READ_TIMEOUT_MSEC,
                8000,
            ],
        )
        if not capture.isOpened():
            capture.release()
            return None
        return capture

    try:
        capture = await asyncio.to_thread(open_capture)
    except cv2.error:
        logger.warning("OpenCV could not open the configured camera stream.")
        return
    if capture is None:
        logger.warning("OpenCV could not open the configured camera stream.")
        return

    is_network_stream = str(stream_url).lower().startswith(
        ("rtsp://", "rtsps://", "http://", "https://")
    )
    try:
        while True:
            try:
                success, frame = await asyncio.to_thread(capture.read)
            except cv2.error:
                logger.warning("OpenCV encountered an error while reading a camera stream.")
                break
            if not success or frame is None:
                frame_count = await asyncio.to_thread(
                    capture.get, cv2.CAP_PROP_FRAME_COUNT
                )
                if not is_network_stream and frame_count > 0:
                    await asyncio.to_thread(
                        capture.set, cv2.CAP_PROP_POS_FRAMES, 0
                    )
                    await asyncio.sleep(0.05)
                    continue
                break

            height, width = frame.shape[:2]
            if width > 960:
                frame = await asyncio.to_thread(
                    cv2.resize,
                    frame,
                    (960, max(1, round(height * 960 / width))),
                )
            encoded_ok, encoded = await asyncio.to_thread(
                cv2.imencode,
                ".jpg",
                frame,
                [cv2.IMWRITE_JPEG_QUALITY, 80],
            )
            if not encoded_ok:
                continue
            image = encoded.tobytes()
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: "
                + str(len(image)).encode()
                + b"\r\n\r\n"
                + image
                + b"\r\n"
            )
    finally:
        await asyncio.to_thread(capture.release)


@router.get("/{camera_id}/stream")
async def stream_camera(
    camera_id: str,
    db: asyncpg.Pool | None = Depends(get_optional_pool),
):
    """Live MJPEG video stream of the specified camera (supports RTSP, demo video, or active ANPR engine)."""
    # 1. Check if anpr_engine is actively streaming this camera
    try:
        from app.services.anpr_engine import anpr_engine
        cid_lower = str(camera_id).strip().lower()
        if anpr_engine.is_running:
            active_src = str(anpr_engine.source_id or "").strip().lower()
            active_code = str(anpr_engine.camera_code or "").strip().lower()
            if cid_lower in [active_src, active_code] or (cid_lower in ["demo_video", "demo_highway", "demo-01"] and active_src in ["demo_video", "demo_highway", "demo-01"]):
                return CameraStreamingResponse(
                    anpr_engine.generate_mjpeg_stream(),
                    media_type="multipart/x-mixed-replace; boundary=frame"
                )
    except Exception:
        pass

    # 2. Check for demo video
    from app.services.anpr_engine import get_demo_video_source
    demo_source = get_demo_video_source(camera_id)
    if demo_source:
        video_path = demo_source["video_path"]
        if video_path.exists():
            return CameraStreamingResponse(
                generate_mjpeg_stream(str(video_path)),
                media_type="multipart/x-mixed-replace; boundary=frame"
            )

    # 3. Look up registered camera
    camera = await get_registered_camera(camera_id, db)

    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found."
        )

    source_type = camera.get("source_type") if isinstance(camera, dict) else getattr(camera, "source_type", None)

    stream_input = _camera_stream_input(camera)
    if not stream_input or source_type == "LOCAL_WEBCAM":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This camera does not have an active RTSP or HTTP stream URL."
        )

    return CameraStreamingResponse(
        generate_mjpeg_stream(stream_input),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@router.get("/{camera_id}/snapshot")
async def snapshot_camera(
    camera_id: str,
    db: asyncpg.Pool | None = Depends(get_optional_pool),
):
    """Capture a single frame snapshot from the camera RTSP/HTTP stream."""
    camera = await get_registered_camera(camera_id, db)

    stream_input = _camera_stream_input(camera) if camera else ""

    if not camera or not stream_input:
        raise HTTPException(status_code=404, detail="Camera or RTSP stream not found.")

    cmd = [
        "ffmpeg",
        "-nostdin",
        "-loglevel", "error",
        "-rtsp_transport", "tcp",
        "-analyzeduration", "2000000",
        "-probesize", "2000000",
        "-i", stream_input,
        "-vframes", "1",
        "-q:v", "2",
        "-f", "image2",
        "-update", "1",
        "pipe:1"
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15.0)
        if stdout and len(stdout) > 100:
            return Response(content=stdout, media_type="image/jpeg")
        raise HTTPException(status_code=502, detail="Failed to capture frame from stream.")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"SNAPSHOT EXCEPTION: {type(exc)} {repr(exc)}")
        raise HTTPException(status_code=502, detail=f"Snapshot error: {repr(exc)}")
