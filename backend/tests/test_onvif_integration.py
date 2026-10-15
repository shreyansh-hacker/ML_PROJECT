import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.fernet import Fernet

from app.config import settings
from app.routers import map as camera_map
from app.routers import onvif, stream
from app.services import onvif_credentials
from app.store import MemoryRegistry
from app import store


class OnvifCredentialsTests(unittest.TestCase):
    def test_credentials_are_encrypted_and_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            old_directory = onvif_credentials.DATA_DIR
            old_file = onvif_credentials.CREDENTIALS_FILE
            old_key = settings.onvif_credentials_key
            onvif_credentials.DATA_DIR = Path(directory)
            onvif_credentials.CREDENTIALS_FILE = Path(directory) / "credentials.json"
            settings.onvif_credentials_key = Fernet.generate_key().decode("ascii")
            try:
                onvif_credentials.save_credentials("device-1", "operator", "private-password")
                saved_contents = onvif_credentials.CREDENTIALS_FILE.read_text(encoding="utf-8")
                self.assertNotIn("operator", saved_contents)
                self.assertNotIn("private-password", saved_contents)
                self.assertEqual(
                    onvif_credentials.load_credentials("device-1"),
                    {"username": "operator", "password": "private-password"},
                )
                with patch.object(onvif_credentials, "_write_records") as write_records:
                    onvif_credentials.save_credentials(
                        "device-1",
                        "operator",
                        "private-password",
                    )
                write_records.assert_not_called()
                self.assertTrue(onvif_credentials.delete_credentials("device-1"))
                self.assertIsNone(onvif_credentials.load_credentials("device-1"))
            finally:
                onvif_credentials.DATA_DIR = old_directory
                onvif_credentials.CREDENTIALS_FILE = old_file
                settings.onvif_credentials_key = old_key

    def test_rtsp_credentials_are_url_encoded(self):
        authenticated = onvif_credentials.add_rtsp_credentials(
            "rtsp://192.168.1.20:554/live?profile=main",
            "camera user",
            "p@ss:word",
        )
        self.assertEqual(
            authenticated,
            "rtsp://camera%20user:p%40ss%3Aword@192.168.1.20:554/live?profile=main",
        )


class OnvifDiscoveryTests(unittest.TestCase):
    def test_discovery_errors_distinguish_authentication_from_network(self):
        self.assertEqual(
            onvif._onvif_failure_status(RuntimeError("NotAuthorized"), True),
            "AUTHENTICATION_FAILED",
        )
        self.assertEqual(
            onvif._onvif_failure_status(TimeoutError("timed out"), False),
            "DEVICE_UNREACHABLE",
        )
        self.assertEqual(
            onvif._onvif_failure_status(RuntimeError("SOAP Fault"), False),
            "NEEDS_CREDENTIALS",
        )

    def test_refresh_updates_camera_ip_without_changing_registry_id(self):
        with tempfile.TemporaryDirectory() as directory:
            old_camera_file = store.CAMERAS_FILE
            old_department_file = store.DEPARTMENTS_FILE
            store.CAMERAS_FILE = str(Path(directory) / "cameras.json")
            store.DEPARTMENTS_FILE = str(Path(directory) / "departments.json")
            try:
                registry = MemoryRegistry()
                camera = SimpleNamespace(
                    dept_id=None,
                    department_name="ONVIF Auto-Discovery",
                    camera_code="ONVIF-DEVICE-1",
                    onvif_device_id="device-1",
                    make_model="Example Camera",
                    source_type="NETWORK_CCTV",
                    ip_address="192.168.1.20",
                    rtsp_url="rtsp://192.168.1.20/live",
                    latitude=None,
                    longitude=None,
                    camera_type="FIXED",
                    status="ONLINE",
                    ageing=0,
                )
                first = registry.upsert_camera(camera)
                self.assertEqual(
                    registry.get_camera_by_id(first["id"])["onvif_device_id"],
                    "device-1",
                )
                camera.ip_address = "192.168.1.21"
                camera.rtsp_url = "rtsp://192.168.1.21/live"
                refreshed = registry.upsert_camera(camera)
                stored = registry.get_camera_by_id(first["id"])
                self.assertEqual(refreshed["id"], first["id"])
                self.assertEqual(stored["ip_address"], "192.168.1.21")
                self.assertEqual(stored["rtsp_url"], "rtsp://192.168.1.21/live")
            finally:
                store.CAMERAS_FILE = old_camera_file
                store.DEPARTMENTS_FILE = old_department_file

    def test_discovery_registers_real_stream_without_returning_rtsp_uri(self):
        service_result = (
            "stable-device-id",
            "http",
            "192.168.1.25",
            80,
            "urn:uuid:camera-1",
        )
        camera_details = {
            "manufacturer": "Example",
            "model": "Network Camera",
            "firmware_version": "1.0",
            "rtsp_url": "rtsp://192.168.1.25:554/profile1",
        }
        with (
            patch.object(onvif, "_discover_services", return_value=[service_result]),
            patch.object(onvif, "_read_camera", return_value=camera_details),
            patch.object(onvif, "_verify_rtsp_stream", return_value=True),
            patch.object(onvif, "load_credentials", return_value=None),
            patch.object(onvif, "save_credentials") as save_credentials,
            patch.object(onvif, "memory_registry") as registry,
        ):
            registry.upsert_camera.return_value = {
                "id": "camera-registry-id",
                "camera_code": "ONVIF-STABLE-DE",
                "status": "ONLINE",
            }
            results = asyncio.run(
                onvif.discover_onvif_cameras(
                    onvif.DiscoveryRequest(username="operator", password="private")
                )
            )

        self.assertEqual(len(results), 1)
        self.assertTrue(results[0].stream_ready)
        self.assertEqual(results[0].ip_address, "192.168.1.25")
        self.assertFalse(hasattr(results[0], "rtsp_url"))
        registry.upsert_camera.assert_called_once()
        save_credentials.assert_called_once_with(
            "stable-device-id",
            "operator",
            "private",
        )

    def test_discovery_uses_distinct_rtsp_credentials(self):
        service_result = (
            "stable-device-id",
            "http",
            "192.168.1.25",
            80,
            "urn:uuid:camera-1",
        )
        camera_details = {
            "manufacturer": "Example",
            "model": "Network Camera",
            "firmware_version": "1.0",
            "rtsp_url": "rtsp://192.168.1.25:554/profile1",
        }
        with (
            patch.object(onvif, "_discover_services", return_value=[service_result]),
            patch.object(onvif, "_read_camera", return_value=camera_details),
            patch.object(onvif, "_verify_rtsp_stream", return_value=True) as verify_stream,
            patch.object(onvif, "load_credentials", return_value=None),
            patch.object(onvif, "save_credentials") as save_credentials,
            patch.object(onvif, "memory_registry") as registry,
        ):
            registry.upsert_camera.return_value = {
                "id": "camera-registry-id",
                "camera_code": "ONVIF-STABLE-DE",
                "status": "ONLINE",
            }
            results = asyncio.run(
                onvif.discover_onvif_cameras(
                    onvif.DiscoveryRequest(
                        username="onvif-user",
                        password="onvif-test",
                        stream_username="rtsp-user",
                        stream_password="rtsp-test",
                    )
                )
            )

        self.assertTrue(results[0].stream_ready)
        verify_stream.assert_called_once_with(
            camera_details["rtsp_url"],
            "rtsp-user",
            "rtsp-test",
        )
        self.assertEqual(
            registry.upsert_camera.call_args.args[0].credential_id,
            "stable-device-id:rtsp",
        )
        save_credentials.assert_any_call(
            "stable-device-id",
            "onvif-user",
            "onvif-test",
        )
        save_credentials.assert_any_call(
            "stable-device-id:rtsp",
            "rtsp-user",
            "rtsp-test",
        )

    def test_manual_private_ip_connection_skips_multicast_discovery(self):
        camera_details = {
            "manufacturer": "Example",
            "model": "Network Camera",
            "firmware_version": "1.0",
            "rtsp_url": "rtsp://192.168.1.50:554/profile1",
        }
        with (
            patch.object(onvif, "_discover_services") as discover_services,
            patch.object(onvif, "_read_camera", return_value=camera_details) as read_camera,
            patch.object(onvif, "_verify_rtsp_stream", return_value=True),
            patch.object(onvif, "load_credentials", return_value=None),
            patch.object(onvif, "save_credentials"),
            patch.object(onvif, "memory_registry") as registry,
        ):
            registry.upsert_camera.return_value = {
                "id": "camera-registry-id",
                "camera_code": "ONVIF-MANUAL",
                "status": "ONLINE",
            }
            results = asyncio.run(
                onvif.discover_onvif_cameras(
                    onvif.DiscoveryRequest(
                        address="192.168.1.50",
                        scheme="https",
                        port=8443,
                        username="operator",
                        password="camera-test",
                    ),
                    db=None,
                )
            )

        discover_services.assert_not_called()
        read_camera.assert_called_once_with(
            "https",
            "192.168.1.50",
            8443,
            "operator",
            "camera-test",
        )
        self.assertTrue(results[0].stream_ready)
        self.assertEqual(results[0].connection_address, "192.168.1.50")
        self.assertEqual(results[0].connection_scheme, "https")
        self.assertEqual(results[0].connection_port, 8443)

    def test_manual_connection_rejects_public_or_loopback_addresses(self):
        for address in ("8.8.8.8", "127.0.0.1", "192.0.2.10"):
            with self.subTest(address=address):
                with self.assertRaises(onvif.HTTPException) as error:
                    asyncio.run(
                        onvif.discover_onvif_cameras(
                            onvif.DiscoveryRequest(address=address),
                            db=None,
                        )
                    )
                self.assertEqual(error.exception.status_code, 400)

    def test_onvif_stream_uri_credentials_are_separated_from_public_uri(self):
        profile = SimpleNamespace(
            token="main-profile",
            VideoEncoderConfiguration=SimpleNamespace(
                Resolution=SimpleNamespace(Width=1920, Height=1080)
            ),
        )
        media = SimpleNamespace(
            GetProfiles=lambda: [profile],
            GetStreamUri=lambda _request: SimpleNamespace(
                Uri=onvif_credentials.add_rtsp_credentials(
                    "rtsp://192.168.1.25:554/profile1",
                    "stream-user",
                    "stream-test",
                )
            ),
        )
        camera = SimpleNamespace(
            devicemgmt=SimpleNamespace(
                GetDeviceInformation=lambda: SimpleNamespace(
                    Manufacturer="Example",
                    Model="Network Camera",
                    FirmwareVersion="1.0",
                )
            ),
            create_media_service=lambda: media,
        )
        with patch.object(onvif, "ONVIFCamera", return_value=camera):
            details = onvif._read_camera(
                "http",
                "192.168.1.25",
                80,
                "onvif-user",
                "onvif-test",
            )

        self.assertEqual(details["rtsp_url"], "rtsp://192.168.1.25:554/profile1")
        self.assertEqual(details["stream_username"], "stream-user")
        self.assertEqual(details["stream_password"], "stream-test")

    def test_rtsp_failure_does_not_mark_camera_ready(self):
        service_result = (
            "stable-device-id",
            "http",
            "192.168.1.25",
            80,
            "urn:uuid:camera-1",
        )
        camera_details = {
            "manufacturer": "Example",
            "model": "Network Camera",
            "firmware_version": "1.0",
            "rtsp_url": "rtsp://192.168.1.25:554/profile1",
        }
        with (
            patch.object(onvif, "_discover_services", return_value=[service_result]),
            patch.object(onvif, "_read_camera", return_value=camera_details),
            patch.object(onvif, "_verify_rtsp_stream", return_value=False),
            patch.object(onvif, "load_credentials", return_value=None),
            patch.object(onvif, "save_credentials"),
            patch.object(onvif, "memory_registry") as registry,
        ):
            results = asyncio.run(
                onvif.discover_onvif_cameras(
                    onvif.DiscoveryRequest(
                        username="operator",
                        password="camera-test",
                    )
                )
            )

        self.assertEqual(results[0].status, "RTSP_UNAVAILABLE")
        self.assertFalse(results[0].stream_ready)
        registry.upsert_camera.assert_not_called()

    def test_rtsp_can_be_anonymous_when_onvif_requires_credentials(self):
        service_result = (
            "stable-device-id",
            "http",
            "192.168.1.25",
            80,
            "urn:uuid:camera-1",
        )
        camera_details = {
            "manufacturer": "Example",
            "model": "Network Camera",
            "firmware_version": "1.0",
            "rtsp_url": "rtsp://192.168.1.25:554/profile1",
        }
        with (
            patch.object(onvif, "_discover_services", return_value=[service_result]),
            patch.object(onvif, "_read_camera", return_value=camera_details),
            patch.object(onvif, "_verify_rtsp_stream", return_value=True) as verify_stream,
            patch.object(onvif, "load_credentials", return_value=None),
            patch.object(onvif, "save_credentials") as save_credentials,
            patch.object(onvif, "memory_registry") as registry,
        ):
            registry.upsert_camera.return_value = {
                "id": "camera-registry-id",
                "camera_code": "ONVIF-STABLE-DE",
                "status": "ONLINE",
            }
            results = asyncio.run(
                onvif.discover_onvif_cameras(
                    onvif.DiscoveryRequest(
                        username="onvif-user",
                        password="onvif-test",
                        use_onvif_credentials_for_rtsp=False,
                    )
                )
            )

        self.assertTrue(results[0].stream_ready)
        verify_stream.assert_called_once_with(camera_details["rtsp_url"], "", "")
        self.assertIsNone(registry.upsert_camera.call_args.args[0].credential_id)
        save_credentials.assert_called_once_with(
            "stable-device-id",
            "onvif-user",
            "onvif-test",
        )

    def test_empty_discovery_returns_no_simulated_cameras(self):
        with patch.object(onvif, "_discover_services", return_value=[]):
            results = asyncio.run(onvif.discover_onvif_cameras(onvif.DiscoveryRequest()))
        self.assertEqual(results, [])

    def test_stream_route_uses_saved_credentials_only_server_side(self):
        camera = {
            "onvif_device_id": "stable-device-id",
            "credential_id": "stable-device-id",
            "rtsp_url": "rtsp://192.168.1.25:554/profile1",
        }
        with patch.object(
            stream,
            "load_credentials",
            return_value={"username": "operator", "password": "secret"},
        ):
            stream_url = stream._camera_stream_input(camera)
        self.assertEqual(
            stream_url,
            "rtsp://operator:secret@192.168.1.25:554/profile1",
        )

    def test_stream_route_does_not_use_onvif_only_credentials(self):
        camera = {
            "onvif_device_id": "stable-device-id",
            "rtsp_url": "rtsp://192.168.1.25:554/profile1",
        }
        with patch.object(stream, "load_credentials") as load_credentials:
            stream_url = stream._camera_stream_input(camera)

        self.assertEqual(stream_url, camera["rtsp_url"])
        load_credentials.assert_not_called()

    def test_database_camera_upsert_is_transactional_and_contains_no_password(self):
        class AsyncContext:
            def __init__(self, value=None):
                self.value = value

            async def __aenter__(self):
                return self.value

            async def __aexit__(self, *_args):
                return False

        class StubConnection:
            def __init__(self):
                self.statements = []

            def transaction(self):
                return AsyncContext()

            async def fetchval(self, query, *_args):
                self.statements.append(query)
                return "department-id"

            async def execute(self, query, *_args):
                self.statements.append(query)

        class StubPool:
            def __init__(self):
                self.connection = StubConnection()

            def acquire(self):
                return AsyncContext(self.connection)

        pool = StubPool()
        camera = SimpleNamespace(
            department_name="ONVIF Auto-Discovery",
            camera_code="ONVIF-DEVICE-1",
            make_model="Example Camera",
            ip_address="192.168.1.20",
            rtsp_url="rtsp://192.168.1.20:554/live",
            longitude=None,
            latitude=None,
            camera_type="FIXED",
        )
        asyncio.run(onvif._persist_camera_to_database(pool, camera))

        self.assertEqual(len(pool.connection.statements), 2)
        self.assertTrue(
            any("ON CONFLICT (camera_code)" in query for query in pool.connection.statements)
        )
        self.assertTrue(
            all("password" not in query.lower() for query in pool.connection.statements)
        )

    def test_discovery_rejects_public_addresses(self):
        with self.assertRaises(ValueError):
            onvif._private_address("8.8.8.8")


class PublicCameraDataTests(unittest.TestCase):
    def test_geojson_hides_stream_credentials_and_private_endpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            old_camera_file = store.CAMERAS_FILE
            old_department_file = store.DEPARTMENTS_FILE
            store.CAMERAS_FILE = str(Path(directory) / "cameras.json")
            store.DEPARTMENTS_FILE = str(Path(directory) / "departments.json")
            try:
                registry = MemoryRegistry()
                registry.add_camera(
                    SimpleNamespace(
                        dept_id=None,
                        department_name="Sentinel",
                        camera_code="SENTINEL-1",
                        make_model="Example Camera",
                        source_type="NETWORK_CCTV",
                        ip_address="192.0.2.10",
                        rtsp_url="rtsp://operator:private-password@192.0.2.10:8554/stream",
                        credential_id="sentinel:SENTINEL-1",
                        onvif_device_id=None,
                        latitude=23.0,
                        longitude=72.5,
                        camera_type="FIXED",
                        status="ONLINE",
                        ageing=0,
                        hls_url="https://operator:private-password@example.test/live.m3u8",
                        http_stream_url="",
                        whep_url="http://operator:private-password@example.test/whep",
                    )
                )

                result = registry.get_cameras_geojson()
                serialized = json.dumps(result)
                properties = result["features"][0]["properties"]
                self.assertNotIn("private-password", serialized)
                self.assertNotIn("credential_id", properties)
                self.assertNotIn("hls_url", properties)
                self.assertNotIn("whep_url", properties)
                self.assertTrue(properties["stream_auth_managed"])
                self.assertEqual(
                    properties["rtsp_url"],
                    "rtsp://192.0.2.10:8554/stream",
                )
            finally:
                store.CAMERAS_FILE = old_camera_file
                store.DEPARTMENTS_FILE = old_department_file

    def test_database_geojson_marks_only_credential_managed_cameras(self):
        class StubPool:
            async def fetchrow(self, *_args):
                return {
                    "geojson": json.dumps(
                        {
                            "features": [
                                {"properties": {"camera_code": "MANAGED-1"}},
                                {"properties": {"camera_code": "PLAIN-1"}},
                            ]
                        }
                    )
                }

        with patch.object(
            camera_map.memory_registry,
            "get_all_cameras",
            return_value=[
                {"camera_code": "MANAGED-1", "credential_id": "sentinel:MANAGED-1"},
                {"camera_code": "PLAIN-1"},
            ],
        ):
            result = asyncio.run(camera_map.get_cameras_geojson(db=StubPool()))

        properties = [feature["properties"] for feature in result["features"]]
        self.assertTrue(properties[0]["stream_auth_managed"])
        self.assertFalse(properties[1]["stream_auth_managed"])


if __name__ == "__main__":
    unittest.main()
