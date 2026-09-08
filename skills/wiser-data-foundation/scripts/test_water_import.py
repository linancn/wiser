"""Recovery and transport boundaries for the real-bundle HTTP importer."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest

import test_water_bundle
from water_bundle import build_inventory, digest
from water_import import Checkpoint, HttpClient, ImportFailure, Uploader, group_inventory
import water_import


class ImportPlanTests(unittest.TestCase):
    def test_accounts_for_sources_empty_files_and_sanitized_derivatives_exactly_once(self):
        fixture = test_water_bundle.InventoryTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.write("output/downloads/DS-0001_empty.bin", b"")
        inventory = build_inventory(fixture.root)
        groups = group_inventory(inventory)
        self.assertEqual(groups, group_inventory(inventory))
        identifiers = [group["source"]["sourceId"] for group in groups]
        self.assertEqual(len(identifiers), len(set(identifiers)))
        self.assertTrue({"river", "DS-0001", "DS-0002"}.issubset(identifiers))
        files = [file for group in groups for file in group["files"]]
        expected = [file for file in inventory["files"] if file["disposition"] in {"IMPORT", "SANITIZE_TEXT"}]
        self.assertCountEqual([f["path"] for f in files], [f["path"] for f in expected])
        one = next(g for g in groups if g["source"]["sourceId"] == "DS-0001")
        self.assertEqual({f["completeness"] for f in one["files"]}, {"PARTIAL", "EMPTY"})
        self.assertFalse(any(g["completeness"] == "COMPLETE" for g in groups))
        self.assertNotIn("private-token-never-upload-this", json.dumps(groups))


class LostCompletionAPI:
    """Server completes once, loses its response, then accepts only exact replay."""
    def __init__(self):
        self.create_count = 0
        self.put_count = 0
        self.complete_calls = []
        self.completed = False

    def command(self, path, body, key, version=None):
        if path == "/upload-sessions":
            self.create_count += 1
            if self.completed:
                raise AssertionError("A completed session must never be reopened")
            return {"uploadSession": {"uploadSessionId": "session", "version": 1, "assetIds": ["asset"]},
                    "uploadTargets": [{"assetId": "asset", "method": "PRESIGNED_PUT", "uploadUrl": "https://files.example.test/private-signature", "headers": {}}]}
        self.complete_calls.append((path, body, key, version))
        if not self.completed:
            self.completed = True
            raise ImportFailure("TRANSPORT_UNAVAILABLE")
        return {"uploadSession": {"uploadSessionId": "session", "status": "COMPLETED", "assetIds": ["asset"], "version": 2}}

    def put(self, target, content):
        self.put_count += 1
        self.content = content


class RecoveryTests(unittest.TestCase):
    def test_registration_review_requires_matching_descriptor_waiting_operation_and_no_issues(self):
        registration = {"sourceId": "DS-0001", "manifestSha256": "a" * 64}
        snapshot = {"ingestion": {"state": "REVIEW_REQUIRED", "sourceRegistration": registration}, "qualityIssues": [], "agentRuns": []}
        self.assertTrue(water_import.registration_review_allowed(snapshot, registration, {"status": "WAITING_REVIEW"}))
        self.assertFalse(water_import.registration_review_allowed(snapshot, registration, {"status": "RUNNING"}))
        self.assertFalse(water_import.registration_review_allowed(snapshot, {**registration, "sourceId": "DS-0002"}, {"status": "WAITING_REVIEW"}))
        snapshot["qualityIssues"] = [{"severity": "ERROR", "status": "OPEN"}]
        self.assertFalse(water_import.registration_review_allowed(snapshot, registration, {"status": "WAITING_REVIEW"}))

    def test_lost_complete_response_resumes_identical_command_without_reopening_or_duplicate_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            api = LostCompletionAPI()
            item = {"fileName": "sample.bin", "mediaType": "application/octet-stream", "sizeBytes": 6, "sha256": digest(b"sample")}
            uploader = Uploader(api, Checkpoint(path, "source"), "stable-scope", "project")
            with self.assertRaisesRegex(ImportFailure, "TRANSPORT_UNAVAILABLE"):
                uploader.upload("files", [item], lambda _: b"sample")
            checkpoint_text = path.read_text()
            self.assertNotIn("private-signature", checkpoint_text)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            resumed = Uploader(api, Checkpoint(path, "source"), "stable-scope", "project")
            self.assertEqual(resumed.upload("files", [item], lambda _: b"sample"), ["asset"])
            self.assertEqual(api.create_count, 1)
            self.assertEqual(api.put_count, 1)
            self.assertEqual(api.complete_calls[0], api.complete_calls[1])
            self.assertEqual(api.content, b"sample")

    def test_file_drift_is_rejected_before_upload_or_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            api = LostCompletionAPI()
            uploader = Uploader(api, Checkpoint(Path(directory) / "state.json", "source"), "scope", "project")
            with self.assertRaisesRegex(ImportFailure, "PREPARED_FILE_CHANGED"):
                uploader.upload("files", [{"fileName": "x", "mediaType": "text/plain", "sizeBytes": 6, "sha256": digest(b"sample")}], lambda _: b"drift!")
            self.assertEqual(api.put_count, 0)
            self.assertFalse(api.completed)


class TransportTests(unittest.TestCase):
    def test_signed_transfers_never_receive_api_bearer_and_unexpected_redirect_is_not_followed(self):
        received = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                received.append((self.path, self.headers.get("Authorization")))
                if self.path.endswith("/download"):
                    self.send_response(303)
                    self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/signed")
                    self.end_headers()
                elif self.path.endswith("/redirect"):
                    self.send_response(302)
                    self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/leaked")
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"sample")

            def do_PUT(self):
                received.append((self.path, self.headers.get("Authorization")))
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(200)
                self.end_headers()

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory) / "token"
            token.write_text("private-api-bearer")
            token.chmod(0o600)
            origin = f"http://127.0.0.1:{server.server_port}"
            client = HttpClient(origin, token, "tenant", "project", "operate")
            self.assertEqual(client.download("/download"), {"sizeBytes": 6, "sha256": digest(b"sample")})
            client.put({"uploadUrl": origin + "/signed", "headers": {}}, b"sample")
            with self.assertRaisesRegex(ImportFailure, "HTTP_302"):
                client.get("/redirect")
            self.assertEqual(received, [("/api/data/v1/download", "Bearer private-api-bearer"), ("/signed", None), ("/signed", None), ("/api/data/v1/redirect", "Bearer private-api-bearer")])


if __name__ == "__main__":
    unittest.main()
