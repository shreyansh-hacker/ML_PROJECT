import asyncio
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.routers import anpr
from app.security import (
    SecurityMiddleware,
    _login_failures,
    _login_lock,
    create_session_token,
    is_valid_session,
    router,
)


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.key_patch = patch.object(settings, "session_signing_key", "s" * 48)
        self.password_patch = patch.object(settings, "admin_password", "a" * 24)
        self.origins_patch = patch.object(
            settings,
            "cors_origins",
            "http://localhost:5173",
        )
        self.environment_patch = patch.object(settings, "environment", "development")
        for active_patch in (
            self.key_patch,
            self.password_patch,
            self.origins_patch,
            self.environment_patch,
        ):
            active_patch.start()
            self.addCleanup(active_patch.stop)
        with _login_lock:
            _login_failures.clear()

    def test_session_signature_and_expiry(self):
        token = create_session_token(now=100)
        self.assertTrue(is_valid_session(token, now=101))
        self.assertFalse(is_valid_session(token, now=100 + 8 * 60 * 60))
        self.assertFalse(is_valid_session(token + "tampered", now=101))
        self.assertFalse(is_valid_session("invalid.###", now=101))

    def test_protected_routes_require_session_and_trusted_origin(self):
        app = FastAPI()
        app.add_middleware(SecurityMiddleware)
        app.include_router(router)

        @app.get("/private")
        async def private():
            return {"ok": True}

        @app.post("/private")
        async def mutate():
            return {"ok": True}

        with TestClient(app) as client:
            self.assertEqual(client.get("/private").status_code, 401)
            token = create_session_token()
            self.assertEqual(
                client.get("/private", cookies={"sentinel_session": token}).status_code,
                200,
            )
            self.assertEqual(
                client.post(
                    "/private",
                    cookies={"sentinel_session": token},
                    headers={"Origin": "https://attacker.example"},
                ).status_code,
                403,
            )
            self.assertEqual(
                client.get(
                    "/private",
                    cookies={"sentinel_session": token},
                    headers={
                        "Origin": "https://attacker.example",
                        "Sec-Fetch-Site": "cross-site",
                    },
                ).status_code,
                403,
            )
            self.assertEqual(
                client.get(
                    "/private",
                    cookies={"sentinel_session": token},
                    headers={
                        "Origin": "http://localhost:5173",
                        "Sec-Fetch-Site": "cross-site",
                    },
                ).status_code,
                200,
            )
            self.assertEqual(
                client.post(
                    "/private",
                    cookies={"sentinel_session": token},
                    headers={
                        "Origin": "https://attacker.example",
                        "Sec-Fetch-Site": "cross-site",
                    },
                ).status_code,
                403,
            )
            self.assertEqual(
                client.post(
                    "/private",
                    cookies={"sentinel_session": token},
                    headers={"Origin": "http://localhost:5173"},
                ).status_code,
                200,
            )

    def test_login_sets_http_only_session_cookie(self):
        app = FastAPI()
        app.add_middleware(SecurityMiddleware)
        app.include_router(router)
        with TestClient(app) as client:
            response = client.post(
                "/api/auth/login",
                json={"password": "a" * 24},
                headers={"Origin": "http://localhost:5173"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("httponly", response.headers["set-cookie"].lower())
        self.assertTrue(response.json()["authenticated"])

    def test_login_rate_limits_repeated_bad_passwords(self):
        app = FastAPI()
        app.add_middleware(SecurityMiddleware)
        app.include_router(router)
        with TestClient(app) as client:
            responses = [
                client.post(
                    "/api/auth/login",
                    json={"password": f"wrong-password-{index}"},
                    headers={"Origin": "http://localhost:5173"},
                )
                for index in range(6)
            ]
        self.assertEqual([response.status_code for response in responses[:5]], [401] * 5)
        self.assertEqual(responses[5].status_code, 429)

    def test_anpr_start_uses_registered_camera_url_not_request_url(self):
        request = anpr.StartEngineRequest.model_validate(
            {
                "source_type": "CAMERA",
                "source_id": "registered-camera",
                "rtsp_url": "rtsp://127.0.0.1/private",
            }
        )
        camera = {"id": "registered-camera", "camera_code": "CAM-01"}
        with (
            patch(
                "app.routers.anpr.get_registered_camera",
                return_value=camera,
            ),
            patch(
                "app.routers.stream._camera_stream_input",
                return_value="rtsp://camera.lan/stream",
            ),
            patch.object(anpr.anpr_engine, "start", return_value={"is_running": True}) as start,
        ):
            asyncio.run(anpr.start_stream(request, db=None))

        self.assertEqual(start.call_args.kwargs["rtsp_url"], "rtsp://camera.lan/stream")


if __name__ == "__main__":
    unittest.main()
