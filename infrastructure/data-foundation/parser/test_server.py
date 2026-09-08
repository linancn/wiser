import base64
import hashlib
import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

from parser import ParseError
from server import encode_event, make_server, prepare_request


def payload(content=b"Water\n\nStation 001"):
    return {
        "format": "md",
        "primary": "note.md",
        "files": [
            {
                "name": "note.md",
                "sha256": hashlib.sha256(content).hexdigest(),
                "base64": base64.b64encode(content).decode(),
            }
        ],
    }


class ParserServiceTest(unittest.TestCase):
    def test_request_verifies_hashes_and_rejects_filesystem_or_network_instructions(
        self,
    ):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bad = payload()
            bad["files"][0]["sha256"] = "0" * 64
            with self.assertRaisesRegex(ParseError, "HASH_MISMATCH"):
                prepare_request(bad, root)
            for name in ("../escape.md", "/tmp/escape.md", "C:/escape.md", "a/./b.md"):
                bad = payload()
                bad["files"][0]["name"] = name
                bad["primary"] = name
                with self.assertRaisesRegex(ParseError, "UNSAFE_PATH"):
                    prepare_request(bad, root)
            bad = payload()
            bad["url"] = "http://host.docker.internal/private"
            with self.assertRaisesRegex(ParseError, "INVALID_REQUEST"):
                prepare_request(bad, root)
            self.assertEqual(list(root.iterdir()), [])

    def test_large_geometry_frames_remain_bounded_but_preserve_real_polygon_sizes(self):
        event = {
            "type": "record",
            "values": {"coordinates": [[1100000.123456, 4400000.123456]] * 60000},
        }
        encoded = encode_event(event)
        self.assertGreater(len(encoded), 1024 * 1024)
        self.assertEqual(json.loads(encoded), event)
        with self.assertRaisesRegex(ParseError, "RECORD_SIZE_LIMIT"):
            encode_event({"type": "record", "text": "a" * (4 * 1024 * 1024)})

    def test_http_stream_is_hash_bound_and_reports_all_records_and_summary(self):
        server = make_server(("127.0.0.1", 0))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/parse",
                data=json.dumps(payload()).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=10) as response:
                self.assertEqual(
                    response.headers["Content-Type"], "application/x-ndjson"
                )
                self.assertEqual(response.version, 11)
                self.assertEqual(response.headers["Transfer-Encoding"], "chunked")
                events = [json.loads(line) for line in response]
            self.assertEqual(events[0]["type"], "source")
            self.assertEqual(events[0]["sha256"], payload()["files"][0]["sha256"])
            self.assertEqual(
                [event["index"] for event in events if event["type"] == "record"],
                [1, 2],
            )
            self.assertEqual(events[-1]["recordCount"], 2)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
